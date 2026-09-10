// 设置变更 → 应用副作用(themeSource / Tray / Dock / 开机自启)
// 副作用集中在此,main/index.ts 保持薄;Tray 与 logoDir 由 index 注入(依赖窗口引用)

import { app, nativeTheme, nativeImage } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { LauncherSettings } from '../../shared/settings'

export interface ApplyRefs {
  logoDir(): string
  createTray(): void
  destroyTray(): void
}

function applyDockIcon(refs: ApplyRefs): void {
  if (process.platform !== 'darwin') return
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  const themed = join(refs.logoDir(), `icon-${theme}.png`)
  const iconPath = existsSync(themed) ? themed : join(refs.logoDir(), 'icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  if (!icon.isEmpty()) {
    app.dock?.setIcon(icon)
    console.log(`[dock] icon set (${theme}${themed === iconPath ? '' : ', fallback'})`)
  }
}

export function applySettings(s: LauncherSettings, refs: ApplyRefs): void {
  // 唯一写者:main 依据设置(而非仅系统外观)驱动 themeSource;
  // 由此 renderer 的 prefers-color-scheme 与 Dock 深浅切换自动跟随应用主题。
  nativeTheme.themeSource = s.theme

  if (s.trayVisible) {
    refs.createTray()
  } else {
    refs.destroyTray()
  }

  if (process.platform === 'darwin') {
    if (s.dockVisible) {
      app.dock?.show()
      applyDockIcon(refs)
    } else {
      app.dock?.hide()
    }
  }

  // 开机自启:仅打包态生效(dev 登记的是 electron 二进制且 macOS 会拒绝,静默跳过)
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({ openAtLogin: s.launchAtLogin })
    } catch (err) {
      console.error('[settings] setLoginItemSettings failed:', err)
    }
  }
}

export { applyDockIcon }
