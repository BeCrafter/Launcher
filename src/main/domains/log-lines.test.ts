import { describe, expect, it } from 'vitest'
import { classifyLogLine, parseLogText } from './log-lines'

const FB = '1999-01-01 00:00:00'

describe('parseLogText(cron 日志尾读 → 展示模型)', () => {
  it('行首带时间戳且**后面有正文** → 时间戳进 ts,正文进 text', () => {
    const [l] = parseLogText('2026-09-13 10:00:00 server started', FB)
    expect(l.ts).toBe('2026-09-13 10:00:00')
    expect(l.text).toBe('server started')
    expect(l.type).toBe('info')
  })

  it('整行就是时间戳(如 `date` 的输出)→ 不吞正文:ts 用行内真实时间戳,正文退回整行', () => {
    // 修复前:剥离时间戳后 text 成了空串 → 界面上正文列全空,看起来"日志没内容"
    const [l] = parseLogText('2026-09-13 14:15:00', FB)
    expect(l.ts).toBe('2026-09-13 14:15:00') // 行内真实值,而非文件 mtime
    expect(l.text).toBe('2026-09-13 14:15:00') // 内容不丢
  })

  it('无时间戳的行 → 整行 text + 回退 ts', () => {
    const [l] = parseLogText('CST', FB)
    expect(l.text).toBe('CST')
    expect(l.ts).toBe(FB)
  })

  it('空行被丢弃;limit 取尾部 maxLines 行', () => {
    expect(parseLogText('\n\n  \nhello\n', FB)).toHaveLength(1)
    const many = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n')
    const out = parseLogText(many, FB, 3)
    expect(out.map((l) => l.text)).toEqual(['line7', 'line8', 'line9'])
  })
})

describe('classifyLogLine', () => {
  it('按关键词推断级别', () => {
    expect(classifyLogLine('Error: boom')).toBe('err')
    expect(classifyLogLine('warning: slow')).toBe('warn')
    expect(classifyLogLine('done')).toBe('ok')
    expect(classifyLogLine('starting up')).toBe('info')
  })
})
