// cron 表达式解析与下次执行时间预测(vixie 语义;main/renderer 共用——渲染层实时预览需本地计算)
// 支持:* */n a a-b a-b/n 逗号列表 名称(jan-dec / sun-sat,大小写不敏感) dow 0-7(7≡0)
// dom 与 dow 双受限时按 OR 语义(vixie);不支持特殊入口(由 specialToExpr 映射)

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
}
const DOW_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6
}

function resolveToken(token: string, names?: Record<string, number>): number | null {
  const lower = token.toLowerCase()
  if (names && lower in names) return names[lower]
  if (!/^\d+$/.test(token)) return null
  return Number.parseInt(token, 10)
}

export function parseCronField(
  field: string,
  min: number,
  max: number,
  names?: Record<string, number>,
  dowMode = false
): Set<number> | null {
  const trimmed = field.trim()
  if (trimmed === '') return null
  const out = new Set<number>()

  for (const part of trimmed.split(',')) {
    const seg = part.trim()
    if (seg === '') return null

    const [rangePart, stepPart] = seg.split('/')
    if (stepPart !== undefined && (!/^\d+$/.test(stepPart) || Number(stepPart) === 0)) return null
    const step = stepPart === undefined ? 1 : Number(stepPart)

    let lo: number
    let hi: number
    if (rangePart === '*') {
      lo = min
      hi = max
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-')
      const ra = resolveToken(a, names)
      const rb = resolveToken(b, names)
      if (ra === null || rb === null) return null
      lo = ra
      hi = rb
    } else {
      const single = resolveToken(rangePart, names)
      if (single === null) return null
      lo = single
      hi = stepPart === undefined ? single : max
    }
    if (lo > hi) return null
    for (let v = lo; v <= hi; v += step) {
      if (v < min || v > max) return null // 越界即整字段非法(*/n 的 n>max 已在上面覆盖)
      out.add(dowMode && v === 7 ? 0 : v)
    }
  }
  return out.size > 0 ? out : null
}

/** @daily 等特殊入口 → 5 字段表达式;@reboot / 未知 → null(无固定时间点) */
export function specialToExpr(s: string): string | null {
  switch (s.trim().toLowerCase()) {
    case '@hourly':
      return '0 * * * *'
    case '@daily':
    case '@midnight':
      return '0 0 * * *'
    case '@weekly':
      return '0 0 * * 0'
    case '@monthly':
      return '0 0 1 * *'
    case '@yearly':
    case '@annually':
      return '0 0 1 1 *'
    default:
      return null // @reboot / 未知
  }
}

interface ParsedSchedule {
  minutes: number[]
  hours: number[]
  days: Set<number>
  months: Set<number>
  dows: Set<number>
  /** vixie 语义:字段以 `*` 开头(含星号步进如 `*` 加 `/n`)记 star,决定 dom/dow 的 AND/OR 组合 */
  domStar: boolean
  dowStar: boolean
}

export function parseCronExpr(expr: string): ParsedSchedule | null {
  const raw = expr.trim()
  if (raw === '') return null
  const normalized = raw.startsWith('@') ? specialToExpr(raw) : raw
  if (normalized === null) return null

  const fields = normalized.split(/\s+/)
  if (fields.length !== 5) return null
  const [fMin, fHour, fDom, fMon, fDow] = fields

  const minutes = parseCronField(fMin, 0, 59)
  const hours = parseCronField(fHour, 0, 23)
  const days = parseCronField(fDom, 1, 31)
  const months = parseCronField(fMon, 1, 12, MONTH_NAMES)
  const dows = parseCronField(fDow, 0, 7, DOW_NAMES, true)
  if (!minutes || !hours || !days || !months || !dows) return null

  return {
    minutes: [...minutes].sort((a, b) => a - b),
    hours: [...hours].sort((a, b) => a - b),
    days,
    months,
    dows,
    domStar: fDom.trim().startsWith('*'),
    dowStar: fDow.trim().startsWith('*')
  }
}

/** 下一次执行时间(严格晚于 from;无匹配 → null)。maxDays 默认 732(覆盖闰年 + 罕见月组合) */
export function nextCronRun(expr: string, from: Date, opts?: { maxDays?: number }): Date | null {
  const parsed = parseCronExpr(expr)
  if (!parsed) return null
  const maxDays = opts?.maxDays ?? 732

  const base = new Date(from.getTime())
  base.setSeconds(0, 0)
  base.setMinutes(base.getMinutes() + 1) // 从下一分钟起

  for (let d = 0; d < maxDays; d++) {
    const day = new Date(base.getTime())
    day.setDate(base.getDate() + d)
    if (!parsed.months.has(day.getMonth() + 1)) continue

    // vixie:dom 或 dow 以 * 开头 → 两字段 AND(等效于非 * 的那个);双受限 → OR
    const domMatch = parsed.days.has(day.getDate())
    const dowMatch = parsed.dows.has(day.getDay())
    const dayOk =
      parsed.domStar || parsed.dowStar ? domMatch && dowMatch : domMatch || dowMatch
    if (!dayOk) continue

    for (const h of parsed.hours) {
      for (const m of parsed.minutes) {
        const cand = new Date(day.getTime())
        cand.setHours(h, m, 0, 0)
        if (cand.getTime() > from.getTime()) return cand
      }
    }
  }
  return null
}
