// 端口服务数据 store:demo services.js 状态部分(activeSvcFilter + svcData + BREW_MANAGED)
import { create } from 'zustand'
import type { ServicesListPayload } from '@shared/ipc'
import type { DockerContainer, PortService } from '@shared/models'
import type { SvcFilter } from '../data/ports'
import { dataSource } from '../data'

interface ServicesState {
  services: PortService[]
  containers: DockerContainer[]
  brewServices: string[]
  dockerAvailable: boolean
  polling: boolean
  error: string | null
  filter: SvcFilter
  loaded: boolean
  load(): Promise<void>
  applyPayload(p: ServicesListPayload): void
  setFilter(f: SvcFilter): void
  setPolling(enabled: boolean): Promise<void>
  setActive(active: boolean): Promise<void>
}

export const useServicesStore = create<ServicesState>((set, get) => ({
  services: [],
  containers: [],
  brewServices: [],
  dockerAvailable: false,
  polling: true,
  error: null,
  filter: 'all',
  loaded: false,

  async load() {
    const p = await dataSource().services.list()
    set({ ...p, error: null, loaded: true })
  },

  applyPayload(p) {
    set({ ...p, loaded: true })
  },

  setFilter(f) {
    set({ filter: f })
  },

  async setPolling(enabled) {
    const p = await dataSource().services.setPolling(enabled)
    set({ ...p, error: null })
  },

  async setActive(active) {
    await dataSource().services.setActive(active)
  }
}))
