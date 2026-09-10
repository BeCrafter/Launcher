import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { zhCN } from './dict.zh-CN'
import { enUS } from './dict.en-US'
import { fmt, getCurrentLang, makeT, setRuntimeLang, t } from './index'

describe('i18n dictionaries', () => {
  it('中英键集合一致(555 键)', () => {
    const zk = new Set(Object.keys(zhCN))
    const ek = new Set(Object.keys(enUS))
    expect(zk.size).toBeGreaterThanOrEqual(555)
    const onlyZh = [...zk].filter((k) => !ek.has(k))
    const onlyEn = [...ek].filter((k) => !zk.has(k))
    expect(onlyZh).toEqual([])
    expect(onlyEn).toEqual([])
  })
})

describe('t / fmt', () => {
  beforeEach(() => setRuntimeLang('zh-CN'))
  afterEach(() => setRuntimeLang('zh-CN'))

  it('t 返回当前语言文案,缺键回退键名', () => {
    expect(t('status.running')).toBe('运行中')
    setRuntimeLang('en-US')
    expect(t('status.running')).toBe('Running')
    expect(t('no.such.key')).toBe('no.such.key')
  })

  it('makeT 指定语言,不依赖模块级状态', () => {
    expect(makeT('en-US')('module.crontab')).toBe('Crontab Tasks')
    expect(makeT('zh-CN')('module.crontab')).toBe('定时任务')
  })

  it('getCurrentLang 反映运行时语言', () => {
    setRuntimeLang('en-US')
    expect(getCurrentLang()).toBe('en-US')
  })

  it('fmt 替换 {X} 占位,未知占位保留原样', () => {
    expect(fmt('共 {N} 项,运行 {N}', { N: 3 })).toBe('共 3 项,运行 3')
    expect(fmt('path ~/Library/{X}', { N: 1 })).toBe('path ~/Library/{X}')
  })
})
