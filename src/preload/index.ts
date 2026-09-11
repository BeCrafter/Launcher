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
const EVENT_CHANNELS: readonly IpcEventChannel[] = [
  IPC_EVENTS.settingsChanged,
  IPC_EVENTS.agentsDirChanged,
  IPC_EVENTS.servicesUpdated
]

const api: LauncherApi = {
  appName: APP_NAME,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome
  },
  initialSettings: readInitialSettings(),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  resetSettings: () => ipcRenderer.invoke(IPC.settingsReset),
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  reportBadgeCount: (count) => ipcRenderer.invoke(IPC.agentsBadge, count),
  checkForUpdate: () => ipcRenderer.invoke(IPC.appCheckUpdates),
  agents: {
    list: () => ipcRenderer.invoke(IPC.agList),
    toggle: (id) => ipcRenderer.invoke(IPC.agToggle, id),
    brewAction: (kind, id) => ipcRenderer.invoke(IPC.agBrewAction, kind, id),
    createDraft: (scope, label) => ipcRenderer.invoke(IPC.agCreateDraft, scope, label),
    save: (id, patch) => ipcRenderer.invoke(IPC.agSave, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.agRemove, id),
    clone: (id) => ipcRenderer.invoke(IPC.agClone, id),
    ops: (id, action) => ipcRenderer.invoke(IPC.agOps, id, action),
    readForm: (id) => ipcRenderer.invoke(IPC.agReadForm, id),
    readXml: (id) => ipcRenderer.invoke(IPC.agReadXml, id),
    saveXml: (id, xml) => ipcRenderer.invoke(IPC.agSaveXml, id, xml),
    readStatus: (id) => ipcRenderer.invoke(IPC.agReadStatus, id),
    readLogs: (id, source) => ipcRenderer.invoke(IPC.agReadLogs, id, source),
    clearLogs: (id) => ipcRenderer.invoke(IPC.agClearLogs, id),
    validateXml: (xml) => ipcRenderer.invoke(IPC.agValidateXml, xml),
    removeInvalid: (path) => ipcRenderer.invoke(IPC.agRemoveInvalid, path)
  },
  cron: {
    list: () => ipcRenderer.invoke(IPC.cronList),
    create: (job) => ipcRenderer.invoke(IPC.cronCreate, job),
    update: (job, patch) => ipcRenderer.invoke(IPC.cronUpdate, job, patch),
    remove: (job) => ipcRenderer.invoke(IPC.cronRemove, job),
    readLog: (id) => ipcRenderer.invoke(IPC.cronReadLog, id),
    writeHeader: (scope, text) => ipcRenderer.invoke(IPC.cronWriteHeader, scope, text)
  },
  services: {
    list: () => ipcRenderer.invoke(IPC.svcList),
    kill: (id, opts) => ipcRenderer.invoke(IPC.svcKill, id, opts ?? {}),
    restart: (id) => ipcRenderer.invoke(IPC.svcRestart, id),
    containerAction: (id, action) => ipcRenderer.invoke(IPC.svcContainerAction, id, action),
    setPolling: (enabled) => ipcRenderer.invoke(IPC.svcSetPolling, enabled),
    setActive: (active) => ipcRenderer.invoke(IPC.svcSetActive, active)
  },
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
