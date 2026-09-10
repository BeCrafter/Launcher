import { describe, expect, it } from 'vitest'
import { makeT } from '../i18n'
import { parseCronExpr } from './cron'

const zh = makeT('zh-CN')
const en = makeT('en-US')

describe('parseCronExpr(zh)', () => {
  it('每分钟', () => {
    expect(parseCronExpr('* * * * *', 'zh-CN', zh)).toBe(zh('cron.parse.everyMinute'))
  })
  it('每小时通配但分钟为 0 → daily 模板 + 「每小时」(demo 原样行为)', () => {
    expect(parseCronExpr('0 * * * *', 'zh-CN', zh)).toBe('每天 ' + zh('cron.parse.hour') + ' 执行')
  })
  it('每天 9:00 执行', () => {
    expect(parseCronExpr('0 9 * * *', 'zh-CN', zh)).toBe('每天 9:00 执行')
  })
  it('步进分钟(zh 沿用 daily 文案)', () => {
    expect(parseCronExpr('*/30 * * * *', 'zh-CN', zh)).toBe('每天 ' + zh('cron.parse.hour') + ' 执行')
  })
  it('工作日组', () => {
    expect(parseCronExpr('0 9 * * 1-5', 'zh-CN', zh)).toBe('每' + zh('cron.wd.1-5') + ' 9:00 执行')
  })
  it('单周几', () => {
    expect(parseCronExpr('0 18 * * 5', 'zh-CN', zh)).toBe('每' + zh('cron.wd.5') + ' 18:00 执行')
  })
  it('月份通配时 M 保留原文 *(demo 原样行为);分钟不补零', () => {
    expect(parseCronExpr('0 0 1 * *', 'zh-CN', zh)).toBe('* 1日 0:00 执行')
  })
  it('指定月(zh 数字月)', () => {
    expect(parseCronExpr('0 0 1 3 *', 'zh-CN', zh)).toBe('3月 1日 0:00 执行')
  })
  it('字段不足回 invalid', () => {
    expect(parseCronExpr('* * *', 'zh-CN', zh)).toBe(zh('cron.parse.invalid'))
  })
})

describe('parseCronExpr(en)', () => {
  it('步进分钟 → every N minutes', () => {
    expect(parseCronExpr('*/30 * * * *', 'en-US', en)).toBe(
      en('cron.parse.intervalMin').replace('{N}', '30')
    )
  })
  it('工作日组 → weekdays 模板', () => {
    const w = en('cron.wd.1-5')
    expect(parseCronExpr('0 9 * * 1-5', 'en-US', en)).toBe(
      en('cron.parse.weekdays').replace('{W}', w).replace('{T}', '9:00')
    )
  })
  it('周几单值 → weekly 模板', () => {
    const w = en('cron.wd.5')
    expect(parseCronExpr('0 18 * * 5', 'en-US', en)).toBe(
      en('cron.parse.weekly').replace('{W}', w).replace('{T}', '18:00')
    )
  })
  it('指定月 → monthly 模板(月份名;分钟不补零,demo 原样)', () => {
    const m = en('cron.mo.2')
    expect(parseCronExpr('0 0 1 2 *', 'en-US', en)).toBe(
      en('cron.parse.monthly').replace('{M}', m).replace('{D}', '1').replace('{T}', '0:00')
    )
  })
})
