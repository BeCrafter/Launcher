import {
  blockContainsLine,
  canDropBeside,
  inSameDropScope,
  isMarkdownBlockDraggable,
  isMarkdownBlockFoldable,
  isTopLevelScoped,
  parseMarkdownBlocks,
  type DropSlot,
  type MarkdownBlock,
  type MarkdownBlockKind
} from './markdown-blocks'

/** 按「起始行 + 类型」定位块。行号是 0 起的源码行。 */
export interface BlockLocator {
  from: number
  kind: MarkdownBlockKind
}

/**
 * 「移动到…」的目标。`start` / `end` 是文首 / 文末；
 * `block` 用定位器而不是块 id —— 选择器里的列表来自一次解析，
 * 执行时会重新解析实时文档，id 可能已经变了。
 */
export type BlockMoveTarget =
  | { type: 'block'; locator: BlockLocator; before: boolean }
  | { type: 'start' }
  | { type: 'end' }

export type BlockMoveStatus = 'moved' | 'noop' | 'invalid'

export function locatorOf(block: MarkdownBlock): BlockLocator {
  return { from: block.from, kind: block.kind }
}

export function locateBlock(
  blocks: readonly MarkdownBlock[],
  locator: BlockLocator
): MarkdownBlock | null {
  return blocks.find((block) => block.from === locator.from && block.kind === locator.kind) ?? null
}

/** `inner` 是否在 `outer` 的子树里（不包含 outer 自己）。 */
export function isInsideBlock(outer: MarkdownBlock, inner: MarkdownBlock): boolean {
  return inner.id !== outer.id && inner.from >= outer.from && inner.to <= outer.to
}

/** 用于移动后重新定位：块的正文行必须完全一致。 */
export function blockSignature(block: MarkdownBlock, lines: readonly string[]): string {
  return lines.slice(block.from, block.contentTo).join('\n')
}

function matchBySignature(
  block: MarkdownBlock,
  signature: string,
  blocks: readonly MarkdownBlock[],
  lines: readonly string[]
): MarkdownBlock | null {
  const candidates = blocks.filter(
    (candidate) =>
      candidate.kind === block.kind &&
      candidate.level === block.level &&
      blockSignature(candidate, lines) === signature
  )
  if (candidates.length === 0) return null
  return candidates.sort(
    (a, b) => Math.abs(a.from - block.from) - Math.abs(b.from - block.from)
  )[0]
}

/**
 * 整篇替换后找同一个块。签名相同的块可能不止一个，取离原位置最近的那个 ——
 * 与 `restoreAfterBlockMove` 的恢复规则一致。
 */
export function matchBlockAfterMove(
  previous: MarkdownBlock,
  previousText: string,
  nextText: string
): MarkdownBlock | null {
  const previousLines = previousText.split('\n')
  const signature = blockSignature(previous, previousLines)
  return matchBySignature(previous, signature, parseMarkdownBlocks(nextText), nextText.split('\n'))
}

/**
 * 所有可以作为拖拽落点的块：可拖动、不是 frontmatter、不在源块子树里、
 * 且 `canDropBeside` 允许。按文档序。
 */
export function moveCandidates(
  blocks: readonly MarkdownBlock[],
  lines: readonly string[],
  source: MarkdownBlock
): MarkdownBlock[] {
  return blocks
    .filter((block) => isMarkdownBlockDraggable(block) && block.kind !== 'frontmatter')
    .filter((block) => block.id !== source.id && !isInsideBlock(source, block))
    .filter((block) => canDropBeside(blocks, lines, source, block))
    .sort((a, b) => a.from - b.from)
}

export function docStartSlot(
  blocks: readonly MarkdownBlock[],
  lines: readonly string[],
  source: MarkdownBlock
): DropSlot | null {
  const first = moveCandidates(blocks, lines, source)[0]
  return first === undefined ? null : { targetId: first.id, before: true }
}

