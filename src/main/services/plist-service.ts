// plist 执行层(阶段 1;机制对齐开源 PlistService)
// - 三个作用域目录:user=~/Library/LaunchAgents;system=/Library/LaunchAgents;daemon=/Library/LaunchDaemons
// - 读取:二进制 plist 经 plutil 转 XML;解析失败 → invalid(带原因)
//   合法 plist 但未定义任务(缺 Label / 空 <dict/>,如 Google keystone 占位)→ 静默跳过:不计入 agents 也不报错
//   (Label 是 launchd 对任务的硬性要求,这类文件 launchd 自己也忽略;与开源 PlistService 归 invalid 的差异为有意)
// - 写入:用户级 原子写(tmp+rename);提权级 临时文件 → 提权 mv && chown root:wheel && chmod 644
//   写入前有覆盖守卫:目标已存在时仅允许覆盖「非任务占位(缺 Label)」或「同名任务自身」,其余拒绝
// - 校验:plutil -lint(stdin),与系统口径一致

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { ELEVATION_CANCELLED, ELEVATION_FAILED } from '../../shared/ipc'
import type { AgentScope, InvalidPlist } from '../../shared/models'
import { extractPlistDesc, parsePlistXml, type PlistDict } from '../domains/plist-xml'
import type { ElevationExecutor } from './elevation'
import type { ShellRunner } from './shell-runner'

export interface PlistFile {
  path: string
  scope: AgentScope
  fileName: string
  xml: string
  value: PlistDict
  label: string
  desc: string
}

export interface ScanResult {
  valid: PlistFile[]
  invalid: InvalidPlist[]
}

export interface PlistService {
  dirs(): { scope: AgentScope; dir: string; privileged: boolean }[]
  scanAll(): Promise<ScanResult>
  /** 失效 scanAll 记忆(launchd 目录被应用外修改时由 fsevents applier 调用) */
  invalidate(): void
  read(scope: AgentScope, path: string): Promise<PlistFile>
  write(scope: AgentScope, path: string, xml: string): Promise<void>
  remove(scope: AgentScope, path: string): Promise<void>
  lint(xml: string): Promise<{ ok: boolean; error: string | null }>
  pathFor(scope: AgentScope, label: string): string
  /** 提权作用域删除:bootout + rm 合并为一条授权命令(开源同款,避免二次授权) */
  removeWithBootout(scope: AgentScope, path: string, loaded: boolean, domain: string): Promise<void>
}

const BPLIST_MAGIC = 'bplist'

