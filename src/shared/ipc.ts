// IPC 通道常量与负载类型(main ↔ preload ↔ renderer 契约,防字符串漂移)

import type { LauncherSettings } from './settings'

// ── invoke 通道 ──
export const IPC = {
  ping: 'ping',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsReset: 'settings:reset',
  appInfo: 'app:info',
  openExternal: 'shell:openExternal'
} as const

// ── main → renderer 推送事件(preload onEvent 白名单) ──
export const IPC_EVENTS = {
  settingsChanged: 'settings:changed'
} as const

export type IpcEventChannel = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]

export interface AppInfo {
  arch: string
  platform: string
  version: string
  isPackaged: boolean
}

// settings:set 的合法 patch(部分键)
export type SettingsPatch = Partial<LauncherSettings>
