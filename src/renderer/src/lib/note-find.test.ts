import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FIND_OPTIONS,
  MAX_FIND_MATCHES,
  buildReplaceAll,
  findMatches,
  initialMatchIndex,
  nextMatchIndex,
  replacementAt,
  type FindOptions
} from './note-find'

function opts(patch: Partial<FindOptions> = {}): FindOptions {
  return { ...DEFAULT_FIND_OPTIONS, ...patch }
}

function spans(text: string, query: string, options: Partial<FindOptions> = {}): [number, number][] {
  return findMatches(text, query, opts(options)).matches.map((match) => [match.from, match.to])
}

describe('findMatches', () => {
  it('空查询不产生匹配也不报错', () => {
    expect(findMatches('abc', '', DEFAULT_FIND_OPTIONS)).toEqual({
      matches: [],
      error: null,
      truncated: false
    })
  })

  it('默认大小写不敏感，Aa 打开后区分', () => {
    const text = 'Cat cat CAT'
    expect(spans(text, 'cat')).toEqual([
      [0, 3],
      [4, 7],
      [8, 11]
    ])
    expect(spans(text, 'cat', { caseSensitive: true })).toEqual([[4, 7]])
  })

  it('全词排除词内命中', () => {
    const text = 'cat concatenate cat.'
    expect(spans(text, 'cat', { wholeWord: true })).toEqual([
      [0, 3],
      [16, 19]
    ])
  })

  it('全词对中文同样按字母处理', () => {
    expect(spans('，笔记，', '笔记', { wholeWord: true })).toEqual([[1, 3]])
    expect(spans('这是笔记，笔记里。', '笔记', { wholeWord: true })).toEqual([])
  })

  it('正则模式支持捕获组', () => {
    expect(spans('hello hallo', 'h(a|e)llo', { regex: true })).toEqual([
      [0, 5],
      [6, 11]
    ])
  })

  it('正则 m 让 ^ / $ 按行匹配', () => {
    expect(spans('one\ntwo\nthree', '^t', { regex: true })).toEqual([
      [4, 5],
      [8, 9]
    ])
  })

  it('零长度匹配被忽略且不会卡死', () => {
    expect(spans('ba', 'a*', { regex: true })).toEqual([[1, 2]])
    expect(spans('a\nb\nc', '^', { regex: true })).toEqual([])
  })

  it('无效正则返回错误态', () => {
    expect(findMatches('abc', '(', opts({ regex: true }))).toEqual({
      matches: [],
      error: 'invalid-regex',
      truncated: false
    })
  })

  it('超过上限时截断并标记', () => {
    const result = findMatches('a'.repeat(MAX_FIND_MATCHES + 10), 'a', DEFAULT_FIND_OPTIONS)
    expect(result.matches).toHaveLength(MAX_FIND_MATCHES)
    expect(result.truncated).toBe(true)
  })

  it('正好等于上限时不标记截断', () => {
    const result = findMatches('a'.repeat(MAX_FIND_MATCHES), 'a', DEFAULT_FIND_OPTIONS)
    expect(result.matches).toHaveLength(MAX_FIND_MATCHES)
    expect(result.truncated).toBe(false)
  })
})

describe('nextMatchIndex / initialMatchIndex', () => {
  it('循环前进与后退', () => {
    expect(nextMatchIndex(0, 3, 1)).toBe(1)
    expect(nextMatchIndex(2, 3, 1)).toBe(0)
    expect(nextMatchIndex(0, 3, -1)).toBe(2)
    expect(nextMatchIndex(0, 0, 1)).toBe(0)
  })

  it('取结束位置在光标之后的第一处，文末回到第一处', () => {
    const matches = [
      { from: 0, to: 3 },
      { from: 4, to: 7 },
      { from: 8, to: 11 }
    ]
    expect(initialMatchIndex(matches, 0)).toBe(0)
    expect(initialMatchIndex(matches, 3)).toBe(1)
    expect(initialMatchIndex(matches, 4)).toBe(1)
    expect(initialMatchIndex(matches, 100)).toBe(0)
    expect(initialMatchIndex([], 5)).toBe(0)
  })
})

describe('替换', () => {
  it('纯文本替换按字面量，$1 不被展开', () => {
    const text = 'hello'
    const match = { from: 0, to: 5 }
    expect(replacementAt(text, match, 'hello', DEFAULT_FIND_OPTIONS, '$1')).toBe('$1')
  })

  it('正则替换支持 $1 / $&', () => {
    const text = 'hello hallo'
    const match = { from: 0, to: 5 }
    expect(replacementAt(text, match, 'h(a|e)llo', opts({ regex: true }), '<$1>')).toBe('<e>')
    expect(replacementAt(text, match, 'h(a|e)llo', opts({ regex: true }), '$&')).toBe('hello')
  })

  it('全部替换产出升序、互不重叠的 changes', () => {
    const text = 'cat cat'
    const { matches } = findMatches(text, 'cat', DEFAULT_FIND_OPTIONS)
    const changes = buildReplaceAll(text, matches, 'cat', DEFAULT_FIND_OPTIONS, 'dog')
    expect(changes).toEqual([
      { from: 0, to: 3, insert: 'dog' },
      { from: 4, to: 7, insert: 'dog' }
    ])
    const rebuilt =
      text.slice(0, changes[0].from) +
      changes[0].insert +
      text.slice(changes[0].to, changes[1].from) +
      changes[1].insert +
      text.slice(changes[1].to)
    expect(rebuilt).toBe('dog dog')
  })

  it('全部替换支持正则捕获组', () => {
    const text = 'a1 b2'
    const { matches } = findMatches(text, '([a-z])(\\d)', opts({ regex: true }))
    const changes = buildReplaceAll(text, matches, '([a-z])(\\d)', opts({ regex: true }), '$2$1')
    expect(changes.map((change) => change.insert)).toEqual(['1a', '2b'])
  })
})