export function createPlistService(deps: {
  runner: ShellRunner
  elevate: ElevationExecutor
  home: string
  /** scanAll 结果记忆时长(ms,默认 1500);write/remove/目录变更都会显式失效 */
  memoTtlMs?: number
}): PlistService {
  const memoTtlMs = deps.memoTtlMs ?? 1500
  const dirs = (): { scope: AgentScope; dir: string; privileged: boolean }[] => [
    { scope: 'user', dir: join(deps.home, 'Library/LaunchAgents'), privileged: false },
    { scope: 'system', dir: '/Library/LaunchAgents', privileged: true },
    { scope: 'daemon', dir: '/Library/LaunchDaemons', privileged: true }
  ]

  // scanAll 记忆 + 单飞:抽屉一次打开 4 路并发 IPC(readForm/readStatus/readXml/readLogs)各自
  // findAgent 全量重扫 → 合并为共享 1 次。launchd 状态(pid 等)不在此层,无过期风险。
  let memo: { at: number; result: ScanResult } | null = null
  let pending: Promise<ScanResult> | null = null

  const invalidate = (): void => {
    memo = null
  }

  /** 解析单个 plist;合法 plist 但未定义任务(缺 Label / 空 dict)→ 返回 null(launchd 同样忽略这类文件) */
  async function readFile(scope: AgentScope, path: string): Promise<PlistFile | null> {
    let xml = await fs.readFile(path, 'utf8')
    if (xml.startsWith(BPLIST_MAGIC)) {
      const r = await deps.runner.run('plutil', ['-convert', 'xml1', '-o', '-', path])
      if (r.code !== 0) throw new Error(`plutil convert failed: ${r.stderr || r.code}`)
      xml = r.stdout
    }
    const parsed = parsePlistXml(xml)
    if (!parsed.ok) throw new Error(parsed.error)
    const label = typeof parsed.value.Label === 'string' ? parsed.value.Label : ''
    // 合法 plist 但不是任务定义(如 Google keystone 的空 <dict/> 占位):不计入 agents,也不算解析失败
    if (label === '') return null
    return { path, scope, fileName: basename(path), xml, value: parsed.value, label, desc: extractPlistDesc(xml) }
  }

  /**
   * 覆盖守卫:目标已存在时只允许两种覆盖 ——
   *   ① 目标是非任务 plist(缺 Label 的占位,如 Google keystone 的 <dict/>)→ 可覆盖
   *   ② 目标是本次要写的同一任务(Label 相同)→ 正常更新
   * 其余(已有他人任务、或已存在但无法解析)一律拒绝,避免新建/改名静默清掉别人的任务。
   */
  async function assertOverwritable(scope: AgentScope, path: string, incomingLabel: string): Promise<void> {
    try {
      await fs.access(path)
    } catch {
      return // 目标不存在 → 可直接写
    }
    let existing: PlistFile | null
    try {
      existing = await readFile(scope, path)
    } catch (err) {
      throw new Error(`目标文件已存在但无法解析,拒绝覆盖: ${path}(${err instanceof Error ? err.message : String(err)})`)
    }
    if (existing === null) return // 非任务占位(标签为空)
    if (existing.label === incomingLabel) return
    throw new Error(`目标文件已被任务「${existing.label}」占用,拒绝覆盖: ${path}`)
  }

  async function scanAllImpl(): Promise<ScanResult> {
    const valid: PlistFile[] = []
    const invalid: InvalidPlist[] = []
    for (const { scope, dir } of dirs()) {
      let names: string[]
      try {
        names = await fs.readdir(dir)
      } catch {
        continue // 目录不存在(如 /Library/LaunchDaemons 在极简系统)
      }
      for (const name of names) {
        if (!name.endsWith('.plist')) continue
        const path = join(dir, name)
        try {
          const pf = await readFile(scope, path)
          if (pf === null) continue // 非任务 plist:静默跳过(既不进 agents 也不报错)
          valid.push(pf)
        } catch (err) {
          invalid.push({ path, reason: err instanceof Error ? err.message : String(err) })
        }
      }
    }
    return { valid, invalid }
  }

  function scanAll(): Promise<ScanResult> {
    if (memo && Date.now() - memo.at < memoTtlMs) return Promise.resolve(memo.result)
    if (pending) return pending
    pending = scanAllImpl()
      .then((result) => {
        memo = { at: Date.now(), result }
        return result
      })
      .finally(() => {
        pending = null
      })
    return pending
  }

  return {
    dirs,

    scanAll,

    invalidate,

    // 公开入口按「必须是一个任务」语义:非任务 plist 视为不可读(scanAll 才是静默跳过的地方)
    async read(scope, path) {
      const pf = await readFile(scope, path)
      if (pf === null) throw new Error(`plist 未定义任务(缺少 Label): ${path}`)
      return pf
    },

    async write(scope, path, xml) {
      const parsed = parsePlistXml(xml)
      if (!parsed.ok) throw new Error(`拒绝写入非法 plist: ${parsed.error}`)
      const incomingLabel = typeof parsed.value.Label === 'string' ? parsed.value.Label : ''
      await assertOverwritable(scope, path, incomingLabel)
      const privileged = scope !== 'user'
      const tmp = join(privileged ? tmpdir() : join(path, '..'), `.launcher-${Date.now()}-${basename(path)}`)
      await fs.writeFile(tmp, xml, 'utf8')
      if (!privileged) {
        await fs.rename(tmp, path)
        invalidate()
        return
      }
      const r = await deps.elevate.run(`mv ${tmp} ${path} && chown root:wheel ${path} && chmod 644 ${path}`)
      if (!r.ok) {
        await fs.unlink(tmp).catch(() => {})
        throw new Error(r.cancelled ? ELEVATION_CANCELLED : `${ELEVATION_FAILED}: ${r.stderr ?? ''}`)
      }
      invalidate()
    },

    async remove(scope, path) {
      if (scope === 'user') {
        await fs.unlink(path)
        invalidate()
        return
      }
      const r = await deps.elevate.run(`rm ${path}`)
      if (!r.ok) {
        throw new Error(r.cancelled ? ELEVATION_CANCELLED : `${ELEVATION_FAILED}: ${r.stderr ?? ''}`)
      }
      invalidate()
    },

    async lint(xml) {
      const r = await deps.runner.run('plutil', ['-lint', '-'], { input: xml })
      if (r.code === 0) return { ok: true, error: null }
      return { ok: false, error: (r.stderr || r.stdout).trim() || 'plutil lint failed' }
    },

    async removeWithBootout(scope, path, loaded, domain) {
      const sh = loaded ? `launchctl bootout ${domain} ${path}; rm -f ${path}` : `rm -f ${path}`
      const r = await deps.elevate.run(sh)
      if (!r.ok) {
        const tolerated = /No such process|not find|not loaded|No such file/.test(r.stderr ?? '')
        if (r.cancelled) throw new Error(ELEVATION_CANCELLED)
        if (!tolerated) throw new Error(`${ELEVATION_FAILED}: ${r.stderr ?? ''}`)
      }
      invalidate()
    },

    pathFor(scope, label) {
      const dir = dirs().find((d) => d.scope === scope)?.dir ?? ''
      return join(dir, `${label}.plist`)
    }
  }
}
