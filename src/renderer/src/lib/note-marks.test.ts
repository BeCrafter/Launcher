import { describe, expect, it } from 'vitest'
import { planClearMarks, planWrap, stripInlineMarks } from './note-marks'

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
    expect(stripInlineMarks('==高亮==')).toBe('高亮')
  })

  it('unwraps links but keeps their text', () => {
    expect(stripInlineMarks('[文字](https://example.com)')).toBe('文字')
  })

  it('recurses into nested marks', () => {
    expect(stripInlineMarks('**粗里有*斜*体**')).toBe('粗里有斜体')
  })

  it('strips every layer when the same mark was applied more than once', () => {
    // 选区一直包着标记再点一次格式，就会摞成 `====高亮====`；一次清除要剥干净
    expect(stripInlineMarks('====高亮====')).toBe('高亮')
    expect(stripInlineMarks('======高亮======')).toBe('高亮')
    expect(stripInlineMarks('*====高亮====*')).toBe('高亮')
    expect(stripInlineMarks('==~~*高亮*~~==')).toBe('高亮')
  })

  it('leaves a lone marker alone — eating it would swallow a neighbouring line', () => {
    expect(stripInlineMarks('前半 **后半')).toBe('前半 **后半')
    expect(stripInlineMarks('**粗')).toBe('**粗')
    // 两侧有空格不是高亮,与预览一致
    expect(stripInlineMarks('比较 == 空格 == 的情况')).toBe('比较 == 空格 == 的情况')
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

describe('planClearMarks', () => {
  // 把计划应用到原文上，方便断言「清完是什么样、选区落在哪」
  function apply(doc: string, from: number, to: number): string | null {
    const plan = planClearMarks(doc, from, to)
    if (plan === null) return null
    expect(plan.from).toBeLessThanOrEqual(from)
    expect(plan.to).toBeGreaterThanOrEqual(to)
    const next = doc.slice(0, plan.from) + plan.insert + doc.slice(plan.to)
    expect(next.slice(plan.from, plan.from + plan.insert.length)).toBe(plan.insert)
    return next
  }

  it('clears marks that sit inside the selection', () => {
    expect(apply('**粗**', 0, 5)).toBe('粗')
    expect(apply('==高亮==', 0, 6)).toBe('高亮')
    expect(apply('*斜* 与 ==亮==', 0, 11)).toBe('斜 与 亮')
    expect(apply('`码`', 0, 3)).toBe('码')
  })

  it('clears marks that wrap the selection (double-click selects the text only)', () => {
    expect(apply('==高亮==', 2, 4)).toBe('高亮')
    expect(apply('**粗体**', 2, 4)).toBe('粗体')
    expect(apply('_字母_', 1, 3)).toBe('字母')
    expect(apply('`码`', 1, 2)).toBe('码')
    expect(apply('~~删~~', 2, 3)).toBe('删')
  })

  it('clears every stacked layer in one go', () => {
    expect(apply('====高亮====', 0, 10)).toBe('高亮')
    expect(apply('====高亮====', 4, 6)).toBe('高亮')
    expect(apply('*====高亮====*', 0, 12)).toBe('高亮')
    expect(apply('======高亮======', 6, 8)).toBe('高亮')
  })

  it('unwraps a whole link when the selection covers it', () => {
    const doc = '[文字](https://example.com)'
    expect(apply(doc, 0, doc.length)).toBe('文字')
  })

  it('returns null when there is nothing safe to clear', () => {
    expect(planClearMarks('普通文字', 0, 4)).toBeNull()
    expect(planClearMarks('**粗', 0, 3)).toBeNull()
    expect(planClearMarks('前半 **后半', 0, 7)).toBeNull()
    // 选区横跨两段独立的斜体：外面两个 `*` 不是一对，不能删
    expect(planClearMarks('*a* 和 *b*', 1, 8)).toBeNull()
    expect(planClearMarks('# 标题', 2, 4)).toBeNull()
  })

  it('is stable: a cleared document has nothing left to clear', () => {
    const once = apply('====*高亮*====', 0, 12)
    expect(once).toBe('高亮')
    expect(planClearMarks(once ?? '', 0, 2)).toBeNull()
  })
})
