// Cron 表达式人话解析(逐行为移植 docs/demo/js/crontab.js parseCronExpr,双语分支保留)
import { fmt } from '../i18n'
import type { Language } from '@shared/settings'

export function parseCronExpr(expr: string, lang: Language, t: (k: string) => string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length < 5) return t('cron.parse.invalid')
  const [min, hour, dom, mon, dow] = parts
  const isEn = lang === 'en-US'
  const isInt = (v: string): boolean => /^\d+$/.test(v)
  const pad = (v: string): string => String(v).padStart(2, '0')
  // 时间片段:hour 为数字 → H:MM;hour 为 * 时 zh 沿旧文案「每小时」,en 用整点
  const T = isInt(hour) ? hour + ':' + (isInt(min) ? pad(min) : min) : t('cron.parse.hour')
  const W = ((): string => {
    if (dow === '1-5') return t('cron.wd.1-5')
    if (isInt(dow)) return t('cron.wd.' + (parseInt(dow, 10) % 7))
    return dow
  })()
  const isWeekdayGroup = dow === '1-5'
  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*')
    return t('cron.parse.everyMinute')
  if (dom === '*' && mon === '*' && dow === '*') {
    if (hour === '*' && min === '*') return t('cron.parse.everyHour')
    // hour 通配且分钟为步进(*/30):en 直接给 "every N minutes";zh 保持原样
    if (hour === '*') {
      const mm = /^\*\/(\d+)$/.exec(min)
      if (isEn && mm) return t('cron.parse.intervalMin').replace('{N}', mm[1])
    }
    // zh 沿用原样「每天 9:00 执行 / 每天 每小时 执行」
    return fmt(t('cron.parse.daily'), { T })
  }
  if (dom === '*' && mon === '*') {
    if (isEn)
      return isWeekdayGroup
        ? fmt(t('cron.parse.weekdays'), { W, T })
        : fmt(t('cron.parse.weekly'), { W, T })
    return '每' + W + ' ' + T + ' 执行'
  }
  // monthly:zh 输出 "{mon}月 {dom}日 H:MM 执行";en 用月份名
  const M = isInt(mon) ? (isEn ? t('cron.mo.' + parseInt(mon, 10)) : mon + '月') : mon
  if (isEn) {
    return mon === '*'
      ? fmt(t('cron.parse.monthDay'), { D: dom, T })
      : fmt(t('cron.parse.monthly'), { M, D: dom, T })
  }
  return M + ' ' + dom + '日 ' + T + ' 执行'
}
