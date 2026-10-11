import { describe, expect, it } from 'vitest'
import { compactStamp, localIso } from './note-time'

describe('localIso', () => {
  it('产出带本地偏移的 ISO-8601,秒级、补零', () => {
    // 用本地时间构造,断言与机器时区无关
    const d = new Date(2026, 0, 5, 3, 4, 9)
    const out = localIso(d.getTime())
    expect(out.startsWith('2026-01-05T03:04:09')).toBe(true)
    expect(out).toMatch(/[+-]\d{2}:\d{2}$/)
  })

  it('偏移符号与 getTimezoneOffset 相反(UTC+8 是 +08:00 不是 -08:00)', () => {
    const out = localIso(Date.now())
    const offsetMin = -new Date().getTimezoneOffset()
    const expected = `${offsetMin >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0')}:${String(Math.abs(offsetMin) % 60).padStart(2, '0')}`
    expect(out.endsWith(expected)).toBe(true)
  })

  it('同机同区写出的值可按字典序排序(这是 frontmatter 里能当字符串比的原因)', () => {
    const a = localIso(new Date(2026, 5, 1, 9, 0, 0).getTime())
    const b = localIso(new Date(2026, 5, 1, 10, 0, 0).getTime())
    expect(a < b).toBe(true)
  })

  it('跨月/跨年补零正确', () => {
    expect(localIso(new Date(2026, 11, 31, 23, 59, 59).getTime()).startsWith('2026-12-31T23:59:59')).toBe(true)
    expect(localIso(new Date(2027, 0, 1, 0, 0, 0).getTime()).startsWith('2027-01-01T00:00:00')).toBe(true)
  })

  it('自己写出的值能被 Date 解回来(偏移是可解析的)', () => {
    const d = new Date(2026, 8, 9, 15, 41, 3)
    expect(new Date(localIso(d.getTime())).getTime()).toBe(d.getTime())
  })
})

describe('compactStamp', () => {
  it('文件名用的紧凑形态', () => {
    expect(compactStamp(new Date(2026, 9, 9, 15, 41, 3).getTime())).toBe('20261009154103')
  })

  it('补零到固定宽度', () => {
    expect(compactStamp(new Date(2026, 0, 1, 0, 0, 0).getTime())).toBe('20260101000000')
  })
})
