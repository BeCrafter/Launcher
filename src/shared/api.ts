// 渲染层可用 API 契约(preload contextBridge 注入 window.launcher)

import type { AppInfo, IpcEventChannel, SettingsPatch } from './ipc'
import type { LauncherSettings } from './settings'

export interface LauncherApi {
  appName: string
  versions: {
    electron: string
    node: string
    chrome: string
  }
  // 启动时由 main 经 additionalArguments 注入的首帧设置(免同步 IPC,无主题/语言闪烁)
  initialSettings: LauncherSettings
  ping: () => Promise<string>
  getSettings: () => Promise<LauncherSettings>
  setSettings: (patch: SettingsPatch) => Promise<LauncherSettings>
  resetSettings: () => Promise<LauncherSettings>
  getAppInfo: () => Promise<AppInfo>
  openExternal: (url: string) => Promise<void>
  // main → renderer 推送订阅(白名单通道),返回退订函数
  onEvent: (channel: IpcEventChannel, cb: (payload: unknown) => void) => () => void
}
