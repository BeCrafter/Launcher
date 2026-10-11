import { describe, expect, it } from 'vitest'
import { tableSkeleton } from './note-table'

const name = (i: number): string => `列${i}`

describe('tableSkeleton', () => {
  it('3×2 = 1 行表头 + 1 行分隔 + 2 行空行(总行数含表头)', () => {
    const out = tableSkeleton(3, 2, name)
    expect(out.split('\n').filter((l) => l.trim() !== '')).toEqual([
      '| 列1 | 列2 |',
      '| --- | --- |',
      '|    |    |',
      '|    |    |'
    ])
  })

  it('前后各留一个空行 —— 表格必须自成一块,否则会粘进上一段', () => {
    const lines = tableSkeleton(2, 2, name).split('\n')
    expect(lines[0]).toBe('')
    expect(lines[lines.length - 1]).toBe('')
  })

  it('列数在每一行都一致(列数对不上预览里就是错位的表)', () => {
    for (const c of [1, 2, 5, 8]) {
      for (const line of tableSkeleton(4, c, name).split('\n')) {
        if (line.trim() === '') continue
        expect(line.split('|').length - 2).toBe(c)
      }
    }
  })

  it('1 行 = 只有表头,没有正文行', () => {
    const rows = tableSkeleton(1, 3, name).split('\n').filter((l) => l.trim() !== '')
    expect(rows).toHaveLength(2) // 表头 + 分隔
  })

  it('0 行 / 0 列会被夹到 1,不会产出畸形表格', () => {
    expect(() => tableSkeleton(0, 0, name)).not.toThrow()
    const rows = tableSkeleton(0, 0, name).split('\n').filter((l) => l.trim() !== '')
    expect(rows).toEqual(['| 列1 |', '| --- |'])
  })

  it('列名走调用方给的函数(要过 i18n)', () => {
    expect(tableSkeleton(2, 2, (i) => `Col ${i}`)).toContain('| Col 1 | Col 2 |')
  })
})
