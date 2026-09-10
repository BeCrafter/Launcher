// 端口服务数据 store:demo services.js 状态部分(activeSvcFilter + svcData + BREW_MANAGED)
import { create } from 'zustand'
import type { PortService } from '@shared/models'
import type { SvcFilter } from '../data/ports'
import { dataSource } from '../data'

interface ServicesState {
  services: PortService[]
  brewServices: string[]
  filter: SvcFilter
  loaded: boolean
  load(): Promise<void>
  setFilter(f: SvcFilter): void
}

export const useServicesStore = create<ServicesState>((set, get) => ({
  services: [],
  brewServices: [],
  filter: 'all',
  loaded: false,

  async load() {
    const { services, brewServices } = await dataSource().services.list()
    set({ services, brewServices, loaded: true })
  },

  setFilter(f) {
    set({ filter: f })
  }
}))