export function docEndSlot(
  blocks: readonly MarkdownBlock[],
  lines: readonly string[],
  source: MarkdownBlock
): DropSlot | null {
  const candidates = moveCandidates(blocks, lines, source)
  const last = candidates[candidates.length - 1]
  return last === undefined ? null : { targetId: last.id, before: false }
}

/** 同父级、同缩进的前 / 后兄弟。 */
export function siblingMoveSlot(
  blocks: readonly MarkdownBlock[],
  lines: readonly string[],
  source: MarkdownBlock,
  dir: 'up' | 'down'
): DropSlot | null {
  const siblings = blocks
    .filter((block) => block.id !== source.id && isMarkdownBlockDraggable(block))
    .filter((block) => !isInsideBlock(source, block))
    .filter((block) => inSameDropScope(lines, source, block))
    .sort((a, b) => a.from - b.from)

  if (dir === 'up') {
    const previous = siblings.filter((block) => block.from < source.from).at(-1)
    return previous === undefined ? null : { targetId: previous.id, before: true }
  }
  const next = siblings.find((block) => block.from >= source.to)
  if (next === undefined) return null
  /*
   * 下一个兄弟是标题时，「放到它后面」不能直接 `before:false` —— 标题的 `to` 包含整棵
   * 子树，那样会一次跨过下一整节。按拖拽的同一口径处理：落到标题行之后 = 下一节第一个
   * 块之前（标题为空节时退化成「下一节标题之后」）。
   * 源块自己也是标题时例外：整节下移本来就该落到下一节之后，见 `crossSectionMoveSlot`。
   */
  if (next.kind === 'heading' && source.kind !== 'heading') {
    const inside = moveCandidates(blocks, lines, source).find(
      (block) => block.from > next.from && block.from < next.contentTo
    )
    if (inside !== undefined) return { targetId: inside.id, before: true }
  }
  return { targetId: next.id, before: false }
}

/**
 * 跨节移动。**上、下两侧对称**：
 *  · 向上：普通块 → 自己所在节的标题之前（离开本节，落在上一节末尾）；
 *          标题 → 上一个标题之前（整节上移）。
 *  · 向下：普通块 → 下一节第一个块之前（进入下一节顶部）；
 *          标题 → 下一整节之后（下一个标题之前 / 文末，整节下移）。
 * 找不到标题时退化为文首 / 文末。嵌套块没有跨节落点。
 */
export function crossSectionMoveSlot(
  blocks: readonly MarkdownBlock[],
  lines: readonly string[],
  source: MarkdownBlock,
  dir: 'up' | 'down'
): DropSlot | null {
  if (!isTopLevelScoped(blocks, source)) return null
  const headings = blocks
    .filter((block) => block.kind === 'heading' && block.id !== source.id)
    .filter((block) => !isInsideBlock(source, block))
    .filter((block) => canDropBeside(blocks, lines, source, block))
    .sort((a, b) => a.from - b.from)

  if (dir === 'up') {
    const previous = headings.filter((block) => block.from < source.from).at(-1)
    return previous === undefined
      ? docStartSlot(blocks, lines, source)
      : { targetId: previous.id, before: true }
  }
  const next = headings.find((block) => block.from >= source.to)
  if (next === undefined) return docEndSlot(blocks, lines, source)

  // 整节下移：落到下一节**之后**，即再下一个标题之前（没有就是文末）
  if (source.kind === 'heading') {
    const after = headings.find((block) => block.from >= next.contentTo)
    return after === undefined
      ? docEndSlot(blocks, lines, source)
      : { targetId: after.id, before: true }
  }

  // 普通块：进入下一节顶部 = 下一节第一个可落脚块之前；
  // 空节没有「第一个块」，落到标题行之后（下一个标题之前 / 文末）
  const inside = moveCandidates(blocks, lines, source).find(
    (block) => block.from > next.from && block.from < next.contentTo
  )
  if (inside !== undefined) return { targetId: inside.id, before: true }
  const after = headings.find((block) => block.from >= next.contentTo)
  return after === undefined
    ? docEndSlot(blocks, lines, source)
    : { targetId: after.id, before: true }
}

