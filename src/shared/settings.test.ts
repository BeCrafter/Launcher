import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SERVICE_OVERRIDE_MAX_ENTRIES,
  normalizeServiceOverrides,
  normalizeSettings
} from './settings'

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

describe('normalizeServiceOverrides', () => {
  it('非对象输入回空表', () => {
    expect(normalizeServiceOverrides(undefined)).toEqual({})
    expect(normalizeServiceOverrides(null)).toEqual({})
    expect(normalizeServiceOverrides([])).toEqual({})
    expect(normalizeServiceOverrides('x')).toEqual({})
  })

  it('字段 trim,空字段不写入', () => {
    const out = normalizeServiceOverrides({ '8080:node': { alias: '  前端  ', host: '', path: '/api' } })
    expect(out['8080:node']).toEqual({ alias: '前端', path: '/api' })
  })

  it('未知子键被剥离', () => {
    expect(normalizeServiceOverrides({ k: { alias: 'a', evil: 'x' } })).toEqual({ k: { alias: 'a' } })
  })

  it('非字符串子字段被忽略', () => {
    expect(normalizeServiceOverrides({ k: { alias: 42, host: true } })).toEqual({})
  })

  it('全空/非对象条目被丢弃', () => {
    expect(normalizeServiceOverrides({ k: { alias: '  ', host: '' } })).toEqual({})
    expect(normalizeServiceOverrides({ k: {} })).toEqual({})
    expect(normalizeServiceOverrides({ k: 42 })).toEqual({})
    expect(normalizeServiceOverrides({ k: ['a'] })).toEqual({})
  })

  it('条目数超上限被截断,保留先出现的', () => {
    const raw: Record<string, unknown> = {}
    for (let i = 0; i < 200; i++) raw[`p${i}`] = { alias: 'a' }
    const out = normalizeServiceOverrides(raw)
    expect(Object.keys(out)).toHaveLength(SERVICE_OVERRIDE_MAX_ENTRIES)
    expect(out).toHaveProperty('p0')
    expect(out).not.toHaveProperty('p199')
  })

  it('超长键被丢弃,边界键保留', () => {
    expect(normalizeServiceOverrides({ ['k'.repeat(97)]: { alias: 'a' } })).toEqual({})
    expect(normalizeServiceOverrides({ ['k'.repeat(96)]: { alias: 'a' } })).toHaveProperty('k'.repeat(96))
  })

  it('__proto__ 键不污染原型', () => {
    const out = normalizeServiceOverrides(JSON.parse('{"__proto__":{"alias":"evil"}}') as unknown)
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(Object.keys(out)).toHaveLength(0)
    expect(({} as Record<string, unknown>).alias).toBeUndefined()
  })

  it('经 normalizeSettings 保留合法覆写,非法值回空表', () => {
    const ok = normalizeSettings({ serviceOverrides: { '8080:node': { alias: '前端' } } })
    expect(ok.serviceOverrides).toEqual({ '8080:node': { alias: '前端' } })
    expect(normalizeSettings({ serviceOverrides: 'nope' }).serviceOverrides).toEqual({})
    expect(normalizeSettings({}).serviceOverrides).toEqual({})
  })
})
