import { describe, expect, it } from 'vitest'
import {
  blockOwnersByLine,
  inSameDropScope,
  isMarkdownBlockDraggable,
  isMarkdownBlockFoldable,
  narrowestBlockAtLine,
  parseMarkdownBlocks,
  permutationOffsets,
  reorderMarkdownBlocks,
  resolveDropSlot,
  type BlockSlot,
  type MarkdownBlock
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

  it('recognises paragraphs, list items, quotes, fences and tables as blocks', () => {
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
    // 每个列表项各成一块（不是一个列表一块），句柄与拖拽都以「项」为单位
    expect(parseMarkdownBlocks(text).map((b) => b.kind)).toEqual([
      'paragraph',
      'listItem',
      'listItem',
      'callout',
      'fence',
      'table'
    ])
  })

  it('only folds blocks that have something to hide', () => {
    expect(parseMarkdownBlocks('# title\n\n# next\n').some(isMarkdownBlockFoldable)).toBe(false)
    expect(parseMarkdownBlocks('# title\nbody\n').some(isMarkdownBlockFoldable)).toBe(true)
    expect(parseMarkdownBlocks('one\ntwo\n').some(isMarkdownBlockFoldable)).toBe(false)

    const special = parseMarkdownBlocks('```\ncode\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(special.filter(isMarkdownBlockFoldable).map((block) => block.kind)).toEqual(['fence', 'table'])
    // 所有可移动块都能拖 —— 「有手柄」与「能移动」是同一件事
    expect(special.every(isMarkdownBlockDraggable)).toBe(true)
  })

  it('recognizes tables with short (2-dash) GFM alignment delimiters', () => {
    // GFM 只要求「冒号 + 一个以上破折号」;`:--` 是合法的左对齐分隔行
    const text = '| 端口 | 进程 |\n|:--|--:|\n| 8080 | node |'
    const blocks = parseMarkdownBlocks(text)
    expect(blocks.map((b) => b.kind)).toEqual(['table'])
    expect(blocks[0].contentTo).toBe(3)
  })

  it('moves ordinary paragraphs — every movable block can be dragged', () => {
    const text = 'paragraph\n\n```\ncode\n```\n'
    const blocks = parseMarkdownBlocks(text)
    const paragraph = blocks.find((block) => block.kind === 'paragraph')!
    const fence = blocks.find((block) => block.kind === 'fence')!
    expect(isMarkdownBlockDraggable(paragraph)).toBe(true)
    expect(reorderMarkdownBlocks(text, paragraph.id, fence.id, false)).toBe('```\ncode\n```\n\nparagraph\n')
    // before=true 的落点与现状完全相同 → 交给 `next === text` 判成「没动」，也是 null
    expect(reorderMarkdownBlocks(text, paragraph.id, fence.id, true)).toBeNull()
  })
})

describe('list items', () => {
  const TREE = '# H\n\n- 甲\n- 乙\n  - 乙子项\n- 丙\n'
  const lines = TREE.split('\n')
  const items = (): MarkdownBlock[] => parseMarkdownBlocks(TREE).filter((b) => b.kind === 'listItem')

  it('makes every item its own block, carrying its children', () => {
    const all = items()
    expect(all.map((b) => lines[b.from])).toEqual(['- 甲', '- 乙', '  - 乙子项', '- 丙'])
    const jia = all[0]
    const yi = all[1]
    const child = all[2]
    // 乙 子树到「乙子项」为止；自有正文只到它自己那一行
    expect([yi.from, yi.bodyTo, yi.contentTo]).toEqual([3, 4, 5])
    expect([child.from, child.contentTo]).toEqual([4, 5])
    // 高亮/手柄的归属：子项的父是它上面那个条目
    expect(jia.parentId).toBe(yi.parentId)
    expect(child.parentId).toBe(yi.id)
  })

  it('gives an item both a continuation line and a nested fence', () => {
    const text = '- 甲\n  续行\n  ```\n  顶格的围栏正文\n  ```\n- 乙\n'
    const all = parseMarkdownBlocks(text).filter((b) => b.kind === 'listItem')
    expect(all).toHaveLength(2)
    // 续行与围栏都算甲的自有正文 —— 拖走甲时它们必须跟着走
    expect([all[0].from, all[0].bodyTo, all[0].contentTo]).toEqual([0, 5, 5])
    expect(all[1].from).toBe(5)
  })

  it('treats a loose list as one level', () => {
    const text = '- 甲\n\n- 乙\n'
    const all = parseMarkdownBlocks(text).filter((b) => b.kind === 'listItem')
    expect(all).toHaveLength(2)
    // 空行归前一个条目的 `to`，槽位之间因此不留缝
    expect(all[0].to).toBe(2)
    expect(all[1].from).toBe(2)
  })

  it('counts by characters, so a deeper indent is a child and the same indent is a sibling', () => {
    const text = '- 甲\n    - 深一层\n- 乙\n'
    const all = parseMarkdownBlocks(text).filter((b) => b.kind === 'listItem')
    expect(all).toHaveLength(3)
    expect(all[1].parentId).toBe(all[0].id)
    expect(all[2].parentId).toBe(all[0].parentId)
  })

  it('gives every line exactly one owner — the innermost block', () => {
    const owners = blockOwnersByLine(parseMarkdownBlocks(TREE))
    const ownerText = (line: number): string => lines[owners.get(line)!.from]
    // 标题保住自己那一行；子项盖住父项；空白行归包含它的那一层
    expect(ownerText(0)).toBe('# H')
    expect(ownerText(2)).toBe('- 甲')
    expect(ownerText(3)).toBe('- 乙')
    expect(ownerText(4)).toBe('  - 乙子项')
    expect(ownerText(5)).toBe('- 丙')
    expect(owners.has(6)).toBe(false)
  })
})