/** 选择器目标 → 实际操作槽位。定位失败、互相包含、不允许并排都返回 null。 */
export function resolveMoveTarget(
  blocks: readonly MarkdownBlock[],
  lines: readonly string[],
  source: MarkdownBlock,
  target: BlockMoveTarget
): DropSlot | null {
  if (target.type === 'start') return docStartSlot(blocks, lines, source)
  if (target.type === 'end') return docEndSlot(blocks, lines, source)

  const block = locateBlock(blocks, target.locator)
  if (block === null || block.id === source.id) return null
  if (!isMarkdownBlockDraggable(block) || isInsideBlock(source, block)) return null
  if (!canDropBeside(blocks, lines, source, block)) return null
  return { targetId: block.id, before: target.before }
}

// ── 折叠恢复 ──
//
// 落点提交是整篇替换，CodeMirror 会把折叠区间映射没。这里在提交前按「块签名 + 区间偏移」
// 记住每个折叠，提交后在新文档里找同一个块，把折叠原样贴回去。

export interface FoldSpan {
  kind: MarkdownBlockKind
  level: number
  signature: string
  /** 相对块起始位置的字符偏移 */
  fromOffset: number
  toOffset: number
  /** 原块起始行，用于重名块就近匹配 */
  fromHint: number
}

function lineOffsets(lines: readonly string[]): number[] {
  const offsets = new Array<number>(lines.length + 1)
  let pos = 0
  for (let i = 0; i < lines.length; i += 1) {
    offsets[i] = pos
    pos += lines[i].length + 1
  }
  offsets[lines.length] = pos
  return offsets
}

function lineAtOffset(offsets: readonly number[], pos: number): number {
  const last = Math.max(0, offsets.length - 2)
  let lo = 0
  let hi = last
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if ((offsets[mid] ?? 0) <= pos) lo = mid
    else hi = mid - 1
  }
  return Math.min(lo, last)
}

export function foldSpansOf(
  lines: readonly string[],
  blocks: readonly MarkdownBlock[],
  ranges: readonly { from: number; to: number }[]
): FoldSpan[] {
  if (ranges.length === 0) return []
  const offsets = lineOffsets(lines)
  const spans: FoldSpan[] = []
  for (const range of ranges) {
    if (range.to <= range.from) continue
    const line = lineAtOffset(offsets, range.from)
    let block: MarkdownBlock | null = null
    for (const candidate of blocks) {
      if (!isMarkdownBlockFoldable(candidate) || !blockContainsLine(candidate, line)) continue
      if (block === null || candidate.contentTo - candidate.from < block.contentTo - block.from) {
        block = candidate
      }
    }
    if (block === null) continue
    const start = offsets[block.from] ?? 0
    spans.push({
      kind: block.kind,
      level: block.level,
      signature: blockSignature(block, lines),
      fromOffset: range.from - start,
      toOffset: range.to - start,
      fromHint: block.from
    })
  }
  return spans
}

export function resolveFoldSpans(
  nextText: string,
  spans: readonly FoldSpan[]
): { from: number; to: number }[] {
  if (spans.length === 0) return []
  const lines = nextText.split('\n')
  const offsets = lineOffsets(lines)
  const blocks = parseMarkdownBlocks(nextText)
  const out: { from: number; to: number }[] = []
  for (const span of spans) {
    const block = matchBySignature(
      {
        // 只用到 kind / level / from 三个字段；签名匹配由 matchBySignature 负责
        id: -1,
        kind: span.kind,
        from: span.fromHint,
        to: span.fromHint,
        contentTo: span.fromHint,
        bodyTo: span.fromHint,
        level: span.level,
        parentId: null,
        movable: true
      },
      span.signature,
      blocks,
      lines
    )
    if (block === null) continue
    const start = offsets[block.from] ?? 0
    const from = start + span.fromOffset
    const to = Math.min(start + span.toOffset, nextText.length)
    if (to > from) out.push({ from, to })
  }
  return out
}
