// 笔记时间戳:ISO-8601 **带本地偏移**。
//
// 为什么不用 toISOString():那给的是 UTC(`…Z`)。笔记的 frontmatter 是给人看、给 Obsidian
// 读的,本地时间 + 偏移才是可读的形态;而且同机同区写出的值可按字典序排 —— 这也是为什么
// `created`/`updated` 在文件里能当字符串比较。

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** 毫秒时间戳 → `2026-10-09T15:41:03+08:00`(本地时区) */
export function localIso(ms: number): string {
  const d = new Date(ms)
  // getTimezoneOffset 的符号与 ISO 相反:UTC+8 返回 -480
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

/** 文件名用的紧凑时间戳 `20261009154103`(附件命名) */
export function compactStamp(ms: number): string {
  const d = new Date(ms)
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}
