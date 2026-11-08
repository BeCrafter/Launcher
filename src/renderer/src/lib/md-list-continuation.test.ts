import { describe, expect, it } from 'vitest'
import { planMarkdownContinuation } from './md-list-continuation'

describe('planMarkdownContinuation:宽松任务', () => {
  it('`-[]` → 当前行补成 `- [ ] `,下一行继续任务', () => {
    expect(planMarkdownContinuation('-[]', 3)).toEqual({
      normalize: { from: 0, to: 3, insert: '- [ ] ' },
      insertAt: 3,
      insert: '\n- [ ] ',
      caret: 13
    })
  })

  it('`- [] 甲` → 保留内容并规整', () => {
    expect(planMarkdownContinuation('- [] 甲', 6)).toEqual({
      normalize: { from: 0, to: 5, insert: '- [ ] ' },
      insertAt: 6,
      insert: '\n- [ ] ',
      caret: 14
    })
  })

  it('`- [x]文字` → 保留勾选状态并留出空格', () => {
    expect(planMarkdownContinuation('- [x]文字', 7)).toEqual({
      normalize: { from: 0, to: 5, insert: '- [x] ' },
      insertAt: 7,
      insert: '\n- [ ] ',
      caret: 15
    })
  })

  it('行尾不带空格的 `- [ ]` 也接管', () => {
    expect(planMarkdownContinuation('- [ ]', 5)).toEqual({
      normalize: { from: 0, to: 5, insert: '- [ ] ' },
      insertAt: 5,
      insert: '\n- [ ] ',
      caret: 13
    })
  })
})

describe('planMarkdownContinuation:有序任务', () => {
  it('`1. [ ] 甲` → 下一行 `2. [ ] `', () => {
    expect(planMarkdownContinuation('1. [ ] 甲', 8)).toEqual({
      insertAt: 8,
      insert: '\n2. [ ] ',
      caret: 16
    })
  })

  it('保留 `)` 风格', () => {
    expect(planMarkdownContinuation('1) []', 5)).toEqual({
      normalize: { from: 0, to: 5, insert: '1) [ ] ' },
      insertAt: 5,
      insert: '\n2) [ ] ',
      caret: 15
    })
  })
})

describe('planMarkdownContinuation:引用容器', () => {
  it('引用里的宽松任务保留前缀', () => {
    expect(planMarkdownContinuation('> - [] 甲', 8)).toEqual({
      normalize: { from: 0, to: 7, insert: '> - [ ] ' },
      insertAt: 8,
      insert: '\n> - [ ] ',
      caret: 18
    })
  })

  it('嵌套引用 + 有序任务', () => {
    expect(planMarkdownContinuation('> > 1. [ ] 甲', 12)).toMatchObject({
      insert: '\n> > 2. [ ] ',
      caret: 24
    })
  })
})

describe('planMarkdownContinuation:交给上游', () => {
  it('标准任务 / 标准引用任务 / 普通列表都返回 null', () => {
    expect(planMarkdownContinuation('- [ ] 文本', 8)).toBeNull()
    expect(planMarkdownContinuation('> - [ ] 文本', 10)).toBeNull()
    expect(planMarkdownContinuation('- 普通项', 5)).toBeNull()
    expect(planMarkdownContinuation('正文', 2)).toBeNull()
  })

  it('光标不在行尾 → null', () => {
    expect(planMarkdownContinuation('- [] 甲', 3)).toBeNull()
  })
})
