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

// 模型必须**按协议各存各的**:此前是全局单值,切到另一协议再切回来就丢了。
// (端点一直是按协议存的,模型却只有一个全局槽位 —— 两者不对称就是那个 bug)
describe('AI 协议配置:模型按协议隔离', () => {
  it('两条协议各自保留自己的模型,互不覆盖', () => {
    const s = normalizeSettings({
      aiProviderId: 'openai-compatible',
      aiProviders: {
        anthropic: { baseUrl: 'https://api.anthropic.com', modelId: 'claude-opus-5' },
        'openai-compatible': { baseUrl: 'http://127.0.0.1:8787/v1', modelId: 'my-local-model' }
      }
    })
    expect(s.aiProviders.anthropic.modelId).toBe('claude-opus-5')
    expect(s.aiProviders['openai-compatible'].modelId).toBe('my-local-model')
  })

  it('只写其中一条协议时,另一条回落到它自己的默认(不被带着走)', () => {
    const s = normalizeSettings({
      aiProviderId: 'openai-compatible',
      aiProviders: { 'openai-compatible': { modelId: 'gpt-x' } }
    })
    expect(s.aiProviders['openai-compatible'].modelId).toBe('gpt-x')
    // Anthropic 用回自己的默认模型,而不是被 openai 那条的模型污染
    expect(s.aiProviders.anthropic.modelId).toBe('claude-opus-5')
    expect(s.aiProviders.anthropic.baseUrl).toBe('https://api.anthropic.com')
  })

  it('老配置的全局 aiModelId 迁移给「当时生效的那个协议」', () => {
    const s = normalizeSettings({ aiProviderId: 'openai-compatible', aiModelId: 'legacy-model' })
    expect(s.aiProviders['openai-compatible'].modelId).toBe('legacy-model')
    // 非生效协议不吃这份遗留值
    expect(s.aiProviders.anthropic.modelId).toBe('claude-opus-5')
  })

  it('新配置(没有 aiModelId)不会把默认模型塞给 OpenAI 兼容那条', () => {
    const s = normalizeSettings({ aiProviderId: 'openai-compatible' })
    expect(s.aiProviders['openai-compatible'].modelId).toBeUndefined()
  })

  it('recentModels 去重、限 3 个、丢空值,当前模型置顶', () => {
    const s = normalizeSettings({
      aiProviders: { anthropic: { modelId: 'm2', recentModels: ['m1', 'm3', 'm4', 'm2', '', 7] } }
    })
    const r = s.aiProviders.anthropic.recentModels ?? []
    // 去重限流后当前模型置顶,再截到 3 个 —— chip 行要正好显示「最近 3 个」
    expect(r).toEqual(['m2', 'm1', 'm3'])
    expect(new Set(r).size).toBe(r.length)
  })

  it('当前模型不在 recentModels 时被补进去(否则它在 chip 行里消失)', () => {
    const s = normalizeSettings({ aiProviders: { anthropic: { modelId: 'brand-new', recentModels: [] } } })
    expect(s.aiProviders.anthropic.recentModels).toEqual(['brand-new'])
  })

  it('默认配置的 anthropic 就带一个 recentModels,保证 normalize({}) 与 DEFAULT_SETTINGS 一致', () => {
    expect(normalizeSettings({}).aiProviders).toEqual(DEFAULT_SETTINGS.aiProviders)
  })

  it('超长/非法输入被裁掉而不是原样存进设置文件', () => {
    const s = normalizeSettings({ aiProviders: { anthropic: { modelId: 'x'.repeat(500) } } })
    expect((s.aiProviders.anthropic.modelId ?? '').length).toBeLessThanOrEqual(200)
    expect(normalizeSettings({ aiProviders: { anthropic: { modelId: 42 } } }).aiProviders.anthropic.modelId).toBe(
      'claude-opus-5'
    )
  })
})

// 附加请求头:企业网关常按客户端标识放行(实测某网关要求 User-Agent 前缀为 claude-cli,否则 403)
describe('AI 协议配置:自定义请求头', () => {
  it('正常键值原样保留', () => {
    const s = normalizeSettings({
      aiProviders: { anthropic: { headers: { 'User-Agent': 'claude-cli/2.0.0' } } }
    })
    expect(s.aiProviders.anthropic.headers).toEqual({ 'User-Agent': 'claude-cli/2.0.0' })
  })

  it('空/非字符串值被丢弃,空结果不落盘(undefined 而非 {})', () => {
    const s = normalizeSettings({
      aiProviders: { anthropic: { headers: { A: '', B: '   ', C: 42, D: null } } }
    })
    expect(s.aiProviders.anthropic.headers).toBeUndefined()
  })

  it('__proto__ 不污染原型', () => {
    const s = normalizeSettings({
      aiProviders: { anthropic: { headers: { ['__proto__']: 'polluted', 'X-Ok': 'yes' } } }
    })
    expect(s.aiProviders.anthropic.headers).toEqual({ 'X-Ok': 'yes' })
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })

  it('条目数与键值长度都有上限(损坏文件塞不进任意大的串)', () => {
    const many: Record<string, string> = {}
    for (let i = 0; i < 50; i++) many[`H${i}`] = 'v'
    const s = normalizeSettings({ aiProviders: { anthropic: { headers: many } } })
    expect(Object.keys(s.aiProviders.anthropic.headers ?? {}).length).toBeLessThanOrEqual(16)

    const long = normalizeSettings({ aiProviders: { anthropic: { headers: { A: 'x'.repeat(5000) } } } })
    expect((long.aiProviders.anthropic.headers?.['A'] ?? '').length).toBeLessThanOrEqual(400)
  })

  it('缺省时是 undefined,不影响既有配置', () => {
    expect(normalizeSettings({}).aiProviders.anthropic.headers).toBeUndefined()
  })
})
