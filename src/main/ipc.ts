// IPC 注册:settings 读写重置 / app 信息 / 外链打开;设置变更广播到所有窗口

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { IPC, IPC_EVENTS, type AppInfo, type SettingsPatch } from '../shared/ipc'
import type { SettingsStore } from './settings/store'

export function registerIpc(store: SettingsStore): void {
  ipcMain.handle(IPC.settingsGet, () => store.get())

  ipcMain.handle(IPC.settingsSet, (_e, patch: SettingsPatch) => {
    return store.save(patch ?? {})
  })

  ipcMain.handle(IPC.settingsReset, () => store.reset())

  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    arch: process.arch,
    platform: process.platform,
    version: app.getVersion(),
    isPackaged: app.isPackaged
  }))

  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new Error(`blocked non-http(s) external url: ${url}`)
    }
    return shell.openExternal(url)
  })

  // 设置任意写入(main 自身 applySettings 或 renderer patch)后广播
  store.onChange((s) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC_EVENTS.settingsChanged, s)
    }
  })
}
