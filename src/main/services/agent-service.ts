// Agents 门面服务(阶段 1):plist 扫描 + launchctl 状态 → Agent 列表与操作
// 机制对齐开源 AgentStore/PlistService/LaunchctlService;isBrew 纯启发式判定(见 brew-heuristic),
// brew 数据只在 brewAction(用户显式启停)时按需拉取;BrewManagedSupport 合并规则见 brew-agent-service
// id 约定:`<scope>:<label>`(label 跨作用域可重名,id 唯一);草稿 id 同构,落盘发生在 save

import { existsSync } from 'node:fs'
import { ELEVATION_CANCELLED, ELEVATION_FAILED } from '../../shared/ipc'
import type { Agent, AgentForm, AgentScope, DrawerStatusModel, InvalidPlist, LogLine, OpsState } from '../../shared/models'
import type { MissingAgent } from '../../shared/ipc'
import { formFromPlist, plistFromForm } from '../domains/agent-form'
import { isBrewManaged } from '../domains/brew-heuristic'
import { parseLogText } from '../domains/log-lines'
import { parsePlistXml, toPlistXml, type PlistDict } from '../domains/plist-xml'
import { matchBrewService, type BrewAgentService, type BrewServiceInfo } from './brew-agent-service'
import type { LaunchctlService } from './launchctl-service'
import type { PlistFile, PlistService } from './plist-service'
import type { ShellRunner } from './shell-runner'

/** 意图动作(用户语义):启动 / 停止 / 重启 / 开机自启开停 / 立即执行一次 —— 顺序逻辑在 main 内部完成 */
export type OpAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable'

export interface AgentXmlInfo {
  xml: string
  formMode: boolean
  unsupportedKeys: string[]
}

export interface AgentService {
  list(): Promise<{ agents: Agent[]; invalidPlists: InvalidPlist[] }>
  brewAction(kind: 'start' | 'stop', id: string): Promise<Agent>
  createDraft(scope: AgentScope, label: string): Promise<Agent>
  save(id: string, patch: Partial<AgentForm> & { label: string; desc: string }): Promise<Agent>
  remove(id: string): Promise<void>
  clone(id: string): Promise<Agent>
  ops(id: string, action: OpAction): Promise<OpsState>
  readForm(id: string): Promise<AgentForm>
  readXml(id: string): Promise<AgentXmlInfo>
  saveXml(id: string, xml: string): Promise<void>
  readStatus(id: string): Promise<DrawerStatusModel>
  readLogs(id: string, source: 'file' | 'system'): Promise<LogLine[]>
  clearLogs(id: string): Promise<void>
  validateXml(xml: string): Promise<{ ok: boolean; error: string | null }>
  /** 删除无效 plist 文件(demo 横幅删除按钮真实化;作用域按路径判定) */
  removeInvalid(path: string): Promise<void>
  /** 定向复核:候选条目是否「仍被 launchctl 加载、但管理目录内 plist 已不存在」 */
  checkMissing(candidates: { scope: AgentScope; label: string }[]): Promise<MissingAgent[]>
  /** 该 agent 的日志文件路径(stdout 优先,其次 stderr;均无 → null) */
  logFilePath(id: string): Promise<string | null>
}

export const agentId = (scope: AgentScope, label: string): string => `${scope}:${label}`
export function parseAgentId(id: string): { scope: AgentScope; label: string } | null {
  const idx = id.indexOf(':')
  if (idx <= 0) return null
  const scope = id.slice(0, idx) as AgentScope
  if (scope !== 'user' && scope !== 'system' && scope !== 'daemon') return null
  return { scope, label: id.slice(idx + 1) }
}

const LOG_TAIL_BYTES = 512 * 1024
const SYSTEM_LOG_MAX_LINES = 2000

/** `launchctl.list()` 的返回形状(域表 + per-domain 覆盖位) */
interface LaunchctlTables {
  gui: Map<string, { label: string; pid: number | null; lastExitCode: number | null }>
  system: Map<string, { label: string; pid: number | null; lastExitCode: number | null }>
  disabled: { gui: Set<string>; system: Set<string> }
}

