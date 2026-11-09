import { describe, expect, it } from 'vitest'
import { parseMarkdownBlocks, reorderMarkdownBlocks } from './markdown-blocks'
import {
  blockSignature,
  crossSectionMoveSlot,
  docEndSlot,
  docStartSlot,
  foldSpansOf,
  isInsideBlock,
  locateBlock,
  matchBlockAfterMove,
  resolveFoldSpans,
  resolveMoveTarget,
  siblingMoveSlot
} from './block-move'

const DOC = [
  '# 一',
  '',
  '第一段',
  '',
  '第二段',
  '',
  '## 一甲',
  '',
  '甲段落',
  '',
  '# 二',
  '',
  '二段',
  ''
].join('\n')

function fixture(text = DOC) {
  const lines = text.split('\n')
  const blocks = parseMarkdownBlocks(text)
  const at = (line: number) => blocks.find((block) => block.from === line)!
  return { text, lines, blocks, at }
}

const NESTED = ['- 甲', '  - 甲一', '  - 甲二', '- 乙', ''].join('\n')

describe('block locators', () => {
  it('locates by from + kind', () => {
    const { blocks, at } = fixture()
    const first = at(2)
    expect(locateBlock(blocks, { from: 2, kind: 'paragraph' })).toBe(first)
    expect(locateBlock(blocks, { from: 2, kind: 'listItem' })).toBeNull()
    expect(locateBlock(blocks, { from: 99, kind: 'paragraph' })).toBeNull()
  })

  it('inside means strictly within the subtree', () => {
    const { at } = fixture()
    const h1 = at(0)
    const first = at(2)
    expect(isInsideBlock(h1, first)).toBe(true)
    expect(isInsideBlock(h1, h1)).toBe(false)
    expect(isInsideBlock(first, h1)).toBe(false)
  })

  it('signature is the block content used for re-location', () => {
    const { lines, at } = fixture()
    const first = at(2)
    expect(blockSignature(first, lines)).toContain('第一段')
  })

  it('finds the same block after a move, nearest wins on duplicates', () => {
    const { text, at } = fixture()
    const first = at(2)
    const second = at(4)
    const next = reorderMarkdownBlocks(text, second.id, first.id, true)!
    const moved = matchBlockAfterMove(second, text, next)
    expect(moved?.from).toBe(2)

    const duplicate = ['X', '', '甲', '', 'Y', '', '甲', ''].join('\n')
    const blocks = parseMarkdownBlocks(duplicate)
    const firstDup = blocks.find((block) => block.from === 2)!
    const reordered = ['X', '', 'Y', '', '甲', '', '甲', ''].join('\n')
    expect(matchBlockAfterMove(firstDup, duplicate, reordered)?.from).toBe(4)
  })
})

describe('start / end / sibling targets', () => {
  it('start and end use the first / last legal anchor', () => {
    const { at, blocks, lines } = fixture()
    const source = at(2)
    expect(docStartSlot(blocks, lines, source)?.targetId).toBe(at(0).id)
    const end = docEndSlot(blocks, lines, source)!
    expect(end.before).toBe(false)
    expect(blocks.find((block) => block.id === end.targetId)?.from).toBe(12)
  })

  it('moves between same-scope siblings only', () => {
    const { at, blocks, lines } = fixture()
    expect(siblingMoveSlot(blocks, lines, at(2), 'down')).toEqual({
      targetId: at(4).id,
      before: false
    })
    expect(siblingMoveSlot(blocks, lines, at(4), 'up')).toEqual({
      targetId: at(2).id,
      before: true
    })
    expect(siblingMoveSlot(blocks, lines, at(12), 'down')).toBeNull()
  })

  it('moving down past a heading lands at the top of that section', () => {
    const { at, blocks, lines } = fixture()
    // 第二段 的下一个兄弟是 ## 一甲（整棵子树）。不能直接 before:false ——
    // 那会一次跨过整节；应落在下一节的第一个块之前。
    expect(siblingMoveSlot(blocks, lines, at(4), 'down')).toEqual({
      targetId: at(8).id,
      before: true
    })
  })

  it('a heading moves its whole section past the next sibling section', () => {
    const { at, blocks, lines } = fixture()
    expect(siblingMoveSlot(blocks, lines, at(0), 'down')).toEqual({
      targetId: at(10).id,
      before: false
    })
  })

  it('nested list items only have nested siblings', () => {
    const { blocks, lines } = fixture(NESTED)
    const item = blocks.find((block) => block.from === 1)!
    expect(siblingMoveSlot(blocks, lines, item, 'down')).toEqual({
      targetId: blocks.find((block) => block.from === 2)!.id,
      before: false
    })
    expect(crossSectionMoveSlot(blocks, lines, item, 'down')).toBeNull()
  })
})

