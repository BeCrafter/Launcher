// Tray 域:trayVisible → 生命周期(原 index.ts 内联代码逐行迁入);
// menubarBadge + renderer 上报的运行中计数 → setTitle 角标
// (title 与 template icon 独立渲染层,不破坏明暗自适应;角标形态差异见 demo-react-migration-map)

import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'
import { APP_NAME } from '../../../shared/constants'
import type { SettingsApplier, TrayController } from '../types'

export function createTrayController(deps: {
  logoDir(): string
  getWindow(): BrowserWindow | null
}): TrayController {
  let tray: Tray | null = null
  let count = 0
  let badgeEnabled = true

  function syncTitle(): void {
    const title = badgeEnabled && count > 0 ? String(count) : ''
    tray?.setTitle(title)
    console.log(`[tray] title="${title}"`)
  }

  return {
    ensure(visible) {
      if (!visible) {
        if (tray) console.log('[tray] destroyed')
        tray?.destroy()
        tray = null
        return
      }
      if (tray) return
      const icon = nativeImage.createFromPath(join(deps.logoDir(), 'iconTemplate.png'))
      icon.setTemplateImage(true)
      tray = new Tray(icon)
      tray.setToolTip(APP_NAME)
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: `显示 ${APP_NAME}`,
            click: () => {
              deps.getWindow()?.show()
              deps.getWindow()?.focus()
            }
          },
          { type: 'separator' },
          {
            label: '退出',
            click: () => {
              app.quit()
            }
          }
        ])
      )
      tray.on('click', () => {
        const win = deps.getWindow()
        if (win?.isVisible()) {
          win.hide()
        } else {
          win?.show()
        }
      })
      syncTitle()
    },
    setBadgeCount(n) {
      count = n
      syncTitle()
    },
    refreshBadge(enabled) {
      badgeEnabled = enabled
      syncTitle()
    },
    get badgeCount() {
      return count
    }
  }
}

export function createTrayApplier(): SettingsApplier {
  return {
    key: 'tray',
    apply(s, _prev, ctx) {
      ctx.tray.ensure(s.trayVisible)
      ctx.tray.refreshBadge(s.menubarBadge)
    }
  }
}
