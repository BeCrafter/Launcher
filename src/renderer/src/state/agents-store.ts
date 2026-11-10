// Agents 数据 store:demo agents.js 的状态部分(selectedAgent/activeFilter + 数据数组)
import { create } from 'zustand'
import type { Agent, AgentRuntimePayload } from '@shared/models'
import type { MissingAgent } from '@shared/ipc'
import type { AgentFilter, AgentStatusFilter } from '../data/ports'
import type { AgentIntent } from '../lib/agent-ops'
import { dataSource } from '../data'

/** 抽屉状态页用。卡片不读这三项。 */
export interface AgentProcExtra {
  cpu: string | null
  mem: string | null
  startTime: string | null
}

interface AgentsState {
  agents: Agent[]
  /** 最近一次整表的代数。比它旧的运行态快照丢掉。 */
  epoch: number
  /** 按 id 的 cpu/mem/启动时间。快照合并进来,整表刷新时清掉缺席的。 */
  procExtras: Record<string, AgentProcExtra>
  /** 这一条正在做的意图。点下去就写上,结束或取消才清,用来挡住连点。 */
  working: Record<string, AgentIntent>
  beginWork(id: string, action: AgentIntent): void
  endWork(id: string): void
  /** 已加载但 plist 已不存在的孤儿(定向复核;refresh 时 diff 出消失条目后核对) */
  missingPlists: MissingAgent[]
  filter: AgentFilter
  /** 运行状态筛选(与 filter 是「与」关系,可叠加) */
  statusFilter: AgentStatusFilter
  selectedId: string | null
  loaded: boolean
  loadVersion: number
  load(): Promise<void>
  /** 合并一次运行态快照。不换整表,不复核孤儿 plist。 */
  applyRuntime(payload: AgentRuntimePayload): void
  setFilter(f: AgentFilter): void
  setStatusFilter(f: AgentStatusFilter): void
  select(id: string): void
  brewAction(kind: 'start' | 'stop', id: string): Promise<void>
  // 新建/导入统一落点(demo openAgentDraft):以给定 label 建草稿、入列表顶并选中
  createDraft(scope: 'user' | 'system' | 'daemon', label: string): Promise<Agent>
}

const RUNTIME_KEYS = ['status', 'pid', 'uptime', 'exitCode', 'isDisabledByOverride'] as const

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: [],
  epoch: 0,
  procExtras: {},
  working: {},
  missingPlists: [],
  filter: 'all',
  statusFilter: 'all',
  selectedId: null,
  loaded: false,
  loadVersion: 0,

  async load() {
    const loadVersion = get().loadVersion + 1
    set({ loadVersion })
    const prev = get().agents
    const { agents, epoch } = await dataSource().agents.list()
    if (get().loadVersion !== loadVersion) return
    const keep = new Set(agents.map((a) => a.id))
    const procExtras: Record<string, AgentProcExtra> = {}
    for (const [id, extra] of Object.entries(get().procExtras)) {
      if (keep.has(id)) procExtras[id] = extra
    }
    set({
      agents,
      epoch,
      procExtras,
      loaded: true,
      // demo: let selectedAgent = agentData[0]
      selectedId: get().selectedId ?? agents[0]?.id ?? null
    })
    // 孤儿定向复核(粘性):候选 = 本次刷新消失的条目 ∪ 上次已命中的孤儿;
    // 复核仍命中则横幅保持,已处理(bootout/重建)→ 自动清空。
    // 非任务/损坏文件没有 launchd 身份(label 为空),不参与复核
    try {
      const candidates = new Map<string, { scope: Agent['scope']; label: string }>()
      for (const pv of prev) {
        if (pv.isNotTask || pv.label === '') continue
        if (!agents.some((n) => n.id === pv.id)) candidates.set(pv.id, { scope: pv.scope, label: pv.label })
      }
      for (const m of get().missingPlists) candidates.set(`${m.scope}:${m.label}`, { scope: m.scope, label: m.label })
      if (candidates.size === 0) {
        if (get().missingPlists.length > 0) set({ missingPlists: [] })
        return
      }
      const missing = await dataSource().agents.checkMissing([...candidates.values()])
      if (get().loadVersion === loadVersion) set({ missingPlists: missing })
    } catch {
      /* 复核失败不阻断列表 */
    }
  },

  applyRuntime(payload) {
    if (payload.epoch < get().epoch) return
    const byId = new Map(payload.rows.map((row) => [row.id, row]))
    const prev = get().agents
    let agents = prev
    let changed = false
    const nextAgents = prev.map((agent) => {
      const row = byId.get(agent.id)
      if (!row) return agent
      const same = RUNTIME_KEYS.every((key) => agent[key] === row[key])
      if (same) return agent
      changed = true
      return {
        ...agent,
        status: row.status,
        pid: row.pid,
        uptime: row.uptime,
        exitCode: row.exitCode,
        isDisabledByOverride: row.isDisabledByOverride
      }
    })
    if (changed) agents = nextAgents
    const procExtras = { ...get().procExtras }
    let extrasChanged = false
    for (const row of payload.rows) {
      const cur = procExtras[row.id]
      if (cur && cur.cpu === row.cpu && cur.mem === row.mem && cur.startTime === row.startTime) continue
      procExtras[row.id] = { cpu: row.cpu, mem: row.mem, startTime: row.startTime }
      extrasChanged = true
    }
    if (!changed && !extrasChanged) return
    set(extrasChanged ? { agents, procExtras } : { agents })
  },

  beginWork(id, action) {
    if (get().working[id]) return
    set({ working: { ...get().working, [id]: action } })
  },

  endWork(id) {
    if (!get().working[id]) return
    const working = { ...get().working }
    delete working[id]
    set({ working })
  },

  setFilter(f) {
    set({ filter: f })
  },

  setStatusFilter(f) {
    set({ statusFilter: f })
  },

  select(id) {
    set({ selectedId: id })
  },

  async brewAction(kind, id) {
    await dataSource().agents.brewAction(kind, id)
    // demo brewAction 仅 toast,不改状态;toast 由视图层发起
  },

  // demo openAgentDraft:草稿 unshift 到列表顶 + 选中
  async createDraft(scope, labelPrefix) {
    // 草稿不占列表行(保存落盘后经 reload 出现);仅置选中态,由调用方打开抽屉
    const draft = await dataSource().agents.createDraft(scope, labelPrefix)
    set({ selectedId: draft.id })
    return draft
  }
}))
