// cron 日志文本 → LogLine 纯函数(尾读内容的展示层转换)
// 行首时间戳(2026-09-11 10:00:00 / ISO T 分隔)取为 ts,无则用文件 mtime;type 按关键词推断

import type { LogLine, LogType } from '../../shared/models'

const TS_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/

export function classifyLogLine(text: string): LogType {
  if (/(error|fail|fatal|exception|denied|traceback|refused)/i.test(text)) return 'err'
  if (/warn/i.test(text)) return 'warn'
  if (/(\bok\b|success|done|complete|finished)/i.test(text)) return 'ok'
  return 'info'
}

export function formatLogTs(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function parseLogText(text: string, fallbackTs: string, maxLines = 2000): LogLine[] {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  return lines.slice(-maxLines).map((raw) => {
    const m = raw.match(TS_RE)
    const rest = m === null ? '' : raw.slice(m[0].length).trim()
    // 行首时间戳进 ts 列;**正文为空时退回整行**,避免把「整行就是时间戳」的输出(如 date)吞成空正文
    // —— 否则正文列全空,看起来就像"日志没有内容"。
    return {
      ts: m === null ? fallbackTs : `${m[1]} ${m[2]}`,
      type: classifyLogLine(raw),
      text: rest === '' ? raw : rest
    }
  })
}
