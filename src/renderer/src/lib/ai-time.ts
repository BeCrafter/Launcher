// 时间/耗时格式化:footer、导出转录共用,避免两个地方各写一套。
// 注意:工具步骤区仍用 AiMessages 里的 aiFmtMs(保持原有显示不变)。

/** 本地时间 HH:mm:ss */
export function formatClock(stamp: number): string {
  const d = new Date(stamp)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 耗时可读化:<1s → xxxms,<60s → x.xs,再长 → Xm Ys */
export function formatDuration(ms: number): string {
  const safe = Math.max(0, ms)
  if (safe < 1000) return `${Math.round(safe)}ms`
  if (safe < 60_000) return `${(safe / 1000).toFixed(1)}s`
  let minutes = Math.floor(safe / 60_000)
  let seconds = Math.round((safe % 60_000) / 1000)
  if (seconds === 60) {
    minutes += 1
    seconds = 0
  }
  return `${minutes}m ${seconds}s`
}
