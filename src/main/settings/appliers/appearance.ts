// 外观域:theme → nativeTheme.themeSource(唯一写者)+ 窗口底色随动

import { nativeTheme } from 'electron'
import { BG_DARK, BG_LIGHT } from '../../../shared/constants'
import type { LauncherSettings } from '../../../shared/settings'
import type { ApplyCtx, SettingsApplier } from '../types'

// 窗口底色(标题栏随之着色):取 demo --bg 深浅两值(同源见 shared/constants 的说明)
export function windowBgColor(): string {
  return nativeTheme.shouldUseDarkColors ? BG_DARK : BG_LIGHT
}

/**
 * 主题 → nativeTheme.themeSource(唯一实现)。
 *
 * 单独导出是因为**建窗之前**必须先让它落位:窗口底色(`windowBgColor()`)与渲染层的
 * `prefers-color-scheme`(启动过渡页配色也吃它)都读它,晚一步就会先闪一帧系统主题的底色。
 * 其余 applier 副作用(Dock/Tray/登录项/fs.watch)都是窗口之后才需要的,不必压在建窗前。
 */
export function applyThemeSource(s: LauncherSettings): void {
  // 唯一写者:main 依据设置(而非仅系统外观)驱动 themeSource;
  // 由此 renderer 的 prefers-color-scheme、系统标题栏与 Dock 深浅切换自动跟随应用主题。
  nativeTheme.themeSource = s.theme
}

function applyWindowBackground(ctx: ApplyCtx): void {
  ctx.getWindow()?.setBackgroundColor(windowBgColor())
}

export function createAppearanceApplier(): SettingsApplier {
  return {
    key: 'appearance',
    apply(s, _prev, ctx) {
      applyThemeSource(s)
      applyWindowBackground(ctx)
    }
  }
}
