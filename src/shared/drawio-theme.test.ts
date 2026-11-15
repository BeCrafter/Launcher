import { describe, expect, it } from 'vitest'
import { drawioThemeCss, drawioThemeVars, type DrawioThemeColors } from './drawio-theme'

const DARK: DrawioThemeColors = {
  surface: '#151522',
  surface2: '#1d1d2e',
  surface3: '#252538',
  surface4: '#2e2e44',
  border2: 'rgba(255, 255, 255, 0.10)',
  text: '#e7e7f1',
  muted: '#8e8ea8',
  dim: '#4f4f6e',
  accent: '#7c6af4',
  accent2: '#a78bfa',
  editorBg: '#0f0f1a',
  washAccent: 'rgba(124, 106, 244, 0.16)',
  hover: 'rgba(255, 255, 255, 0.06)'
}

const LIGHT: DrawioThemeColors = {
  surface: '#ffffff',
  surface2: '#fafbfe',
  surface3: '#f1f3f9',
  surface4: '#e9ecf4',
  border2: 'rgba(30, 38, 68, 0.14)',
  text: '#2a2f45',
  muted: '#6d7489',
  dim: '#a0a7bb',
  accent: '#6a58e0',
  accent2: '#5a48c8',
  editorBg: '#e6eaf4',
  washAccent: 'rgba(106, 88, 224, 0.12)',
  hover: 'rgba(30, 38, 68, 0.05)'
}

describe('drawioThemeCss', () => {
  it('深色:面板/工作区/文字换成应用深色值,color-scheme 为 dark', () => {
    const css = drawioThemeCss(DARK, true)
    expect(css.startsWith(':root:root {')).toBe(true)
    expect(css).toContain('color-scheme: dark;')
    expect(css).toContain('--ge-panel-color: #151522;')
    expect(css).toContain('--ge-dark-panel-color: #151522;')
    expect(css).toContain('--workspace-color: #0f0f1a;')
    expect(css).toContain('--dark-color: #0f0f1a;')
    expect(css).toContain('--dark-text-color: #e7e7f1;')
    expect(css).toContain('--dark-accent-text-color: #a78bfa;')
    expect(css).toContain('--accent-text-color: #a78bfa;')
  })

  it('浅色:同一组变量换成应用浅色值', () => {
    const css = drawioThemeCss(LIGHT, false)
    expect(css).toContain('color-scheme: light;')
    expect(css).toContain('--ge-panel-color: #ffffff;')
    expect(css).toContain('--ge-dark-panel-color: #ffffff;')
    expect(css).toContain('--workspace-color: #e6eaf4;')
    expect(css).toContain('--text-color: #2a2f45;')
    expect(css).toContain('--accent-text-color: #6a58e0;')
    expect(css).toContain('--dark-accent-text-color: #6a58e0;')
  })

  it('不碰图形内容色:绝不出现 --ge-dark-color / --ge-light-color', () => {
    for (const dark of [true, false]) {
      const css = drawioThemeCss(dark ? DARK : LIGHT, dark)
      expect(css).not.toContain('--ge-dark-color')
      expect(css).not.toContain('--ge-light-color')
    }
  })

  it('light-dark() 两侧都写当前主题的值,菜单/对话框挂到 body 外也不会串色', () => {
    const dark = drawioThemeVars(DARK, true)
    expect(dark['--toolbar-color']).toBe(dark['--dark-toolbar-color'])
    expect(dark['--text-color']).toBe(dark['--dark-text-color'])
    expect(dark['--accent-color']).toBe(dark['--dark-accent-color'])
    expect(dark['--field-color']).toBe(dark['--dark-field-color'])
    expect(dark['--card-color']).toBe(dark['--dark-card-color'])

    const light = drawioThemeVars(LIGHT, false)
    expect(light['--text-color']).toBe(light['--dark-text-color'])
    expect(light['--accent-text-color']).toBe(light['--dark-accent-text-color'])
  })
})
