import { describe, expect, it } from 'vitest'
import { planQuoteExit } from './md-quote-continuation'

describe('planQuoteExit:空引用行回车退出', () => {
  it('`> ` → 删掉标记,变成空行', () => {
    expect(planQuoteExit('> ', 2)).toEqual({ from: 0, to: 2, caret: 0 })
  })

  it('`>`(没有空格)也一样', () => {
    expect(planQuoteExit('>', 1)).toEqual({ from: 0, to: 1, caret: 0 })
  })

  it('尾随空白一并清掉', () => {
    expect(planQuoteExit('>   ', 4)).toEqual({ from: 0, to: 4, caret: 0 })
  })

  it('嵌套引用只退最内层一层', () => {
    expect(planQuoteExit('> > ', 4)).toEqual({ from: 2, to: 4, caret: 2 })
    expect(planQuoteExit('>>', 2)).toEqual({ from: 1, to: 2, caret: 1 })
  })

  it('保留前导缩进(它属于还没退掉的外层容器)', () => {
    expect(planQuoteExit('  > ', 4)).toEqual({ from: 2, to: 4, caret: 2 })
    expect(planQuoteExit('  > > ', 6)).toEqual({ from: 4, to: 6, caret: 4 })
  })

  it('4 个前导空格是缩进代码块,不算引用', () => {
    expect(planQuoteExit('    > ', 6)).toBeNull()
  })

  it('有内容的引用行交给上游续行', () => {
    expect(planQuoteExit('> 甲', 3)).toBeNull()
    expect(planQuoteExit('> - ', 4)).toBeNull()
    expect(planQuoteExit('> [!note]', 10)).toBeNull()
  })

  it('普通行与空串不接管', () => {
    expect(planQuoteExit('正文', 2)).toBeNull()
    expect(planQuoteExit('', 0)).toBeNull()
  })

  it('光标还在引用前缀里时不接管(行中切分交给默认行为)', () => {
    expect(planQuoteExit('> ', 0)).toBeNull()
    expect(planQuoteExit('> ', 1)).toBeNull()
  })
})