describe('block flavours', () => {
  it('records which kind of callout a quote block is', () => {
    const text = '> [!WARNING] 注意\n> 琥珀色。\n\n> 普通引用\n'
    const blocks = parseMarkdownBlocks(text)
    const callout = blocks.find((b) => b.kind === 'callout')!
    expect(callout.callout).toBe('warning')
    expect(blocks.find((b) => b.kind === 'quote')?.callout).toBeUndefined()
  })

  it('tells a diagram, an embedded page and a styled table apart from a plain code fence', () => {
    const text =
      '```mermaid\nflowchart LR\n```\n\n```embed https://x.dev\n\n```\n\n```table border=none color=#8b5cf6\n| a | b |\n| --- | --- |\n```\n\n```ts\nconst a = 1\n```\n'
    expect(parseMarkdownBlocks(text).map((b) => b.kind)).toEqual(['diagram', 'embed', 'table', 'fence'])
  })

  it('still treats an unknown info string as a plain code fence', () => {
    expect(parseMarkdownBlocks('```tablenope\nx\n```\n').map((b) => b.kind)).toEqual(['fence'])
  })

  it('makes a whole-line media reference its own kind, by extension', () => {
    const text = [
      '![](assets/a.png)',
      '',
      '![](assets/b.mp4)',
      '',
      '![](assets/c.mp3)',
      '',
      '![|x140](assets/d.pdf)',
      '',
      '带字的段落 ![](assets/e.png) 不算'
    ].join('\n')
    const blocks = parseMarkdownBlocks(text)
    expect(blocks.filter((b) => b.kind === 'media').map((b) => b.media)).toEqual([
      'image',
      'video',
      'audio',
      'pdf'
    ])
    expect(blocks.filter((b) => b.kind === 'paragraph')).toHaveLength(1)
  })
})

describe('details', () => {
  const TEXT = [
    '<details>',
    '<summary>标题</summary>',
    '',
    '- 甲',
    '- 乙',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '</details>',
    '',
    '后面的段落'
  ].join('\n')

  it('parses what is inside as blocks of its own, parented to the details', () => {
    const blocks = parseMarkdownBlocks(TEXT)
    const details = blocks.find((b) => b.kind === 'details')!
    const items = blocks.filter((b) => b.kind === 'listItem')
    const table = blocks.find((b) => b.kind === 'table')!
    expect(items.map((b) => b.parentId)).toEqual([details.id, details.id])
    expect(table.parentId).toBe(details.id)
    expect(blocks.some((b) => b.kind === 'paragraph' && b.from === 12)).toBe(true)
    // 自有正文只到 summary 那一行 —— 套格式不会碰里面的东西
    expect(details.bodyTo).toBe(2)
  })

  it('gives every line to the innermost block, falling back to the details', () => {
    const blocks = parseMarkdownBlocks(TEXT)
    const owners = blockOwnersByLine(blocks)
    const kindOf = (line: number): string | undefined => owners.get(line)?.kind
    expect(kindOf(0)).toBe('details')
    expect(kindOf(1)).toBe('details')
    // 空行落在 details 上（里面没有更内层的块认领它）
    expect(kindOf(2)).toBe('details')
    expect(kindOf(3)).toBe('listItem')
    expect(kindOf(6)).toBe('table')
    expect(kindOf(11)).toBeUndefined()
    expect(kindOf(12)).toBe('paragraph')
  })
})

