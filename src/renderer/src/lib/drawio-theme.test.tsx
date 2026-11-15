import { describe, expect, it } from 'vitest'
import { drawioThemeConfig } from './drawio-theme'

const read =
  (values: Record<string, string>) =>
  (name: string, fallback: string): string =>
    values[name] ?? fallback

describe('drawioThemeConfig', () => {
  it('深色读应用深色变量,color-scheme 跟着深色', () => {
    const config = drawioThemeConfig(
      true,
      read({ '--surface': '#101020', '--text': '#eeeeee', '--accent2': '#bb99ff' })
    )
    expect(config.customCss).toContain('color-scheme: dark;')
    expect(config.customCss).toContain('--ge-panel-color: #101020;')
    expect(config.customCss).toContain('--ge-dark-panel-color: #101020;')
    expect(config.customCss).toContain('--dark-text-color: #eeeeee;')
    expect(config.customCss).toContain('--dark-accent-text-color: #bb99ff;')
  })

  it('浅色读应用浅色变量,color-scheme 跟着浅色', () => {
    const config = drawioThemeConfig(
      false,
      read({ '--surface': '#fafafa', '--text': '#111111', '--accent': '#6655dd' })
    )
    expect(config.customCss).toContain('color-scheme: light;')
    expect(config.customCss).toContain('--ge-panel-color: #fafafa;')
    expect(config.customCss).toContain('--text-color: #111111;')
    expect(config.customCss).toContain('--accent-text-color: #6655dd;')
  })

  it('读不到变量时用应用色板的回退值', () => {
    const config = drawioThemeConfig(true, read({}))
    expect(config.customCss).toContain('--ge-panel-color: #151522;')
    expect(config.customCss).toContain('--workspace-color: #0f0f1a;')
  })

  it('不把图形内容色写进配置', () => {
    for (const dark of [true, false]) {
      const css = drawioThemeConfig(dark, read({})).customCss
      expect(css).not.toContain('--ge-dark-color')
      expect(css).not.toContain('--ge-light-color')
    }
  })
})
