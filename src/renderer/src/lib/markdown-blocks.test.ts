import { describe, expect, it } from 'vitest'
import {
  isMarkdownBlockDraggable,
  isMarkdownBlockFoldable,
  parseMarkdownBlocks,
  reorderMarkdownBlocks
} from './markdown-blocks'

const BODY = `---
title: demo
---

开头段落第一行
开头段落第二行

# 第一章

第一章正文

## 子章节

子章节正文

## 另一个子章节

| a | b |
| --- | --- |
| 1 | 2 |

# 第二章

第二章正文
`

describe('parseMarkdownBlocks', () => {
  it('builds heading subtrees and keeps frontmatter fixed', () => {
    const blocks = parseMarkdownBlocks(BODY)
    const frontmatter = blocks.find((b) => b.kind === 'frontmatter')!
    const firstHeading = blocks.find((b) => b.kind === 'heading' && b.level === 1)!
    const childHeadings = blocks.filter((b) => b.kind === 'heading' && b.level === 2)

    expect(frontmatter).toMatchObject({ from: 0, movable: false, parentId: null })
    expect(firstHeading.parentId).toBeNull()
    expect(childHeadings[0].parentId).toBe(firstHeading.id)
    expect(childHeadings[1].parentId).toBe(firstHeading.id)
    expect(firstHeading.to).toBeGreaterThan(childHeadings[1].to - 1)
  })

  it('recognises paragraphs, lists, quotes, fences and tables as blocks', () => {
    const text = [
      'paragraph line 1',
      'paragraph line 2',
      '',
      '- one',
      '- two',
      '',
      '> [!NOTE] hint',
      '> body',
      '',
      '```ts',
      'const answer = 42',
      '```',
      '',
      '| a | b |',
      '| --- | --- |',
      '| c | d |'
    ].join('\n')
    expect(parseMarkdownBlocks(text).map((b) => b.kind)).toEqual([
      'paragraph',
      'list',
      'callout',
      'fence',
      'table'
    ])
  })

  it('only folds headings, fences and tables with real body lines', () => {
    expect(parseMarkdownBlocks('# title\n\n# next\n').some(isMarkdownBlockFoldable)).toBe(false)
    expect(parseMarkdownBlocks('# title\nbody\n').some(isMarkdownBlockFoldable)).toBe(true)
    expect(parseMarkdownBlocks('one\ntwo\n').some(isMarkdownBlockFoldable)).toBe(false)

    const special = parseMarkdownBlocks('```\ncode\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(special.filter(isMarkdownBlockFoldable).map((block) => block.kind)).toEqual(['fence', 'table'])
    expect(special.filter(isMarkdownBlockDraggable).map((block) => block.kind)).toEqual(['fence', 'table'])
  })

  it('does not allow ordinary paragraphs to be moved', () => {
    const text = 'paragraph\n\n```\ncode\n```\n'
    const blocks = parseMarkdownBlocks(text)
    const paragraph = blocks.find((block) => block.kind === 'paragraph')!
    const fence = blocks.find((block) => block.kind === 'fence')!
    expect(isMarkdownBlockDraggable(paragraph)).toBe(false)
    expect(reorderMarkdownBlocks(text, paragraph.id, fence.id, true)).toBeNull()
  })
})

describe('reorderMarkdownBlocks', () => {
  it('moves direct siblings while preserving their exact source text', () => {
    const text = '# A\n\nA body\n\n# B\n\nB body\n'
    const blocks = parseMarkdownBlocks(text)
    const a = blocks.find((b) => b.kind === 'heading' && b.from === 0)!
    const b = blocks.find((block) => block.kind === 'heading' && block.from > a.from)!

    expect(reorderMarkdownBlocks(text, b.id, a.id, true)).toBe('# B\n\nB body\n\n# A\n\nA body\n')
    expect(reorderMarkdownBlocks(text, a.id, b.id, false)).toBe('# B\n\nB body\n\n# A\n\nA body\n')
  })

  it('moves child headings only among the same parent', () => {
    const text = '# A\n\n## One\n\n1\n\n## Two\n\n2\n\n# B\n'
    const blocks = parseMarkdownBlocks(text)
    const one = blocks.find((b) => b.kind === 'heading' && b.level === 2)!
    const two = blocks.find((b) => b.kind === 'heading' && b.level === 2 && b.id !== one.id)!
    const a = blocks.find((b) => b.kind === 'heading' && b.level === 1)!
    const b = blocks.find((block) => block.kind === 'heading' && block.level === 1 && block.id !== a.id)!

    expect(reorderMarkdownBlocks(text, two.id, one.id, true)).toBe('# A\n\n## Two\n\n2\n\n## One\n\n1\n\n# B\n')
    expect(reorderMarkdownBlocks(text, one.id, b.id, true)).toBeNull()
  })

  it('does not move frontmatter or a block onto itself', () => {
    const text = '---\ntitle: x\n---\n\n# A\nbody\n'
    const blocks = parseMarkdownBlocks(text)
    const frontmatter = blocks.find((b) => b.kind === 'frontmatter')!
    const heading = blocks.find((b) => b.kind === 'heading')!
    expect(reorderMarkdownBlocks(text, frontmatter.id, heading.id, true)).toBeNull()
    expect(reorderMarkdownBlocks(text, heading.id, heading.id, true)).toBeNull()
  })
})