describe('drop scope', () => {
  const linesOf = (text: string): string[] => text.split('\n')
  const at = (text: string, body: string): MarkdownBlock =>
    parseMarkdownBlocks(text).find((b) => linesOf(text)[b.from] === body)!

  it('lets a paragraph and a list item at the same indent swap', () => {
    const text = '- 甲\n\n段落\n\n- 乙\n'
    expect(inSameDropScope(linesOf(text), at(text, '- 乙'), at(text, '段落'))).toBe(true)
  })

  it('refuses to lift a nested item out to the top level', () => {
    // `  - 子` 挪到顶格段落旁边会变成那个段落的子项 —— 静默改挂，必须挡住
    const text = '段落\n\n- 父\n  - 子\n'
    const child = at(text, '  - 子')
    const para = at(text, '段落')
    expect(inSameDropScope(linesOf(text), child, para)).toBe(false)
    expect(reorderMarkdownBlocks(text, child.id, para.id, true)).toBeNull()
  })

  it('lets items of two adjacent lists at the same indent swap', () => {
    // ul 换 ol 是两个列表（预览也这么认），但同缩进同父级 —— 互换后各自的标记跟着自己走
    const text = '# H\n\n- 甲\n1. 乙\n'
    const ul = at(text, '- 甲')
    const ol = at(text, '1. 乙')
    expect(ul.parentId).toBe(ol.parentId)
    expect(inSameDropScope(linesOf(text), ul, ol)).toBe(true)
    expect(reorderMarkdownBlocks(text, ul.id, ol.id, false)).toBe('# H\n\n1. 乙\n- 甲\n')
  })

  it('keeps a tight list tight when an item moves inside it', () => {
    const text = '- 甲\n- 乙\n- 丙\n'
    expect(reorderMarkdownBlocks(text, at(text, '- 乙').id, at(text, '- 丙').id, false)).toBe('- 甲\n- 丙\n- 乙\n')
  })

  it('still separates a moved block from a neighbour of a different kind', () => {
    const text = '- 甲\n\n段落\n'
    expect(reorderMarkdownBlocks(text, at(text, '段落').id, at(text, '- 甲').id, true)).toBe('段落\n\n- 甲\n')
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

describe('narrowestBlockAtLine', () => {
  it('prefers the innermost block over the heading subtree that contains it', () => {
    const blocks = parseMarkdownBlocks(BODY)
    // 第 13 行是「子章节正文」:它自己是一个段落块,同时落在 `## 子章节` 的子树里
    expect(narrowestBlockAtLine(blocks, 13)?.kind).toBe('paragraph')
    expect(narrowestBlockAtLine(blocks, 11)?.kind).toBe('heading')
  })

  it('takes a filter so the caller can ask for the nearest foldable block', () => {
    const blocks = parseMarkdownBlocks(BODY)
    // 第 13 行的最内层是可折叠块 —— 段落自己撑不起折叠，于是落到外层标题上
    const foldable = narrowestBlockAtLine(blocks, 13, isMarkdownBlockFoldable)
    expect(foldable?.kind).toBe('heading')
    expect(foldable?.level).toBe(2)
    expect(isMarkdownBlockFoldable(narrowestBlockAtLine(blocks, 13)!)).toBe(false)
  })

  it('has no movable owner for the blank tail of a block or inside frontmatter', () => {
    const blocks = parseMarkdownBlocks(BODY)
    const movable = (block: MarkdownBlock): boolean => block.movable
    // 第 6 行是段落与首个标题之间的空行 —— 谁都不属于,不出按钮
    expect(narrowestBlockAtLine(blocks, 6)).toBeNull()
    // 但块尾的空行属于**外层**标题的子树(第 14 行在 `# 第一章` 的 contentTo 之内)
    expect(narrowestBlockAtLine(blocks, 14)).toMatchObject({ kind: 'heading', level: 1 })
    expect(narrowestBlockAtLine(blocks, 2)).toMatchObject({ kind: 'frontmatter', movable: false })
    expect(narrowestBlockAtLine(blocks, 2, movable)).toBeNull()
  })
})

/** 四个等高的兄弟块,纵向首尾相接:0[20) 20[40) 40[60) 60[80) */
const SLOTS: BlockSlot[] = [0, 1, 2, 3].map((i) => ({
  id: i,
  from: i,
  to: i + 1,
  top: i * 20,
  height: 20
}))

describe('resolveDropSlot', () => {
  it('only advances past a block once the pointer is over its midpoint', () => {
    expect(resolveDropSlot(SLOTS, 0)).toEqual({ targetId: 0, before: true })
    expect(resolveDropSlot(SLOTS, 9)).toEqual({ targetId: 0, before: true })
    expect(resolveDropSlot(SLOTS, 11)).toEqual({ targetId: 1, before: true })
    expect(resolveDropSlot(SLOTS, 35)).toEqual({ targetId: 2, before: true })
    expect(resolveDropSlot(SLOTS, 65)).toEqual({ targetId: 3, before: true })
    expect(resolveDropSlot(SLOTS, 75)).toEqual({ targetId: 3, before: false })
  })

  it('lands after the last block instead of falling off the end', () => {
    expect(resolveDropSlot(SLOTS, 200)).toEqual({ targetId: 3, before: false })
    expect(resolveDropSlot(SLOTS, -200)).toEqual({ targetId: 0, before: true })
  })

  it('is monotone: sweeping the pointer down never walks the slot back up', () => {
    let previous = 0
    for (let y = -40; y <= 120; y += 1) {
      const slot = resolveDropSlot(SLOTS, y)!
      const rank = slot.before ? slot.targetId * 2 : slot.targetId * 2 + 1
      expect(rank).toBeGreaterThanOrEqual(previous)
      previous = rank
    }
  })

  it('has no slot to offer when there is no sibling to swap with', () => {
    expect(resolveDropSlot([], 10)).toBeNull()
    expect(resolveDropSlot([{ ...SLOTS[0], allowed: false }], 10)).toBeNull()
  })

  it('crosses a slot that is out of scope instead of stopping beside it', () => {
    const slots: BlockSlot[] = SLOTS.map((slot) => ({ ...slot, allowed: slot.id !== 1 }))
    expect(resolveDropSlot(slots, 5)).toEqual({ targetId: 0, before: true })
    expect(resolveDropSlot(slots, 25)).toEqual({ targetId: 2, before: true })
    expect(resolveDropSlot(slots, 200)).toEqual({ targetId: 3, before: false })
  })
})

describe('permutationOffsets', () => {
  const topOf = (deltas: Map<number, number>): number[] =>
    [...deltas].map(([id, delta]) => SLOTS[id].top + delta).sort((a, b) => a - b)

  it('keeps every block on the same footprint — a swap is a permutation, not a hole', () => {
    const deltas = permutationOffsets(SLOTS, 1, 2, false)
    expect(deltas.get(1)).toBe(20)
    expect(deltas.get(2)).toBe(-20)
    expect(deltas.get(0)).toBe(0)
    expect(topOf(deltas)).toEqual([0, 20, 40, 60])
  })

  it('is a no-op when the pick is where the block already sits', () => {
    const deltas = permutationOffsets(SLOTS, 1, 2, true)
    expect([...deltas.values()]).toEqual([0, 0, 0, 0])
  })

  it('moves the block to the top of the scope when the pick is the first block', () => {
    const deltas = permutationOffsets(SLOTS, 1, 0, true)
    expect(deltas.get(1)).toBe(-20)
    expect(deltas.get(0)).toBe(20)
    expect(topOf(deltas)).toEqual([0, 20, 40, 60])
  })

  /** 预览的落点必须和松手时真正提交的落点一致 —— 这是这两套算法之间唯一的契约 */
  it('agrees with reorderMarkdownBlocks about the resulting block order', () => {
    const text = '# A\n\nA\n\n# B\n\nB\n\n# C\n\nC\n'
    const lines = text.split('\n')
    // 落点槽位 = 「同一批兄弟」——这正是 editor-blocks 里 snapshotSlots 的过滤方式
    const inScope = (b: MarkdownBlock, source: MarkdownBlock): boolean =>
      isMarkdownBlockDraggable(b) && inSameDropScope(lines, b, source)
    const all = parseMarkdownBlocks(text)
    const source = all.find((b) => lines[b.from] === '# B')!
    const blocks = all.filter((b) => inScope(b, source))
    // 用行号当像素坐标:每行 1px,块的占位就是它的行区间
    const slots: BlockSlot[] = blocks.map((b) => ({ id: b.id, from: b.from, to: b.to, top: b.from, height: b.to - b.from }))
    const bodyOf = (b: MarkdownBlock): string => lines[b.from]
    expect(slots.map((s) => lines[s.from])).toEqual(['# A', '# B', '# C'])

    // 指针落到 C 的中线以下 → 被拖块应该停在 C 后面
    const slot = resolveDropSlot(slots.filter((s) => s.id !== source.id), 10)!
    const deltas = permutationOffsets(slots, source.id, slot.targetId, slot.before)
    const byId = (id: number): BlockSlot => slots.find((s) => s.id === id)!
    const visual = [...deltas]
      .sort((a, b) => byId(a[0]).top + a[1] - (byId(b[0]).top + b[1]))
      .map(([id]) => bodyOf(blocks.find((b) => b.id === id)!))

    const next = reorderMarkdownBlocks(text, source.id, slot.targetId, slot.before)!
    const committed = parseMarkdownBlocks(next)
      .filter((b) => inScope(b, source))
      .sort((a, b) => a.from - b.from)
      .map((b) => next.split('\n')[b.from])

    expect(deltas.get(source.id)).toBeGreaterThan(0)
    expect(visual).toEqual(['# A', '# C', '# B'])
    expect(committed).toEqual(visual)
    expect(next).toBe('# A\n\nA\n\n# C\n\nC\n\n# B\n\nB\n')
  })
})
