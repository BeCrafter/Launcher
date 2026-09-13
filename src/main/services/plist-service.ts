// plist 执行层(阶段 1;机制对齐开源 PlistService)
// - 三个作用域目录:user=~/Library/LaunchAgents;system=/Library/LaunchAgents;daemon=/Library/LaunchDaemons
// - 读取:二进制 plist 经 plutil 转 XML。
//   **每个 .plist 恰好产出一条记录**:解析失败 → isTask=false + parseError(原文保留供 XML 修复);
//   合法 plist 但未定义任务(缺 Label / 非字符串 Label,如 Google keystone 的空 <dict/>)→ isTask=false。
//   两者都必须在列表里可见并置灰可编辑 —— 文件在磁盘上存在却在 UI 上消失,用户无从区分「不存在」与「被过滤」
//   (2026-09-11 曾是静默跳过,2026-09-13 用户要求改为可见)。
// - 写入:用户级 原子写(tmp+rename);提权级 临时文件 → 提权 mv && chown root:wheel && chmod 644
//   覆盖守卫:目标已存在时仅允许覆盖「非任务占位(缺 Label 且可解析)」或「同名任务自身」,其余拒绝
//   (损坏文件同样拒绝 —— 它可能是别人的任务);writeAt 为无守卫变体,仅用于用户已显式指向该文件的原地编辑
// - 校验:plutil -lint(stdin),与系统口径一致

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { ELEVATION_CANCELLED, ELEVATION_FAILED } from '../../shared/ipc'
import type { AgentScope } from '../../shared/models'
import { extractPlistDesc, parsePlistXml, type PlistDict } from '../domains/plist-xml'
import type { ElevationExecutor } from './elevation'
import type { ShellRunner } from './shell-runner'

export interface PlistFile {
  path: string
  scope: AgentScope
  fileName: string
  /** plist 原文(XML);解析失败时为可编辑原文,二进制不可读时为空串 */
  xml: string
  /** 解析成功时的字典;解析失败为空对象 */
  value: PlistDict
  /** launchd 任务标识;非任务文件为空串 */
  label: string
  desc: string
  /** label 非空 → 是 launchd 任务;false → 非任务文件(列表内置灰,不可启停,可编辑/删除) */
  isTask: boolean
  /** 解析失败原因(仅损坏文件),供 UI 展示 */
  parseError?: string
}

export interface PlistService {
  dirs(): { scope: AgentScope; dir: string; privileged: boolean }[]
  scanAll(): Promise<PlistFile[]>
  /** 失效 scanAll 记忆(launchd 目录被应用外修改时由 fsevents applier 调用) */
  invalidate(): void
  read(scope: AgentScope, path: string): Promise<PlistFile>
  write(scope: AgentScope, path: string, xml: string): Promise<void>
  /** 写入指定文件、跳过覆盖守卫:仅用于调用方已显式指向该文件的原地编辑(占位/损坏文件修复) */
  writeAt(scope: AgentScope, path: string, xml: string): Promise<void>
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
  let memo: { at: number; result: PlistFile[] } | null = null
  let pending: Promise<PlistFile[]> | null = null

  const invalidate = (): void => {
    memo = null
  }

  /**
   * 解析单个 plist,**永不抛错、永不丢弃**:每个文件都要产出一条记录。
   * 解析失败 → isTask=false + parseError(保留原文供 XML 修复);
   * 合法 plist 但未定义任务(缺 Label / 非字符串 Label)→ isTask=false。
   */
  async function readFile(scope: AgentScope, path: string): Promise<PlistFile> {
    const fileName = basename(path)
    const failed = (reason: string, xml = ''): PlistFile => ({
      path,
      scope,
      fileName,
      xml,
      value: {},
      label: '',
      desc: '',
      isTask: false,
      parseError: reason
    })
    let raw: string
    try {
      raw = await fs.readFile(path, 'utf8')
    } catch (err) {
      return failed(err instanceof Error ? err.message : String(err))
    }
    let xml = raw
    if (raw.startsWith(BPLIST_MAGIC)) {
      const r = await deps.runner.run('plutil', ['-convert', 'xml1', '-o', '-', path])
      // 二进制 plist 转换失败时原文不是可编辑文本 → 不交给 XML 编辑器(给空串让用户重写)
      if (r.code !== 0) return failed(`plutil convert failed: ${r.stderr || r.code}`)
      xml = r.stdout
    }
    const parsed = parsePlistXml(xml)
    if (!parsed.ok) return failed(parsed.error, xml)
    // typeof 守卫会把非字符串 Label(integer/array)一并压成空串 —— 与缺 Label 同归 isTask=false,但都保留在列表里
    const label = typeof parsed.value.Label === 'string' ? parsed.value.Label : ''
    return { path, scope, fileName, xml, value: parsed.value, label, desc: extractPlistDesc(xml), isTask: label !== '' }
  }

  /**
   * 覆盖守卫:目标已存在时只允许两种覆盖 ——
   *   ① 目标是可解析的非任务占位(缺 Label 的合法文件,如 Google keystone 的 <dict/>)→ 可覆盖
   *   ② 目标是本次要写的同一任务(Label 相同)→ 正常更新
   * 其余(已有他人任务、或损坏无法解析)一律拒绝,避免新建/改名静默清掉别人的任务。
   * ⚠ 损坏文件的 isTask 也是 false,故①必须连同「可解析」一起判,否则损坏文件会被静默覆盖。
   */
  async function assertOverwritable(scope: AgentScope, path: string, incomingLabel: string): Promise<void> {
    try {
      await fs.access(path)
    } catch {
      return // 目标不存在 → 可直接写
    }
    const existing = await readFile(scope, path)
    if (!existing.isTask && !existing.parseError) return // ① 非任务占位(标签为空且可解析)
    if (existing.isTask && existing.label === incomingLabel) return // ② 同名任务自身
    throw new Error(
      existing.parseError
        ? `目标文件已存在但无法解析,拒绝覆盖: ${path}(${existing.parseError})`
        : `目标文件已被任务「${existing.label}」占用,拒绝覆盖: ${path}`
    )
  }

  async function scanAllImpl(): Promise<PlistFile[]> {
    const files: PlistFile[] = []
    for (const { scope, dir } of dirs()) {
      let names: string[]
      try {
        names = await fs.readdir(dir)
      } catch {
        continue // 目录不存在(如 /Library/LaunchDaemons 在极简系统)
      }
      for (const name of names) {
        if (!name.endsWith('.plist')) continue
        files.push(await readFile(scope, join(dir, name)))
      }
    }
    return files
  }

  function scanAll(): Promise<PlistFile[]> {
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

  /** 原子写本体(无覆盖守卫)。调用方必须已明确指向该文件:占位/损坏文件的原地编辑,或 write() 守卫通过后的写入 */
  async function writeAt(scope: AgentScope, path: string, xml: string): Promise<void> {
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
  }

  return {
    dirs,

    scanAll,

    invalidate,

    // 公开入口按「必须是一个任务」语义:非任务文件视为不可读(scanAll 才把它们交给列表)
    async read(scope, path) {
      const pf = await readFile(scope, path)
      if (!pf.isTask) throw new Error(`plist 未定义任务(缺少 Label): ${path}`)
      return pf
    },

    async write(scope, path, xml) {
      const parsed = parsePlistXml(xml)
      if (!parsed.ok) throw new Error(`拒绝写入非法 plist: ${parsed.error}`)
      const incomingLabel = typeof parsed.value.Label === 'string' ? parsed.value.Label : ''
      await assertOverwritable(scope, path, incomingLabel)
      await writeAt(scope, path, xml)
    },

    writeAt,

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
