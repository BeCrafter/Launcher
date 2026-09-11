// Agents 门面服务(阶段 1):plist 扫描 + launchctl 状态 + brew 合并 → Agent 列表与操作
// 机制对齐开源 AgentStore/PlistService/LaunchctlService;BrewManagedSupport 合并规则见 brew-agent-service
// id 约定:`<scope>:<label>`(label 跨作用域可重名,id 唯一);草稿 id 同构,落盘发生在 save

import { ELEVATION_CANCELLED, ELEVATION_FAILED } from '../../shared/ipc'
import type { Agent, AgentForm, AgentScope, DrawerStatusModel, InvalidPlist, LogLine, OpsState } from '../../shared/models'
import { formFromPlist, plistFromForm } from '../domains/agent-form'
import { parseLogText } from '../domains/log-lines'
import { parsePlistXml, toPlistXml, type PlistDict } from '../domains/plist-xml'
import { matchBrewService, type BrewAgentService, type BrewServiceInfo } from './brew-agent-service'
import type { LaunchctlService } from './launchctl-service'
import type { PlistFile, PlistService } from './plist-service'
import type { ShellRunner } from './shell-runner'

export type OpAction = 'load' | 'unload' | 'enable' | 'disable' | 'kickstart'

export interface AgentXmlInfo {
  xml: string
  formMode: boolean
  unsupportedKeys: string[]
}

export interface AgentService {
  list(): Promise<{ agents: Agent[]; invalidPlists: InvalidPlist[] }>
  toggle(id: string): Promise<Agent>
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

export function createAgentService(deps: {
  runner: ShellRunner
  launchctl: LaunchctlService
  plists: PlistService
  brew: BrewAgentService
  getXmlIndent(): string
}): AgentService {
  const { runner, launchctl, plists, brew } = deps
  const drafts = new Map<string, Agent>() // 未落盘草稿(createDraft → save)

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

  function buildAgent(pf: PlistFile, entries: Map<string, { pid: number | null; lastExitCode: number | null }>, disabled: Set<string>, brews: BrewServiceInfo[], uptimes: Map<number, string>): Agent {
    const entry = entries.get(pf.label)
    const program = typeof pf.value.Program === 'string' ? pf.value.Program : Array.isArray(pf.value.ProgramArguments) ? String(pf.value.ProgramArguments[0] ?? '') : ''
    const brewInfo = matchBrewService(pf.label, program, brews, pf.path)
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
      isBrew: brewInfo !== null,
      isDisabledByOverride: disabled.has(pf.label)
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
    const [{ valid, invalid }, { entries, disabled }, brews] = await Promise.all([
      plists.scanAll(),
      launchctl.list(),
      brewList()
    ])
    const runningPids = valid
      .map((p) => entries.get(p.label)?.pid ?? null)
      .filter((p): p is number => p !== null)
    const uptimes = await uptimesFor(runningPids)
    const agents = valid.map((pf) => buildAgent(pf, entries, disabled, brews, uptimes))
    for (const draft of drafts.values()) agents.unshift({ ...draft })
    return { agents, invalidPlists: invalid }
  }

  async function currentAgent(id: string): Promise<Agent> {
    const { agents } = await listImpl()
    const a = agents.find((x) => x.id === id)
    if (!a) throw new Error(`agent not found: ${id}`)
    return a
  }

  async function opsStateFor(pf: PlistFile, label: string): Promise<OpsState> {
    const { entries, disabled } = await launchctl.list()
    const entry = entries.get(label)
    return {
      loaded: entry !== undefined,
      enabled: !disabled.has(label),
      running: entry?.pid !== null && entry?.pid !== undefined
    }
  }

  return {
    list: listImpl,

    async toggle(id) {
      const found = await findAgent(id)
      if (!found) throw new Error(`agent not found: ${id}`)
      const { entries } = await launchctl.list()
      const entry = entries.get(found.label)
      if (entry && entry.pid !== null) {
        // running → 停止:SIGTERM 轮询 + bootout(KeepAlive 兜底),达成 demo 的 stopped 语义
        await launchctl.stop(found.label, found.scope, entry.pid)
        await launchctl.bootout(found.pf.path, found.scope)
      } else if (entry) {
        // 已加载未运行(如一次性任务已退出)→ kickstart 启动(对已加载服务 bootstrap 会报 I/O error)
        await launchctl.kickstart(found.label, found.scope)
      } else {
        await launchctl.bootstrap(found.pf.path, found.scope)
      }
      return currentAgent(id)
    },

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
        const { entries } = await launchctl.list()
        if (entries.has(prevLabel)) await launchctl.bootout(found.pf.path, scope)
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
      const { entries } = await launchctl.list()
      const loaded = entries.has(found.label)
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
      if (action === 'load') await launchctl.bootstrap(found.pf.path, found.scope)
      else if (action === 'unload') await launchctl.bootout(found.pf.path, found.scope)
      else if (action === 'enable') await launchctl.enable(found.label, found.scope)
      else if (action === 'disable') await launchctl.disable(found.label, found.scope)
      else await launchctl.kickstart(found.label, found.scope)
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
      if (!found) throw new Error(`agent not found: ${id}`)
      const { entries, disabled } = await launchctl.list()
      const entry = entries.get(found.label)
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
      if (!found) throw new Error(`agent not found: ${id}`)
      if (source === 'system') {
        const r = await runner.run('/usr/bin/log', [
          'show',
          '--predicate',
          `subsystem == "${found.label}" OR process == "${found.label}"`,
          '--last',
          '15m',
          '--style',
          'compact'
        ])
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
