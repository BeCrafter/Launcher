import { contextBridge, ipcRenderer } from 'electron'
import { APP_NAME } from '../shared/constants'
import { IPC, IPC_EVENTS, type IpcEventChannel } from '../shared/ipc'
import { normalizeSettings } from '../shared/settings'
import type { LauncherApi } from '../shared/api'

// main 经 additionalArguments 注入的首帧设置(--launcher-initial-settings=<json>)
function readInitialSettings(): ReturnType<typeof normalizeSettings> {
  const arg = process.argv.find((a) => a.startsWith('--launcher-initial-settings='))
  if (!arg) return normalizeSettings(undefined)
  try {
    return normalizeSettings(JSON.parse(arg.slice('--launcher-initial-settings='.length)))
  } catch {
    return normalizeSettings(undefined)
  }
}

// 事件订阅白名单:防渲染层监听任意通道
const EVENT_CHANNELS: readonly IpcEventChannel[] = [IPC_EVENTS.settingsChanged]

const api: LauncherApi = {
  appName: APP_NAME,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome
  },
  initialSettings: readInitialSettings(),
  ping: (): Promise<string> => ipcRenderer.invoke(IPC.ping),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  resetSettings: () => ipcRenderer.invoke(IPC.settingsReset),
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  onEvent: (channel, cb) => {
    if (!EVENT_CHANNELS.includes(channel)) {
      throw new Error(`event channel not allowed: ${channel}`)
    }
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('launcher', api)
