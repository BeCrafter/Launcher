import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { zhCN } from './dict.zh-CN'
import { enUS } from './dict.en-US'
import { fmt, getCurrentLang, makeT, setRuntimeLang, t } from './index'

describe('i18n dictionaries', () => {
  it('中英键集合一致(demo 555 键 + 应用 EXTRA 键)', () => {
    const zk = new Set(Object.keys(zhCN))
    const ek = new Set(Object.keys(enUS))
    expect(zk.size).toBeGreaterThanOrEqual(555)
    const onlyZh = [...zk].filter((k) => !ek.has(k))
    const onlyEn = [...ek].filter((k) => !zk.has(k))
    expect(onlyZh).toEqual([])
    expect(onlyEn).toEqual([])
  })

  it('应用新增的更新检查四键在两份字典均存在', () => {
    const keys = [
      'toast.update.upToDate',
      'toast.update.available',
      'toast.update.noRelease',
      'toast.update.error'
    ]
    for (const k of keys) {
      expect(zhCN[k], `zh-CN 缺 ${k}`).toBeTruthy()
      expect(enUS[k], `en-US 缺 ${k}`).toBeTruthy()
    }
  })

  it('上下文明细卡的键在两份字典均存在', () => {
    const keys = [
      'ai.ctx.card.title',
      'ai.ctx.card.summary',
      'ai.ctx.card.remaining',
      'ai.ctx.card.over',
      'ai.ctx.card.anchor',
      'ai.ctx.card.anchorSub',
      'ai.ctx.card.trailing',
      'ai.ctx.card.trailingSub',
      'ai.ctx.card.draft',
      'ai.ctx.card.draftSub',
      'ai.ctx.card.draftAtt',
      'ai.ctx.card.model',
      'ai.ctx.card.window',
      'ai.ctx.card.note',
      'ai.ctx.card.earlierNotCounted'
    ]
    for (const k of keys) {
      expect(zhCN[k], `zh-CN 缺 ${k}`).toBeTruthy()
      expect(enUS[k], `en-US 缺 ${k}`).toBeTruthy()
    }
  })

  it('块移动的键在两份字典均存在,且占位符一致', () => {
    const keys = [
      'notes.blockMenu.moveTo',
      'notes.blockMove.title',
      'notes.blockMove.search',
      'notes.blockMove.empty',
      'notes.blockMove.nestedHint',
      'notes.blockMove.noSource',
      'notes.blockMove.failed',
      'notes.blockMove.outlineTitle',
      'notes.blockMove.start',
      'notes.blockMove.end',
      'notes.blockMove.before',
      'notes.blockMove.after',
      'notes.blockMove.afterSection',
      'notes.blockMove.untitled',
      'notes.blockMove.limit',
      'notes.blockMove.hint'
    ]
    const slots = (text: string): string[] =>
      [...text.matchAll(/\{[A-Z]+\}/g)].map((match) => match[0]).sort()
    for (const k of keys) {
      expect(zhCN[k], `zh-CN 缺 ${k}`).toBeTruthy()
      expect(enUS[k], `en-US 缺 ${k}`).toBeTruthy()
      expect(slots(enUS[k]), `en-US ${k} 占位符不一致`).toEqual(slots(zhCN[k]))
    }
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
    expect(makeT('en-US')('module.crontab')).toBe('Crontab')
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
