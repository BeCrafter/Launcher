import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings } from './settings'

describe('normalizeSettings', () => {
  it('空输入返回完整默认值', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('未知键被丢弃,不进入结果', () => {
    const out = normalizeSettings({ theme: 'light', rogueKey: 1, logoVariant: 'rocketOrbit' })
    expect(out.theme).toBe('light')
    expect(out).not.toHaveProperty('rogueKey')
    expect(out).not.toHaveProperty('logoVariant')
  })

  it('枚举字段越界回默认', () => {
    expect(normalizeSettings({ theme: 'sepia' }).theme).toBe('system')
    expect(normalizeSettings({ language: 'fr-FR' }).language).toBe('zh-CN')
    expect(normalizeSettings({ xmlIndent: 4 }).xmlIndent).toBe('2')
  })

  it('数值白名单:合法字符串数字被接受,越界回默认', () => {
    expect(normalizeSettings({ cmdTimeout: '10000' }).cmdTimeout).toBe(10000)
    expect(normalizeSettings({ cmdTimeout: 9999 }).cmdTimeout).toBe(5000)
    expect(normalizeSettings({ cronLogRetainDays: '14' }).cronLogRetainDays).toBe(14)
    expect(normalizeSettings({ cronLogRetainDays: 30 }).cronLogRetainDays).toBe(3)
    expect(normalizeSettings({ authCacheMin: 0 }).authCacheMin).toBe(0)
    expect(normalizeSettings({ authCacheMin: 60 }).authCacheMin).toBe(5)
  })

  it('布尔字段纠正非布尔输入', () => {
    expect(normalizeSettings({ confirmDangerous: 'yes' }).confirmDangerous).toBe(true)
    expect(normalizeSettings({ menubarOnly: 0 }).menubarOnly).toBe(true)
  })

  it('空 labelPrefix 回默认(新建任务前缀不可为空)', () => {
    expect(normalizeSettings({ labelPrefix: '' }).labelPrefix).toBe(DEFAULT_SETTINGS.labelPrefix)
    expect(normalizeSettings({ labelPrefix: 'com.corp.' }).labelPrefix).toBe('com.corp.')
  })

  it('合并语义:patch 只改指定键,其余保留默认', () => {
    const out = normalizeSettings({ ...DEFAULT_SETTINGS, theme: 'dark', language: 'en-US' })
    expect(out.theme).toBe('dark')
    expect(out.language).toBe('en-US')
    expect(out.cmdTimeout).toBe(DEFAULT_SETTINGS.cmdTimeout)
  })
})