describe('cross-section targets', () => {
  it('up lands before the nearest heading above', () => {
    const { blocks, lines, at } = fixture()
    expect(crossSectionMoveSlot(blocks, lines, at(2), 'up')).toEqual({
      targetId: at(0).id,
      before: true
    })
    expect(crossSectionMoveSlot(blocks, lines, at(8), 'up')).toEqual({
      targetId: at(6).id,
      before: true
    })
  })

  it('down lands at the top of the next section', () => {
    const { blocks, lines, at } = fixture()
    // 普通块进入下一节顶部（标题之后、第一个块之前），而不是停在标题之前 ——
    // 后者只是「本节末尾」，连按不会跨节，标题源更是完全不动。
    expect(crossSectionMoveSlot(blocks, lines, at(2), 'down')).toEqual({
      targetId: at(8).id,
      before: true
    })
    expect(crossSectionMoveSlot(blocks, lines, at(8), 'down')).toEqual({
      targetId: at(12).id,
      before: true
    })
  })

  it('a heading moves the whole section after the next section', () => {
    const { blocks, lines, at } = fixture()
    expect(crossSectionMoveSlot(blocks, lines, at(0), 'down')).toEqual({
      targetId: at(12).id,
      before: false
    })
  })

  it('enters an empty next section by landing right after its heading', () => {
    const text = ['# A', '', 'p', '', '# B', '', '# C', '', 'c', ''].join('\n')
    const lines = text.split('\n')
    const blocks = parseMarkdownBlocks(text)
    const p = blocks.find((block) => block.from === 2)!
    const c = blocks.find((block) => block.from === 6)!
    expect(crossSectionMoveSlot(blocks, lines, p, 'down')).toEqual({
      targetId: c.id,
      before: true
    })
    expect(crossSectionMoveSlot(blocks, lines, p, 'up')?.targetId).toBe(
      blocks.find((block) => block.from === 0)!.id
    )
  })

  it('falls back to the document edges when there is no heading', () => {
    const text = ['甲', '', '乙', ''].join('\n')
    const lines = text.split('\n')
    const blocks = parseMarkdownBlocks(text)
    const source = blocks[0]
    expect(crossSectionMoveSlot(blocks, lines, source, 'down')).toEqual({
      targetId: blocks[1].id,
      before: false
    })
    expect(crossSectionMoveSlot(blocks, lines, source, 'up')).toEqual({
      targetId: blocks[1].id,
      before: true
    })
  })
})

describe('resolving picker targets', () => {
  it('resolves block, start, and end targets', () => {
    const { blocks, lines, at } = fixture()
    const source = at(2)
    expect(
      resolveMoveTarget(blocks, lines, source, {
        type: 'block',
        locator: { from: 10, kind: 'heading' },
        before: true
      })
    ).toEqual({ targetId: at(10).id, before: true })
    expect(resolveMoveTarget(blocks, lines, source, { type: 'start' })?.targetId).toBe(at(0).id)
    const end = resolveMoveTarget(blocks, lines, source, { type: 'end' })!
    expect(end.before).toBe(false)
  })

  it('refuses the source and its own subtree', () => {
    const { blocks, lines, at } = fixture()
    const h1 = at(0)
    expect(
      resolveMoveTarget(blocks, lines, h1, {
        type: 'block',
        locator: { from: 0, kind: 'heading' },
        before: true
      })
    ).toBeNull()
    expect(
      resolveMoveTarget(blocks, lines, h1, {
        type: 'block',
        locator: { from: 2, kind: 'paragraph' },
        before: true
      })
    ).toBeNull()
  })
})

describe('fold spans', () => {
  it('round-trips a fold through a move by block signature', () => {
    const { text, lines, blocks, at } = fixture()
    const h1 = at(0)
    // 模仿 CodeMirror 的折叠区间：标题行末 → 本节最后一个正文行末
    const from = lines[0].length
    const to = text.indexOf('\n', text.indexOf('甲段落'))
    const spans = foldSpansOf(lines, blocks, [{ from, to }])
    expect(spans).toHaveLength(1)
    expect(spans[0].signature).toContain('# 一')

    const next = reorderMarkdownBlocks(text, h1.id, at(10).id, false)!
    const restored = resolveFoldSpans(next, spans)
    expect(restored).toHaveLength(1)
    // 整节已经移到文档后半段，折叠区间也跟着后移
    expect(restored[0].from).toBeGreaterThan(from)
    expect(next.slice(restored[0].from, restored[0].to)).toContain('甲段落')
  })

  it('ignores folds that do not belong to a block', () => {
    const { lines, blocks } = fixture()
    const spans = foldSpansOf(lines, blocks, [{ from: 0, to: 0 }])
    expect(spans).toEqual([])
    expect(resolveFoldSpans(DOC, [])).toEqual([])
  })
})
