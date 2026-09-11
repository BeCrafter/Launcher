import { describe, expect, it } from 'vitest'
import { nextCronRun, parseCronField, specialToExpr } from './cron-next-run'

// 全部用本地时间构造/断言(与实现一致;2026-09-11 为周五)
const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date =>
  new Date(y, mo - 1, d, h, mi, s)

describe('parseCronField', () => {
  it('*/*/n/单值/范围/范围步进/列表', () => {
    expect([...parseCronField('*', 0, 59)!]).toEqual(Array.from({ length: 60 }, (_, i) => i))
    expect([...parseCronField('*/15', 0, 59)!]).toEqual([0, 15, 30, 45])
    expect([...parseCronField('5', 0, 59)!]).toEqual([5])
    expect([...parseCronField('9-17/2', 0, 23)!]).toEqual([9, 11, 13, 15, 17])
    expect([...parseCronField('1,15,30', 0, 59)!].sort((a, b) => a - b)).toEqual([1, 15, 30])
  })

  it('名称映射与越界拒绝', () => {
    expect([...parseCronField('jan-mar', 1, 12, { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 })!]).toEqual([1, 2, 3])
    expect(parseCronField('60', 0, 59)).toBeNull()
    expect(parseCronField('x', 0, 59)).toBeNull()
    expect(parseCronField('10-5', 0, 59)).toBeNull()
    expect(parseCronField('*/0', 0, 59)).toBeNull()
    expect(parseCronField('', 0, 59)).toBeNull()
  })
})

describe('specialToExpr', () => {
  it('映射与未知', () => {
    expect(specialToExpr('@daily')).toBe('0 0 * * *')
    expect(specialToExpr('@hourly')).toBe('0 * * * *')
    expect(specialToExpr('@weekly')).toBe('0 0 * * 0')
    expect(specialToExpr('@reboot')).toBeNull()
    expect(specialToExpr('@nonsense')).toBeNull()
  })
})

describe('nextCronRun', () => {
  it('每分钟 / 步进 / 列表', () => {
    expect(nextCronRun('* * * * *', at(2026, 9, 11, 10, 0, 30))).toEqual(at(2026, 9, 11, 10, 1))
    expect(nextCronRun('*/5 * * * *', at(2026, 9, 11, 10, 1))).toEqual(at(2026, 9, 11, 10, 5))
    expect(nextCronRun('0,30 * * * *', at(2026, 9, 11, 10, 10))).toEqual(at(2026, 9, 11, 10, 30))
  })

  it('小时范围步进:9-17/2 在 10:00 后的下次为 11:00', () => {
    expect(nextCronRun('0 9-17/2 * * *', at(2026, 9, 11, 10, 0))).toEqual(at(2026, 9, 11, 11))
  })

  it('星期名与跨周:mon', () => {
    expect(nextCronRun('0 9 * * mon', at(2026, 9, 11, 10, 0))).toEqual(at(2026, 9, 14, 9))
  })

  it('dow 7 等价 0:周日', () => {
    expect(nextCronRun('0 12 * * 7', at(2026, 9, 11, 10, 0))).toEqual(at(2026, 9, 13, 12))
    expect(nextCronRun('0 12 * * 0', at(2026, 9, 11, 10, 0))).toEqual(at(2026, 9, 13, 12))
  })

  it('月份名与跨年:0 0 1 jan *', () => {
    expect(nextCronRun('0 0 1 jan *', at(2026, 9, 11))).toEqual(at(2027, 1, 1))
  })

  it('闰年:2 月 29 日最近一次为 2028-02-29', () => {
    expect(nextCronRun('0 0 29 2 *', at(2026, 9, 11))).toEqual(at(2028, 2, 29))
  })

  it('不可能组合返回 null:2 月 30 日', () => {
    expect(nextCronRun('0 0 30 2 *', at(2026, 9, 11))).toBeNull()
  })

  it('dom/dow 双受限 OR 语义:13 日或周五', () => {
    // 从 2026-09-11(周五)10:00 起:最近的匹配是 9/13(13 日,周日,dom 命中)
    expect(nextCronRun('0 0 13 * 5', at(2026, 9, 11, 10, 0))).toEqual(at(2026, 9, 13))
    // 13 日已过 → 下一次靠周五命中:9/18
    expect(nextCronRun('0 0 13 * 5', at(2026, 9, 13, 10, 0))).toEqual(at(2026, 9, 18))
  })

  it('from 恰在匹配分钟 → 取下一周期(严格晚于)', () => {
    expect(nextCronRun('0 9 * * *', at(2026, 9, 11, 9, 0, 0))).toEqual(at(2026, 9, 12, 9))
  })

  it('特殊入口:@daily 映射;@reboot / 非法返回 null', () => {
    expect(nextCronRun('@daily', at(2026, 9, 11, 10, 0))).toEqual(at(2026, 9, 12))
    expect(nextCronRun('@reboot', at(2026, 9, 11, 10, 0))).toBeNull()
  })

  it('非法表达式返回 null 不抛', () => {
    expect(nextCronRun('0 9 * *', at(2026, 9, 11))).toBeNull()
    expect(nextCronRun('61 * * * *', at(2026, 9, 11))).toBeNull()
    expect(nextCronRun('* * * * 8', at(2026, 9, 11))).toBeNull()
    expect(nextCronRun('', at(2026, 9, 11))).toBeNull()
    expect(nextCronRun('a b c d e', at(2026, 9, 11))).toBeNull()
  })
})
