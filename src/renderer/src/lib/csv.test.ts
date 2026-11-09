import { describe, expect, it } from 'vitest'
import { parseDelimited } from './csv'

describe('parseDelimited', () => {
  it('基本 CSV:引号内的分隔符与换行', () => {
    const t = parseDelimited('a,b\n"x,y","line1\nline2"\n', ',', 10, 10)
    expect(t.rows).toEqual([
      ['a', 'b'],
      ['x,y', 'line1\nline2']
    ])
    expect(t.truncatedRows).toBe(false)
    expect(t.truncatedCols).toBe(false)
  })

  it('`""` 转义成一个双引号', () => {
    expect(parseDelimited('"say ""hi""",b', ',', 10, 10).rows).toEqual([['say "hi"', 'b']])
  })

  it('CRLF / CR 都算换行', () => {
    expect(parseDelimited('a,b\r\nc,d\r', ',', 10, 10).rows).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ])
  })

  it('TSV', () => {
    expect(parseDelimited('a\tb\n1\t2', '\t', 10, 10).rows).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('行数超过上限时截断', () => {
    const t = parseDelimited('1\n2\n3\n', ',', 2, 10)
    expect(t.rows).toEqual([['1'], ['2']])
    expect(t.truncatedRows).toBe(true)
  })

  it('列数超过上限时截断', () => {
    const t = parseDelimited('a,b,c', ',', 10, 2)
    expect(t.rows).toEqual([['a', 'b']])
    expect(t.truncatedCols).toBe(true)
  })

  it('空文本没有行', () => {
    expect(parseDelimited('', ',', 10, 10).rows).toEqual([])
  })
})
