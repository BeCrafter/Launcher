import { describe, expect, it } from 'vitest'
import { planWrap, stripInlineMarks } from './note-marks'

describe('planWrap', () => {
  it('wraps a selection and keeps it selected', () => {
    expect(planWrap('粗', 3, '**')).toEqual({ insert: '**粗**', anchor: 3, head: 8 })
  })

  it('inserts an empty pair and puts the caret in the middle when nothing is selected', () => {
    expect(planWrap('', 5, '**')).toEqual({ insert: '****', anchor: 7, head: 7 })
    expect(planWrap('', 5, '[', '](https://)')).toEqual({
      insert: '[ ](https://)'.replace(' ', ''),
      anchor: 6,
      head: 6
    })
  })
})

describe('stripInlineMarks', () => {
  it('drops paired inline marks', () => {
    expect(stripInlineMarks('**粗**')).toBe('粗')
    expect(stripInlineMarks('*斜*')).toBe('斜')
    expect(stripInlineMarks('***粗斜***')).toBe('粗斜')
    expect(stripInlineMarks('__粗__')).toBe('粗')
    expect(stripInlineMarks('~~删~~')).toBe('删')
    expect(stripInlineMarks('`码`')).toBe('码')
    expect(stripInlineMarks('^上^')).toBe('上')
    expect(stripInlineMarks('~下~')).toBe('下')
  })

  it('unwraps links but keeps their text', () => {
    expect(stripInlineMarks('[文字](https://example.com)')).toBe('文字')
  })

  it('recurses into nested marks', () => {
    expect(stripInlineMarks('**粗里有*斜*体**')).toBe('粗里有斜体')
  })

  it('leaves a lone marker alone — eating it would swallow a neighbouring line', () => {
    expect(stripInlineMarks('前半 **后半')).toBe('前半 **后半')
    expect(stripInlineMarks('**粗')).toBe('**粗')
  })

  it('leaves escapes, images and autolinks untouched — those are content, not formatting', () => {
    expect(stripInlineMarks('\\*不是斜体\\*')).toBe('\\*不是斜体\\*')
    expect(stripInlineMarks('![图](assets/a.png)')).toBe('![图](assets/a.png)')
    expect(stripInlineMarks('<https://example.com>')).toBe('<https://example.com>')
  })

  it('keeps identifiers with underscores intact, same as the preview', () => {
    expect(stripInlineMarks('foo_bar_baz')).toBe('foo_bar_baz')
  })

  it('uses the surrounding characters to judge underscores at the selection edge', () => {
    // 选区从 `_` 开始，左边其实是普通汉字 —— 靠 before 才能与预览判成一致
    expect(stripInlineMarks('_斜_', '中')).toBe('_斜_')
    expect(stripInlineMarks('_斜_', ' ')).toBe('斜')
  })

  it('never touches a match that pokes outside the selection', () => {
    // 选区正好切在 `**粗**` 中间：标记一半在选区里
    expect(stripInlineMarks('粗**和')).toBe('粗**和')
    expect(stripInlineMarks('**粗', '')).toBe('**粗')
  })

  it('is idempotent', () => {
    const once = stripInlineMarks('**粗** 与 *斜*')
    expect(stripInlineMarks(once)).toBe(once)
  })

  it('does not touch line-level marks (those would break structure)', () => {
    expect(stripInlineMarks('# 标题')).toBe('# 标题')
    expect(stripInlineMarks('> 引用')).toBe('> 引用')
    expect(stripInlineMarks('- 列表')).toBe('- 列表')
    expect(stripInlineMarks('| a | b |')).toBe('| a | b |')
  })
})
