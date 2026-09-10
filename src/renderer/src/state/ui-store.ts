// UI store:模块路由 / 顶栏搜索 / 模态开关 / Toast(单条 2600ms,对齐 demo showToast)

import { create } from 'zustand'

export type ModuleId = 'agents' | 'crontab' | 'services' | 'settings'

// demo 的 modal id 命名保留(importModal/newCronModal 等),浮层组件按 id 挂载
export type OverlayId =
  | 'editAgentFloat' // Agent 编辑抽屉
  | 'cronLogDrawer' // Cron 日志抽屉
  | 'importModal'
  | 'newCronModal'
  | 'elevationModal'
  | 'dangerModal'

export interface ToastModel {
  msg: string
  color: string
  icon: string
}

interface UiState {
  module: ModuleId
  searchQuery: string
  mobileOpen: boolean
  // 打开中的浮层(抽屉/模态互斥由调用方保证;demo 用 class .open,这里用集合)
  overlays: OverlayId[]
  toast: ToastModel | null
  switchModule(m: ModuleId): void
  setSearch(v: string): void
  setMobileOpen(v: boolean): void
  openOverlay(id: OverlayId): void
  closeOverlay(id: OverlayId): void
  closeAllOverlays(): void
  showToast(msg: string, color?: string, icon?: string): void
}

const TOAST_MS = 2600
let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useUiStore = create<UiState>((set, get) => ({
  module: 'agents',
  searchQuery: '',
  mobileOpen: false,
  overlays: [],
  toast: null,

  switchModule(m) {
    if (get().module === m) return
    set({ module: m, searchQuery: '', mobileOpen: false })
  },

  setSearch(v) {
    set({ searchQuery: v })
  },

  setMobileOpen(v) {
    set({ mobileOpen: v })
  },

  openOverlay(id) {
    if (!get().overlays.includes(id)) set({ overlays: [...get().overlays, id] })
  },

  closeOverlay(id) {
    set({ overlays: get().overlays.filter((o) => o !== id) })
  },

  closeAllOverlays() {
    set({ overlays: [] })
  },

  showToast(msg, color = '#888', icon = 'fa-circle-info') {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: { msg, color, icon } })
    toastTimer = setTimeout(() => set({ toast: null }), TOAST_MS)
  }
}))
