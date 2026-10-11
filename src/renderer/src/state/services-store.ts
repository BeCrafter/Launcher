// 端口服务数据 store:demo services.js 状态部分(activeSvcFilter + svcData + BREW_MANAGED)
import { create } from 'zustand'
import type { ServicesListPayload } from '@shared/ipc'
import type { DockerContainer, DockerUnavailableReason, PortService } from '@shared/models'
import type { SvcFilter } from '../data/ports'
import { dataSource } from '../data'

interface ServicesState {
  services: PortService[]
  containers: DockerContainer[]
  brewServices: string[]
  dockerAvailable: boolean
  /** dockerAvailable 为 false 时的原因(UI 据此区分提示文案) */
  dockerReason: DockerUnavailableReason | null
  polling: boolean
  error: string | null
  filter: SvcFilter
  loaded: boolean
  /**
   * 「跳转到这里」的定位键(笔记关联点击时设置)。
   * 用 cardKey 而不是 svc.id:后者是 pid:port,3s 轮询一刷新就变,定位会落空。
   */
  focusKey: string | null
  load(): Promise<void>
  applyPayload(p: ServicesListPayload): void
  setFilter(f: SvcFilter): void
  setFocusKey(key: string | null): void
  setPolling(enabled: boolean): Promise<void>
  setActive(active: boolean): Promise<void>
}

export const useServicesStore = create<ServicesState>((set, get) => ({
  services: [],
  containers: [],
  brewServices: [],
  dockerAvailable: false,
  dockerReason: null,
  polling: true,
  error: null,
  filter: 'all',
  loaded: false,
  focusKey: null,

  async load() {
    const p = await dataSource().services.list()
    // error 由 payload 带出(非空 = 这份 services 是上次成功的结果),不要在这里写死 null
    set({ ...p, loaded: true })
  },

  applyPayload(p) {
    set({ ...p, loaded: true })
  },

  setFocusKey(key) {
    set({ focusKey: key })
  },

  setFilter(f) {
    set({ filter: f })
  },

  async setPolling(enabled) {
    const p = await dataSource().services.setPolling(enabled)
    set({ ...p })
  },

  async setActive(active) {
    await dataSource().services.setActive(active)
  }
}))
