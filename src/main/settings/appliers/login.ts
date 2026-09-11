// 登录项域:launchAtLogin → app.setLoginItemSettings
// 仅打包态生效(dev 登记的是 electron 二进制且 macOS 会拒绝,静默跳过)

import { app } from 'electron'
import type { SettingsApplier } from '../types'

export function createLoginApplier(): SettingsApplier {
  return {
    key: 'login',
    apply(s) {
      if (!app.isPackaged) return
      try {
        app.setLoginItemSettings({ openAtLogin: s.launchAtLogin })
      } catch (err) {
        console.error('[settings] setLoginItemSettings failed:', err)
      }
    }
  }
}
