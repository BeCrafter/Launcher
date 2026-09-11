// 外观域:theme → nativeTheme.themeSource(唯一写者)+ 窗口底色随动

import { nativeTheme } from 'electron'
import type { ApplyCtx, SettingsApplier } from '../types'

// 窗口底色(标题栏随之着色):取 demo --bg 深浅两值
export function windowBgColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#0e0e17' : '#f6f7fb'
}

function applyWindowBackground(ctx: ApplyCtx): void {
  ctx.getWindow()?.setBackgroundColor(windowBgColor())
}

export function createAppearanceApplier(): SettingsApplier {
  return {
    key: 'appearance',
    apply(s, _prev, ctx) {
      // 唯一写者:main 依据设置(而非仅系统外观)驱动 themeSource;
      // 由此 renderer 的 prefers-color-scheme、系统标题栏与 Dock 深浅切换自动跟随应用主题。
      nativeTheme.themeSource = s.theme
      applyWindowBackground(ctx)
    }
  }
}
