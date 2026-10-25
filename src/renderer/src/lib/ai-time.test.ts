import { describe, expect, it } from 'vitest'
import { formatClock, formatDuration } from './ai-time'

describe('formatDuration', () => {
  it('小于 1 秒按毫秒显示', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(412)).toBe('412ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('小于 1 分钟按秒显示一位小数', () => {
    expect(formatDuration(1000)).toBe('1.0s')
    expect(formatDuration(1540)).toBe('1.5s')
    expect(formatDuration(59_000)).toBe('59.0s')
  })

  it('超过 1 分钟按 Xm Ys 显示,秒进位到分钟', () => {
    expect(formatDuration(60_000)).toBe('1m 0s')
    expect(formatDuration(61_500)).toBe('1m 2s')
    expect(formatDuration(119_500)).toBe('2m 0s')
  })

  it('负数钳到 0', () => {
    expect(formatDuration(-10)).toBe('0ms')
  })
})

describe('formatClock', () => {
  it('输出本地 HH:mm:ss', () => {
    expect(formatClock(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe('03:04:05')
    expect(formatClock(new Date(2026, 9, 25, 23, 59, 0).getTime())).toBe('23:59:00')
  })
})
