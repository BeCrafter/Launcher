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
  /** 唤起主窗口:**必须**走 main 的显示门控(启动未就绪时不会露出未绘制的窗口底色) */
  revealWindow(): void
}): TrayController {
  let tray: Tray | null = null
  let count = 0
  let badgeEnabled = true

  // ⚠ 一律走门控:不能直接 show() —— 启动还没就绪时那会露出未绘制的窗口底色(浅色主题下就是白屏)
  const reveal = (): void => deps.revealWindow()

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
              reveal()
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
          reveal()
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
