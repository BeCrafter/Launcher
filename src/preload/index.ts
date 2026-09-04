import { contextBridge, ipcRenderer } from 'electron'
import { APP_NAME } from '../shared/constants'
import type { LauncherApi } from '../shared/api'

const api: LauncherApi = {
  appName: APP_NAME,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome
  },
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
  logoList: (): Promise<string[]> => ipcRenderer.invoke('logo:list'),
  logoGet: (): Promise<string> => ipcRenderer.invoke('logo:get'),
  logoSet: (variant: string): Promise<string> => ipcRenderer.invoke('logo:set', variant)
}

contextBridge.exposeInMainWorld('launcher', api)
