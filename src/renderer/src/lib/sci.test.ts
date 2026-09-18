import { describe, expect, it } from 'vitest'
import { makeT } from '../i18n'
import { sciDescribe, sciPlistFragment, type SciData } from './sci'

const zh = makeT('zh-CN')
const en = makeT('en-US')

const entry = (over: Partial<SciData>): SciData => ({
  Minute: null,
  Hour: null,
  Day: null,
  Weekday: null,
  Month: null,
  ...over
})

describe('sciDescribe', () => {
  it('Weekday=7 与 0 同为周日(man),不露出裸键名 cron.wd.7', () => {
    const seven = sciDescribe(entry({ Weekday: 7, Hour: 9, Minute: 0 }), 'zh-CN', zh)
    const zero = sciDescribe(entry({ Weekday: 0, Hour: 9, Minute: 0 }), 'zh-CN', zh)
    expect(seven).toBe(zero)
    expect(seven).toContain(zh('cron.wd.0'))
    expect(seven).not.toContain('cron.wd')
  })

  it('其余星期值不受归一影响;en-US 同样归一', () => {
    expect(sciDescribe(entry({ Weekday: 1, Hour: 8, Minute: 30 }), 'zh-CN', zh)).toContain(zh('cron.wd.1'))
    expect(sciDescribe(entry({ Weekday: 7, Hour: 9, Minute: 0 }), 'en-US', en)).toContain(en('cron.wd.0'))
  })

  it('无日期维度走纯时间描述(回归)', () => {
    expect(sciDescribe(entry({ Hour: 9, Minute: 0 }), 'zh-CN', zh)).toBe(
      zh('sci.describe.daily').replace('{T}', '09:00')
    )
  })
})

describe('sciPlistFragment', () => {
  it('Weekday 原样回显(7 保持 7,保存不改写未触碰的值)', () => {
    expect(sciPlistFragment(entry({ Weekday: 7 }), zh)).toBe('<dict> Weekday=7 </dict>')
  })

  it('全空 → 通配形态', () => {
    expect(sciPlistFragment(entry({}), zh)).toContain(zh('sci.plist.wildcard'))
  })
})