export function createAgentService(deps: {
  runner: ShellRunner
  launchctl: LaunchctlService
  plists: PlistService
  brew: BrewAgentService
  getXmlIndent(): string
}): AgentService {
  const { runner, launchctl, plists, brew } = deps
  const drafts = new Map<string, Agent>() // 未落盘草稿(createDraft → save)

  /** gui 域(用户态 list)与 system 域(`print system` 服务表)按作用域取用 */
  const tableFor = (tables: LaunchctlTables, scope: AgentScope): LaunchctlTables['gui'] =>
    scope === 'daemon' ? tables.system : tables.gui

  /** print-disabled 覆盖位按作用域取用(域映射与 tableFor/domainOf 一致:system 作用域也属 gui 域) */
  const disabledFor = (tables: { disabled: { gui: Set<string>; system: Set<string> } }, scope: AgentScope): Set<string> =>
    scope === 'daemon' ? tables.disabled.system : tables.disabled.gui

  async function brewList(): Promise<BrewServiceInfo[]> {
    return brew.list().catch(() => [])
  }

  /** 批量 ps 补充运行中 pid 的 uptime(一次调用) */
  async function uptimesFor(pids: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>()
    if (pids.length === 0) return out
    const r = await runner.run('ps', ['-p', pids.join(','), '-o', 'pid=,etime='])
    for (const line of r.stdout.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(\S+)\s*$/)
      if (m) out.set(Number.parseInt(m[1], 10), etimeToText(m[2]))
    }
    return out
  }

  function etimeToText(etime: string): string {
    if (/\d+-\d+/.test(etime)) {
      const m = etime.match(/(\d+)-(\d+)/)!
      return `${m[1]}d ${m[2]}h`
    }
    const parts = etime.split(':')
    if (parts.length === 3) return `${Number(parts[0])}h ${Number(parts[1])}m`
    if (parts.length === 2) return `${Number(parts[0])}m`
    return etime
  }

  function buildAgent(pf: PlistFile, entries: Map<string, { pid: number | null; lastExitCode: number | null }>, tables: LaunchctlTables, uptimes: Map<number, string>): Agent {
    const entry = entries.get(pf.label)
    const program = typeof pf.value.Program === 'string' ? pf.value.Program : Array.isArray(pf.value.ProgramArguments) ? String(pf.value.ProgramArguments[0] ?? '') : ''
    return {
      id: agentId(pf.scope, pf.label),
      label: pf.label,
      desc: pf.desc,
      status: entry ? (entry.pid !== null ? 'running' : 'loaded') : 'stopped',
      pid: entry?.pid ?? null,
      uptime: entry?.pid ? (uptimes.get(entry.pid) ?? null) : null,
      scope: pf.scope,
      tags: [],
      program,
      exitCode: entry?.lastExitCode ?? null,
      restarts: 0,
      isBrew: isBrewManaged(pf.label, program),
      isDisabledByOverride: disabledFor(tables, pf.scope).has(pf.label)
    }
  }

  async function findAgent(id: string): Promise<{ scope: AgentScope; label: string; pf: PlistFile } | null> {
    const parsed = parseAgentId(id)
    if (!parsed) return null
    const { valid } = await plists.scanAll()
    const pf = valid.find((p) => p.scope === parsed.scope && p.label === parsed.label)
    return pf ? { ...parsed, pf } : null
  }

  async function listImpl(): Promise<{ agents: Agent[]; invalidPlists: InvalidPlist[] }> {
    // brew 不在关键路径(brew services list 实测 11-13s):isBrew 用纯启发式判定,机制同源开源 AgentStore
    const [{ valid, invalid }, tables] = await Promise.all([plists.scanAll(), launchctl.list()])
    const runningPids = valid
      .map((p) => tableFor(tables, p.scope).get(p.label)?.pid ?? null)
      .filter((p): p is number => p !== null)
    const uptimes = await uptimesFor(runningPids)
    const agents = valid.map((pf) => buildAgent(pf, tableFor(tables, pf.scope), tables, uptimes))
    // 草稿(未落盘)不占列表行:保存后经 reload 出现
    return { agents, invalidPlists: invalid }
  }

  async function currentAgent(id: string): Promise<Agent> {
    const { agents } = await listImpl()
    const a = agents.find((x) => x.id === id)
    if (!a) throw new Error(`agent not found: ${id}`)
    return a
  }

  async function opsStateFor(pf: PlistFile, label: string): Promise<OpsState> {
    const tables = await launchctl.list()
    const entry = tableFor(tables, pf.scope).get(label)
    return {
      loaded: entry !== undefined,
      enabled: !disabledFor(tables, pf.scope).has(label),
      running: entry?.pid !== null && entry?.pid !== undefined
    }
  }

  /**
   * 意图动作:顺序逻辑集中在此层,UI 不再拼命令序列,也不需要因顺序问题置灰按钮。
   * 三个 launchd 维度(bootstrap/bootout · enable/disable · kickstart/kill)对用户不可见。
   */

  /** 启动:确保「已启用 → 已载入 → 运行中」——按需跳过已满足的步骤,结果确定为"正在运行" */
  async function intentStart(pf: PlistFile, tables: LaunchctlTables): Promise<void> {
    if (disabledFor(tables, pf.scope).has(pf.label)) {
      // launchd 硬约束:disable 阻塞 bootstrap,不启用无法载入 → 连带开启开机自启(UI 会可见地翻开关)
      await launchctl.enable(pf.label, pf.scope)
    }
    let entry = tableFor(tables, pf.scope).get(pf.label)
    if (entry === undefined) {
      await launchctl.bootstrap(pf.path, pf.scope)
      entry = tableFor(await launchctl.list(), pf.scope).get(pf.label)
    }
    // 载入后仍未运行(任务无 RunAtLoad/等触发条件)→ kickstart,让「启动」名副其实
    if (entry === undefined || entry.pid === null) {
      await launchctl.kickstart(pf.label, pf.scope)
    }
  }

  /** 停止:移出 launchd(进程随之终止,且不会被 KeepAlive 拉起);不改动「开机自启」 */
  async function intentStop(pf: PlistFile): Promise<void> {
    await launchctl.bootout(pf.path, pf.scope)
  }

  /** 重启:运行中 → kickstart -k(先杀再起);未载入 → 走启动序列 */
  async function intentRestart(pf: PlistFile, tables: LaunchctlTables): Promise<void> {
    const entry = tableFor(tables, pf.scope).get(pf.label)
    if (entry !== undefined && entry.pid !== null) {
      await launchctl.kickstart(pf.label, pf.scope, { kill: true })
      return
    }
    await intentStart(pf, tables)
  }

  return {
    list: listImpl,

    async brewAction(kind, id) {
      const found = await findAgent(id)
      if (!found) throw new Error(`agent not found: ${id}`)
      const before = await currentAgent(id).catch(() => null)
      const brews = await brewList()
      const program = typeof found.pf.value.Program === 'string' ? found.pf.value.Program : ''
      const info = matchBrewService(found.label, program, brews, found.pf.path)
      if (!info) throw new Error(`not a brew-managed service: ${id}`)
      await brew.action(kind, info)
      // brew 的 stop 会移除 plist(条目从列表消失)→ 容错返回动作前状态并修正 status
      try {
        return await currentAgent(id)
      } catch {
        return { ...(before as Agent), status: kind === 'start' ? 'running' : 'stopped', pid: null, uptime: null }
      }
    },

    async createDraft(scope, label) {
      const draft: Agent = {
        id: agentId(scope, label),
        label,
        desc: '',
        status: 'stopped',
        pid: null,
        uptime: null,
        scope,
        tags: [],
        program: '',
        exitCode: null,
        restarts: 0
      }
      drafts.set(draft.id, draft)
      return { ...draft }
    },

    async save(id, patch) {
      const found = await findAgent(id)
      const parsed = parseAgentId(id)
      if (!parsed) throw new Error(`invalid agent id: ${id}`)
      const scope = found?.scope ?? parsed.scope
      const prevLabel = found?.label ?? parsed.label
      const baseValue: PlistDict = found ? found.pf.value : { Label: patch.label }
      const baseDesc = found?.pf.desc ?? ''
      const mapping = formFromPlist(baseValue, baseDesc)
      const merged: AgentForm = {
        ...mapping.form,
        ...patch,
        label: patch.label,
        desc: patch.desc,
        triggers: { ...mapping.form.triggers, ...(patch.triggers ?? {}) },
        keepAliveDict: { ...mapping.form.keepAliveDict, ...(patch.keepAliveDict ?? {}) }
      }
      const value = plistFromForm(merged)
      const xml = toPlistXml(value, { indent: deps.getXmlIndent(), desc: patch.desc })
      const newPath = plists.pathFor(scope, patch.label)

      if (found && newPath !== found.pf.path) {
        await plists.write(scope, newPath, xml)
        if (tableFor(await launchctl.list(), found.scope).has(prevLabel)) {
          await launchctl.bootout(found.pf.path, scope)
        }
        await plists.remove(scope, found.pf.path)
      } else if (found) {
        await plists.write(scope, found.pf.path, xml)
      } else {
        await plists.write(scope, newPath, xml)
      }
      drafts.delete(id)
      return currentAgent(agentId(scope, patch.label))
    },

    async remove(id) {
      const found = await findAgent(id)
      drafts.delete(id)
      if (!found) return
      const loaded = tableFor(await launchctl.list(), found.scope).has(found.label)
      if (found.scope !== 'user') {
        // 合并提权:一条命令完成 bootout + rm(开源同款),避免二次授权
        await plists.removeWithBootout(found.scope, found.pf.path, loaded, launchctl.domainOf(found.scope))
        return
      }
      if (loaded) await launchctl.bootout(found.pf.path, found.scope)
      await plists.remove(found.scope, found.pf.path)
    },

    async clone(id) {
      const found = await findAgent(id)
      if (!found) throw new Error(`agent not found: ${id}`)
      const { valid } = await plists.scanAll()
      const existing = new Set(valid.map((p) => p.label))
      let newLabel = `${found.label}.copy`
      let n = 1
      while (existing.has(newLabel)) {
        n += 1
        newLabel = `${found.label}.copy${n}`
      }
      const value: PlistDict = { ...found.pf.value, Label: newLabel }
      const xml = toPlistXml(value, { indent: deps.getXmlIndent(), desc: found.pf.desc })
      await plists.write(found.scope, plists.pathFor(found.scope, newLabel), xml)
      return currentAgent(agentId(found.scope, newLabel))
    },

    async ops(id, action) {
      const found = await findAgent(id)
      if (!found) throw new Error(`agent not found: ${id}`)
      const tables = await launchctl.list()
      if (action === 'start') await intentStart(found.pf, tables)
      else if (action === 'stop') await intentStop(found.pf)
      else if (action === 'restart') await intentRestart(found.pf, tables)
      else if (action === 'enable') await launchctl.enable(found.label, found.scope) // 开机自启:开
      else await launchctl.disable(found.label, found.scope) // 开机自启:关
      return opsStateFor(found.pf, found.label)
    },

    async readForm(id) {
      const found = await findAgent(id)
      if (!found) {
        const draft = drafts.get(id)
        if (draft) return formFromPlist({ Label: draft.label }, draft.desc).form
        throw new Error(`agent not found: ${id}`)
      }
      return formFromPlist(found.pf.value, found.pf.desc).form
    },

    async readXml(id) {
      const found = await findAgent(id)
      if (!found) {
        const draft = drafts.get(id)
        if (!draft) throw new Error(`agent not found: ${id}`)
        const xml = toPlistXml({ Label: draft.label }, { indent: deps.getXmlIndent(), desc: draft.desc })
        return { xml, formMode: true, unsupportedKeys: [] }
      }
      const mapping = formFromPlist(found.pf.value, found.pf.desc)
      return { xml: found.pf.xml, formMode: !mapping.xmlFallback, unsupportedKeys: mapping.unsupportedKeys }
    },

    async saveXml(id, xml) {
      const lint = await plists.lint(xml)
      if (!lint.ok) throw new Error(`plist 校验失败: ${lint.error}`)
      const found = await findAgent(id)
      const parsed = parseAgentId(id)
      if (!parsed) throw new Error(`invalid agent id: ${id}`)
      const scope = found?.scope ?? parsed.scope
      const target = found?.pf.path ?? plists.pathFor(scope, parsed.label)
      await plists.write(scope, target, xml)
    },

    async readStatus(id) {
      const found = await findAgent(id)
      if (!found) {
        // 草稿:返回零值状态,抽屉「状态」tab 可正常打开(尚无运行时)
        const draft = drafts.get(id)
        const parsed = parseAgentId(id)
        if (!draft || !parsed) throw new Error(`agent not found: ${id}`)
        return {
          state: 'stopped',
          pid: null,
          uptime: null,
          cpu: '0%',
          cpuWidth: '0%',
          mem: '0%',
          memWidth: '0%',
          exitCode: null,
          restarts: 0,
          startTime: '-',
          plistPath: plists.pathFor(parsed.scope, draft.label),
          workDir: '',
          scope: parsed.scope
        }
      }
      const tables = await launchctl.list()
      const entry = tableFor(tables, found.scope).get(found.label)
      const info = entry ? await launchctl.print(found.label, found.scope) : null
      let cpu = '0%'
      let mem = '0%'
      let startTime = '-'
      if (entry?.pid) {
        const r = await runner.run('ps', ['-p', String(entry.pid), '-o', '%cpu=,%mem=,lstart='])
        const line = r.stdout.trim()
        const m = line.match(/^([\d.]+)\s+([\d.]+)\s+(.*)$/)
        if (m) {
          cpu = `${Number(m[1]).toFixed(1)}%`
          mem = `${Number(m[2]).toFixed(1)}%`
          startTime = m[3].trim()
        }
      }
      const state: Agent['status'] = entry ? (entry.pid !== null ? 'running' : 'loaded') : 'stopped'
      return {
        state,
        pid: entry?.pid ?? null,
        uptime: entry?.pid ? (await uptimesFor([entry.pid])).get(entry.pid) ?? null : null,
        cpu,
        cpuWidth: `${Math.min(100, Number.parseFloat(cpu) || 0)}%`,
        mem,
        memWidth: `${Math.min(100, (Number.parseFloat(mem) || 0) * 10)}%`,
        exitCode: info?.lastExitCode ?? entry?.lastExitCode ?? null,
        restarts: info?.runs ?? 0,
        startTime,
        plistPath: found.pf.path,
        workDir: info?.workingDirectory ?? (typeof found.pf.value.WorkingDirectory === 'string' ? found.pf.value.WorkingDirectory : ''),
        scope: found.scope
      }
    },

    async readLogs(id, source) {
      const found = await findAgent(id)
      if (!found) {
        if (drafts.has(id)) return [] // 草稿尚无日志
        throw new Error(`agent not found: ${id}`)
      }
      if (source === 'system') {
        // log show 实测 2.8-31.8s 高度波动,必超默认 cmdTimeout(10s) → 显式放宽(每调用覆盖)
        const r = await runner.run('/usr/bin/log', [
          'show',
          '--predicate',
          `subsystem == "${found.label}" OR process == "${found.label}"`,
          '--last',
          '15m',
          '--style',
          'compact'
        ], { timeoutMs: 45_000 })
        const lines = r.stdout
          .split('\n')
          .filter((l) => l.trim() !== '' && !l.startsWith('Timestamp') && !/^-+$/.test(l.trim()))
        const capped = lines.slice(-SYSTEM_LOG_MAX_LINES)
        return capped.map((text) => ({ ts: extractTs(text), type: classify(text), text: stripTs(text) }))
      }
      const outPath = typeof found.pf.value.StandardOutPath === 'string' ? found.pf.value.StandardOutPath : ''
      const errPath = typeof found.pf.value.StandardErrorPath === 'string' ? found.pf.value.StandardErrorPath : ''
      const target = outPath !== '' ? outPath : errPath
      if (target === '') return []
      const chunks: LogLine[] = []
      for (const p of [outPath, errPath].filter((x) => x !== '')) {
        try {
          const { promises: fsp } = await import('node:fs')
          const st = await fsp.stat(p)
          if (st.size === 0) continue
          const start = Math.max(0, st.size - LOG_TAIL_BYTES)
          const fh = await fsp.open(p, 'r')
          try {
            const buf = Buffer.alloc(st.size - start)
            await fh.read(buf, 0, buf.length, start)
            let text = buf.toString('utf8')
            if (start > 0) text = text.slice(text.indexOf('\n') + 1)
            chunks.push(...parseLogText(text, formatTs(st.mtime), SYSTEM_LOG_MAX_LINES))
          } finally {
            await fh.close()
          }
        } catch {
          /* 文件不存在 */
        }
      }
      return chunks
    },

    async clearLogs(id) {
      const found = await findAgent(id)
      if (!found) throw new Error(`agent not found: ${id}`)
      const { promises: fsp } = await import('node:fs')
      for (const key of ['StandardOutPath', 'StandardErrorPath']) {
        const p = found.pf.value[key]
        if (typeof p === 'string' && p !== '') await fsp.writeFile(p, '', 'utf8').catch(() => {})
      }
    },

    async validateXml(xml) {
      return plists.lint(xml)
    },

    async logFilePath(id) {
      const found = await findAgent(id)
      if (!found) return null
      const out = typeof found.pf.value.StandardOutPath === 'string' ? found.pf.value.StandardOutPath : ''
      const err = typeof found.pf.value.StandardErrorPath === 'string' ? found.pf.value.StandardErrorPath : ''
      const preferred = out !== '' ? out : err
      if (preferred !== '' && existsSync(preferred)) return preferred
      if (err !== '' && existsSync(err)) return err
      return preferred !== '' ? preferred : null
    },

    async checkMissing(candidates) {
      const dirs = plists.dirs()
      const out: MissingAgent[] = []
      for (const c of candidates) {
        const info = await launchctl.print(c.label, c.scope)
        if (!info.found) continue // 已不在 launchd 中(普通移除,非孤儿)
        const path = info.path ?? ''
        if (path === '') continue
        // 仅关心三个管理目录内的服务:辅助进程(ShipIt 等)的 print path 为 submitted/系统目录,天然被过滤
        if (!dirs.some((d) => path.startsWith(`${d.dir}/`))) continue
        if (existsSync(path)) continue // 文件仍在(如重命名/移动)→ 非孤儿
        out.push({ label: c.label, scope: c.scope, path, pid: info.pid })
      }
      return out
    },

    async removeInvalid(path) {
      // 作用域按「目录前缀」判定(注意:用户路径也含 /Library/LaunchAgents/,不能只做 includes)
      const dir = plists.dirs().find((d) => path.startsWith(`${d.dir}/`))
      await plists.remove(dir?.scope ?? 'user', path)
    }
  }
}

function extractTs(line: string): string {
  const m = line.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/)
  return m ? `${m[1]} ${m[2]}` : ''
}

function stripTs(line: string): string {
  return line.replace(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*/, '')
}

function classify(text: string): LogLine['type'] {
  if (/(error|fail|fatal|exception|denied|traceback)/i.test(text)) return 'err'
  if (/warn/i.test(text)) return 'warn'
  if (/(\bok\b|success|done|complete)/i.test(text)) return 'ok'
  return 'info'
}

function formatTs(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
