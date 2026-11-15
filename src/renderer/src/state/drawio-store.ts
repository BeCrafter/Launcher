// draw.io 编辑器的在线/离线偏好与离线资源包状态。
//
// 模式是全局偏好(默认 online),localStorage 记住;白板卡片也读同一个值。
// 例外:用户从没选过、而这台机器已经装好离线包时,默认用离线 —— 本地资源打开是瞬时的,
// 在线编辑器首屏要拉 11MB,慢网根本等不起。显式点过「在线」之后以用户的选择为准。
// 离线资源包不在安装包里:第一次切换离线时下载,进度经 main → IPC 事件推到这里的 status。
// 没有装离线包却选了离线时,effectiveDrawioMode 会回退在线,避免打开一个空 iframe。

import { create } from 'zustand'
import type { DrawioMode, DrawioProgress, DrawioStatus } from '@shared/drawio'

const MODE_KEY = 'launcher.drawio.mode'

function readMode(): DrawioMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'offline' ? 'offline' : 'online'
  } catch {
    return 'online'
  }
}

/** 用户有没有显式选过模式(localStorage 里没有这个键 = 从没选过) */
function hasStoredMode(): boolean {
  try {
    return localStorage.getItem(MODE_KEY) !== null
  } catch {
    return false
  }
}

function writeMode(mode: DrawioMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // 隐私模式/禁用存储:本次会话里仍然生效
  }
}

/** 实际加载哪个编辑器:选了离线但包不在 → 在线 */
export function effectiveDrawioMode(
  mode: DrawioMode,
  status: DrawioStatus | null
): DrawioMode {
  if (mode !== 'offline') return 'online'
  return status?.installed === true ? 'offline' : 'online'
}

export type DrawioUiPhase = 'idle' | 'confirm' | 'downloading' | 'error'

interface DrawioState {
  mode: DrawioMode
  status: DrawioStatus | null
  phase: DrawioUiPhase
  progress: DrawioProgress | null
  error: string | null
  /** 拉一次状态;多次调用只发一次 IPC */
  ensureStatus: () => Promise<DrawioStatus>
  /** 点头部模式按钮 */
  requestOffline: () => Promise<void>
  dismissConfirm: () => void
  switchOnline: () => void
  download: () => Promise<void>
  cancel: () => Promise<void>
  /** 手动导入本地 draw.war;title 由调用方的 i18n 提供 */
  importWar: (title: string) => Promise<void>
}

let statusPromise: Promise<DrawioStatus> | null = null
let subscribed = false

function subscribe(): void {
  if (subscribed) return
  subscribed = true
  window.launcher.drawio.onStatus(({ status, progress }) => {
    useDrawioStore.setState((s) => ({
      status,
      ...(progress !== undefined && s.phase === 'downloading' ? { progress } : {})
    }))
  })
}

export const useDrawioStore = create<DrawioState>((set, get) => ({
  mode: readMode(),
  status: null,
  phase: 'idle',
  progress: null,
  error: null,

  ensureStatus: async () => {
    const current = get().status
    if (current !== null) return current
    subscribe()
    statusPromise ??= window.launcher.drawio.status()
    try {
      const status = await statusPromise
      set((s) => ({
        status,
        // E2E 的 stub 就是「已安装离线包」,否则测试会去请求真实远程编辑器;
        // 装好离线包但用户从没选过模式,也直接走本地
        mode: status.stub || (!hasStoredMode() && status.installed) ? 'offline' : s.mode
      }))
      return status
    } catch {
      statusPromise = null
      throw new Error('读取 draw.io 组件状态失败')
    }
  },

  requestOffline: async () => {
    const status = await get().ensureStatus()
    if (status.installed) {
      writeMode('offline')
      set({ mode: 'offline', phase: 'idle', error: null })
      return
    }
    set({ phase: 'confirm', error: null })
  },

  dismissConfirm: () => set({ phase: 'idle' }),

  switchOnline: () => {
    writeMode('online')
    set({ mode: 'online', phase: 'idle', progress: null, error: null })
  },

  download: async () => {
    set({
      phase: 'downloading',
      progress: { phase: 'download', received: 0, total: 0 },
      error: null
    })
    const outcome = await window.launcher.drawio.download()
    if (outcome.ok && outcome.status.installed) {
      writeMode('offline')
      set({
        mode: 'offline',
        status: outcome.status,
        phase: 'idle',
        progress: null
      })
      return
    }
    if (/取消/.test(outcome.message ?? '')) {
      set({ status: outcome.status, phase: 'idle', progress: null })
      return
    }
    set({
      status: outcome.status,
      phase: 'error',
      error: outcome.message ?? '下载失败',
      progress: null
    })
  },

  cancel: async () => {
    await window.launcher.drawio.cancel()
    set({ phase: 'idle', progress: null })
  },

  importWar: async (title: string) => {
    const picked = await window.launcher.pickFile({ mode: 'war', title })
    if (picked === null) return
    set({
      phase: 'downloading',
      progress: { phase: 'extract', received: 0, total: 0 },
      error: null
    })
    const outcome = await window.launcher.drawio.importWar(picked.path)
    if (outcome.ok && outcome.status.installed) {
      writeMode('offline')
      set({
        mode: 'offline',
        status: outcome.status,
        phase: 'idle',
        progress: null
      })
      return
    }
    set({
      status: outcome.status,
      phase: 'error',
      error: outcome.message ?? '导入失败',
      progress: null
    })
  }
}))

/** 测试/换 profile 时清掉缓存的首次状态 */
export function resetDrawioStoreForTests(): void {
  statusPromise = null
  subscribed = false
}
