// Agents 数据 store:demo agents.js 的状态部分(selectedAgent/activeFilter + 数据数组)
import { create } from 'zustand'
import type { Agent, InvalidPlist } from '@shared/models'
import type { AgentFilter } from '../data/ports'
import { dataSource } from '../data'

interface AgentsState {
  agents: Agent[]
  invalidPlists: InvalidPlist[]
  filter: AgentFilter
  selectedId: string | null
  loaded: boolean
  load(): Promise<void>
  setFilter(f: AgentFilter): void
  select(id: string): void
  toggle(id: string): Promise<void>
  brewAction(kind: 'start' | 'stop', id: string): Promise<void>
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: [],
  invalidPlists: [],
  filter: 'all',
  selectedId: null,
  loaded: false,

  async load() {
    const { agents, invalidPlists } = await dataSource().agents.list()
    set({
      agents,
      invalidPlists,
      loaded: true,
      // demo: let selectedAgent = agentData[0]
      selectedId: get().selectedId ?? agents[0]?.id ?? null
    })
  },

  setFilter(f) {
    set({ filter: f })
  },

  select(id) {
    set({ selectedId: id })
  },

  // demo toggleAgent:状态翻转 + toast 文案与 demo 一致(toast 在视图层调这里前发)
  async toggle(id) {
    const updated = await dataSource().agents.toggle(id)
    set({ agents: get().agents.map((a) => (a.id === updated.id ? { ...updated } : a)) })
  },

  async brewAction(kind, id) {
    await dataSource().agents.brewAction(kind, id)
    // demo brewAction 仅 toast,不改状态;toast 由视图层发起
  }
}))
