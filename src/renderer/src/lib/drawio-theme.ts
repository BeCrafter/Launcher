// 把应用当前主题的 CSS 变量交给 draw.io 的 configure.customCss。
//
// ⚠ 必须读 **body** 而不是 documentElement:`light-theme` 类挂在 body 上,
// 浅色那套变量因此只覆盖到 body 及其后代 —— 从 `<html>` 读会拿到深色 `:root` 的值
// (和 lib/mermaid-render.ts 的坑一样)。读取器可注入,单测不必依赖 jsdom 的 CSS 变量支持。

import { drawioThemeCss, type DrawioThemeColors } from '@shared/drawio-theme'

export type CssVarReader = (name: string, fallback: string) => string

export function readFromBody(name: string, fallback: string): string {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

/** 组装 draw.io 的 configure 配置;值取应用当前生效主题。 */
export function drawioThemeConfig(
  dark: boolean,
  read: CssVarReader = readFromBody
): { customCss: string } {
  const colors: DrawioThemeColors = {
    surface: read('--surface', dark ? '#151522' : '#ffffff'),
    surface2: read('--surface2', dark ? '#1d1d2e' : '#fafbfe'),
    surface3: read('--surface3', dark ? '#252538' : '#f1f3f9'),
    surface4: read('--surface4', dark ? '#2e2e44' : '#e9ecf4'),
    border2: read('--border2', dark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(30, 38, 68, 0.14)'),
    text: read('--text', dark ? '#e7e7f1' : '#2a2f45'),
    muted: read('--muted', dark ? '#8e8ea8' : '#6d7489'),
    dim: read('--dim', dark ? '#4f4f6e' : '#a0a7bb'),
    accent: read('--accent', dark ? '#7c6af4' : '#6a58e0'),
    accent2: read('--accent2', dark ? '#a78bfa' : '#5a48c8'),
    editorBg: read('--editor-bg', dark ? '#0f0f1a' : '#e6eaf4'),
    washAccent: read('--wash-accent', dark ? 'rgba(124, 106, 244, 0.16)' : 'rgba(106, 88, 224, 0.12)'),
    hover: read('--hover', dark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(30, 38, 68, 0.05)')
  }
  return { customCss: drawioThemeCss(colors, dark) }
}
