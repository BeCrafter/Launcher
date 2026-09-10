// ported-from: docs/demo/js/drawer.js sciDescribe/sciPlistFragment @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// StartCalendarInterval 规则构建纯函数(逐行为移植 drawer.js sciDescribe/sciPlistFragment)
import { fmt } from '../i18n'
import type { Language } from '@shared/settings'
import type { SciEntry } from '@shared/models'

type T = (k: string) => string

export type SciData = {
  Minute: number | null
  Hour: number | null
  Day: number | null
  Weekday: number | null
  Month: number | null
}

export function sciDescribe(d: SciData, lang: Language, t: T): string {
  const isEn = lang === 'en-US'
  const pad = (v: number): string => String(v).padStart(2, '0')
  const wk = (): string | null => (d.Weekday !== null ? t('cron.wd.' + d.Weekday) : null)
  const mo = (): string | null => (d.Month !== null ? t('cron.mo.' + d.Month) : null)
  const dy = (): string | null => (d.Day !== null ? (isEn ? String(d.Day) : d.Day + '日') : null)
  const hm = (): string =>
    (d.Hour !== null ? pad(d.Hour) : '**') + ':' + (d.Minute !== null ? pad(d.Minute) : '**')
  // 无日期维度:纯时间 / 间隔描述
  if (d.Month === null && d.Day === null && d.Weekday === null) {
    if (d.Hour !== null && d.Minute !== null) return fmt(t('sci.describe.daily'), { T: hm() })
    if (d.Hour !== null) return fmt(t('sci.describe.hourOfDay'), { H: d.Hour })
    if (d.Minute !== null) return fmt(t('sci.describe.minEachHour'), { M: d.Minute })
    return t('sci.describe.everyMinute')
  }
  // 含日期维度:zh 语序 月份 日期 星期(与旧输出一致);en 用 at 表达时刻
  const parts = isEn ? [wk(), mo(), dy()] : [mo(), dy(), wk()]
  const head = parts.filter(Boolean).join(' ')
  if (isEn) return head + ' ' + fmt(t('sci.describe.at'), { T: hm() })
  return head + ' ' + hm() + ' ' + t('sci.describe.trigger')
}

export function sciPlistFragment(d: SciData, t: T): string {
  const keys: string[] = []
  if (d.Minute !== null) keys.push('Minute=' + d.Minute)
  if (d.Hour !== null) keys.push('Hour=' + d.Hour)
  if (d.Day !== null) keys.push('Day=' + d.Day)
  if (d.Weekday !== null) keys.push('Weekday=' + d.Weekday)
  if (d.Month !== null) keys.push('Month=' + d.Month)
  return keys.length ? '<dict> ' + keys.join(' ') + ' </dict>' : '<dict/> /* ' + t('sci.plist.wildcard') + ' */'
}

// demo sciAddEntry 的快速预设(index.html 静态 chips + drawer.js sciInsertPreset 调用参数)
export const SCI_PRESETS: { entry: Partial<SciEntry>; labelKey: string }[] = [
  { entry: { Minute: 0, Hour: 9 }, labelKey: 'sci.preset.daily9Desc' },
  { entry: { Minute: 0, Hour: 12 }, labelKey: 'sci.preset.daily12Desc' },
  { entry: { Minute: 0, Hour: 18 }, labelKey: 'sci.preset.daily18Desc' },
  { entry: { Minute: 0, Hour: 9, Weekday: 1 }, labelKey: 'sci.preset.mon9Desc' },
  { entry: { Minute: 0, Hour: 9, Weekday: 5 }, labelKey: 'sci.preset.fri9Desc' },
  { entry: { Minute: 0, Hour: 0, Day: 1 }, labelKey: 'sci.preset.monthly1Desc' },
  { entry: { Minute: 0 }, labelKey: 'sci.preset.hourlyDesc' }
]

// demo SCI 快捷 chips(index.html 静态文案键)
export const SCI_PRESET_LABEL_KEYS = [
  'sci.preset.daily9',
  'sci.preset.daily12',
  'sci.preset.daily18',
  'sci.preset.mon9',
  'sci.preset.fri9',
  'sci.preset.monthly1',
  'sci.preset.hourly'
]
