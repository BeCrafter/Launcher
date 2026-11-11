import { describe, expect, it } from 'vitest'
import { minimalTextChange, type TextChange } from './text-change'

/** 不变量:把 change 作用到旧文本上必须得到新文本。 */
function apply(oldText: string, change: TextChange, offset = 0): string {
  return (
    oldText.slice(0, change.from - offset) +
    change.insert +
    oldText.slice(change.to - offset)
  )
}

describe('minimalTextChange', () => {
  it('只在行首插入缩进', () => {
    expect(minimalTextChange('- x', '  - x', 10)).toEqual({ from: 10, to: 10, insert: '  ' })
  })

  it('只删掉行首缩进', () => {
    expect(minimalTextChange('  - x', '- x', 10)).toEqual({ from: 10, to: 12, insert: '' })
  })

  it('只换列表标记那一个字符', () => {
    expect(minimalTextChange('- x', '* x', 10)).toEqual({ from: 10, to: 11, insert: '*' })
  })

  it('缩进与标记同时变化时合成一段', () => {
    // '  - x' → '    + x':公共前缀 2 个空格,公共后缀 ' x'
    expect(minimalTextChange('  - x', '    + x', 10)).toEqual({ from: 12, to: 13, insert: '  +' })
  })

  it('两边相同时返回 null', () => {
    expect(minimalTextChange('- x', '- x')).toBeNull()
  })

  it('各种情况下应用 change 都能还原出新文本', () => {
    const cases: [string, string][] = [
      ['- 甲', '  * 甲'],
      ['  - 甲', '- 甲'],
      ['- - -', '  - - -'],
      ['> - 甲', '>   * 甲'],
      ['\t- 甲', '\t  + 甲'],
      ['', '  ']
    ]
    for (const [oldText, nextText] of cases) {
      const change = minimalTextChange(oldText, nextText, 7)
      expect(change).not.toBeNull()
      expect(apply(oldText, change!, 7)).toBe(nextText)
    }
  })
})
