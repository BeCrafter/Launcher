// Agents 数据 store:demo agents.js 的状态部分(selectedAgent/activeFilter + 数据数组)
import { create } from 'zustand'
import type { Agent, InvalidPlist } from '@shared/models'
import type { MissingAgent } from '@shared/ipc'
import type { AgentFilter } from '../data/ports'
import { dataSource } from '../data'

interface AgentsState {
  agents: Agent[]
  invalidPlists: InvalidPlist[]
  /** 已加载但 plist 已不存在的孤儿(定向复核;refresh 时 diff 出消失条目后核对) */
  missingPlists: MissingAgent[]
  filter: AgentFilter
  selectedId: string | null
  loaded: boolean
  load(): Promise<void>
  setFilter(f: AgentFilter): void
  select(id: string): void
  brewAction(kind: 'start' | 'stop', id: string): Promise<void>
  // 新建/导入统一落点(demo openAgentDraft):以给定 label 建草稿、入列表顶并选中
  createDraft(scope: 'user' | 'system' | 'daemon', label: string): Promise<Agent>
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: [],
  invalidPlists: [],
  missingPlists: [],
  filter: 'all',
  selectedId: null,
  loaded: false,

  async load() {
    const prev = get().agents
    const { agents, invalidPlists } = await dataSource().agents.list()
    set({
      agents,
      invalidPlists,
      loaded: true,
      // demo: let selectedAgent = agentData[0]
      selectedId: get().selectedId ?? agents[0]?.id ?? null
    })
    // 孤儿定向复核(粘性):候选 = 本次刷新消失的条目 ∪ 上次已命中的孤儿;
    // 复核仍命中则横幅保持,已处理(bootout/重建)→ 自动清空
    try {
      const candidates = new Map<string, { scope: Agent['scope']; label: string }>()
      for (const pv of prev) {
        if (!agents.some((n) => n.id === pv.id)) candidates.set(pv.id, { scope: pv.scope, label: pv.label })
      }
      for (const m of get().missingPlists) candidates.set(`${m.scope}:${m.label}`, { scope: m.scope, label: m.label })
      if (candidates.size === 0) {
        if (get().missingPlists.length > 0) set({ missingPlists: [] })
        return
      }
      const missing = await dataSource().agents.checkMissing([...candidates.values()])
      set({ missingPlists: missing })
    } catch {
      /* 复核失败不阻断列表 */
    }
  },

  setFilter(f) {
    set({ filter: f })
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
