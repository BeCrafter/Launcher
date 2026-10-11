// 相对时间文案(列表行与笔记头部共用)。
//
// 放在 lib 而不是留在某个组件里:两处都要用,复制一份迟早会漂移
// (一处改了阈值另一处没改,同一篇笔记在列表与头部显示成不同的时间)。

/** ISO 时间 → 「刚刚 / 3 分钟前 / 2 小时前 / 5 天前」;超过 30 天直接显示日期 */
export function relTime(iso: string, t: (k: string) => string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  const min = Math.round((Date.now() - ms) / 60000)
  if (min < 1) return t('notes.time.now')
  if (min < 60) return t('notes.time.min').replace('{N}', String(min))
  const hr = Math.round(min / 60)
  if (hr < 24) return t('notes.time.hour').replace('{N}', String(hr))
  const day = Math.round(hr / 24)
  if (day < 30) return t('notes.time.day').replace('{N}', String(day))
  return iso.slice(0, 10)
}
