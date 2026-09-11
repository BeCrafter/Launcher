// ported-from: docs/demo/js/crontab.js parseCronExpr @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// Cron 表达式人话解析(逐行为移植 docs/demo/js/crontab.js parseCronExpr,双语分支保留)
import { fmt } from '../i18n'
import { nextCronRun } from '@shared/cron-next-run'
import { ELEVATION_CANCELLED, ELEVATION_FAILED } from '@shared/ipc'
import { showToast } from './utils'
import type { Language } from '@shared/settings'

export function parseCronExpr(expr: string, lang: Language, t: (k: string) => string): string {
  const raw = expr.trim()
  if (raw.startsWith('@')) {
    // 特殊入口(vixie):@reboot/@daily 等,demo 解析器只认 5 字段 → 专用文案
    const name = raw.slice(1).toLowerCase()
    const key = `cron.parse.special.${name === 'midnight' ? 'daily' : name === 'annually' ? 'yearly' : name}`
    const text = t(key)
    return text === key ? t('cron.parse.invalid') : text
  }
  const parts = raw.split(/\s+/)
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

// ── 下次执行时间展示(卡片行 + 编辑预览共用;U5 增强项)──


export function formatNextRun(expr: string, t: (k: string) => string, now: Date = new Date()): string {
  if (expr.trim() === '@reboot') return t('cron.next.reboot')
  const next = nextCronRun(expr, now)
  if (!next) return t('cron.next.none')
  const p = (n: number): string => String(n).padStart(2, '0')
  const hhmm = `${p(next.getHours())}:${p(next.getMinutes())}`
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const tomorrow = new Date(now.getTime())
  tomorrow.setDate(now.getDate() + 1)
  if (sameDay(next, now)) return fmt(t('cron.next.today'), { T: hhmm })
  if (sameDay(next, tomorrow)) return fmt(t('cron.next.tomorrow'), { T: hhmm })
  return fmt(t('cron.next.date'), { D: `${p(next.getMonth() + 1)}-${p(next.getDate())}`, T: hhmm })
}

// IPC 错误 → 用户提示(提权取消/失败用稳定错误码判定;其余归为通用失败)
export function cronErrorToast(err: unknown, tr: (k: string) => string): void {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes(ELEVATION_CANCELLED)) showToast(tr('toast.elevCancelled'), '#8888aa', 'fa-ban')
  else if (msg.includes(ELEVATION_FAILED)) showToast(tr('toast.elevFailed'), '#f87171', 'fa-circle-exclamation')
  else showToast(tr('toast.cronOpFailed'), '#f87171', 'fa-circle-exclamation')
}
