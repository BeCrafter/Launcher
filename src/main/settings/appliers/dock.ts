// Dock 域:dockVisible → app.dock.show/hide;applyDockIcon 供主题明暗切换路径复用

import { app, nativeImage, nativeTheme } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SettingsApplier } from '../types'

export function applyDockIcon(logoDir: () => string): void {
  if (process.platform !== 'darwin') return
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  const themed = join(logoDir(), `icon-${theme}.png`)
  const iconPath = existsSync(themed) ? themed : join(logoDir(), 'icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  if (!icon.isEmpty()) {
    app.dock?.setIcon(icon)
    console.log(`[dock] icon set (${theme}${themed === iconPath ? '' : ', fallback'})`)
  }
}

export function createDockApplier(): SettingsApplier {
  return {
    key: 'dock',
    apply(s, _prev, ctx) {
      if (process.platform !== 'darwin') return
      if (s.dockVisible) {
        app.dock?.show()
        applyDockIcon(ctx.logoDir)
      } else {
        app.dock?.hide()
        console.log('[dock] hidden')
      }
    }
  }
}
