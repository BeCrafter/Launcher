import { blockTypeLabelKey } from './block-labels'
import {
  canDropBeside,
  isMarkdownBlockDraggable,
  isTopLevelScoped,
  type BlockSlot,
  type DropSlot,
  type MarkdownBlock
} from './markdown-blocks'
import {
  docEndSlot,
  docStartSlot,
  isInsideBlock,
  locatorOf,
  moveCandidates,
  type BlockMoveTarget
} from './block-move'

export interface OutlineEntry {
  /** `h:<id>` / `start` / `end` */
  key: string
  kind: 'heading' | 'start' | 'end'
  title: string
  level: number
  /** 0 起的源码行，用于跳转 */
  line: number
  target: DropSlot
}

/** `## 乙 ##` → `乙`。 */
export function headingTitleOf(lineText: string): string {
  return lineText
    .replace(/^ {0,3}#{1,10}(?:[ \t]+|$)/, '')
    .replace(/[ \t]+#+[ \t]*$/, '')
    .trim()
}

function firstLineOf(block: MarkdownBlock, lines: readonly string[]): string {
  const text = (lines[block.from] ?? '')
    .replace(/^ {0,3}(?:#{1,10}[ \t]+|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+|>[ \t]?)/, '')
    .trim()
  if (text.length === 0) return ''
  return text.length > 48 ? `${text.slice(0, 47)}…` : text
}

/**
 * 拖拽时右侧大纲的条目。
 * 边界项直接复用拖拽快照的 `anchors` 首 / 尾，保证与实际可落点完全一致；
 * 标题项也只保留出现在 `anchors` 里的标题（`canDropBeside` 已经过滤过）。
 */
export function buildOutlineEntries(
  blocks: readonly MarkdownBlock[],
  lines: readonly string[],
  anchors: readonly BlockSlot[],
  source: MarkdownBlock
): OutlineEntry[] {
  if (anchors.length === 0) return []
  const actionable = new Set(anchors.map((slot) => slot.id))
  const first = anchors[0]
  const last = anchors[anchors.length - 1]
  const entries: OutlineEntry[] = [
    {
      key: 'start',
      kind: 'start',
      title: '',
      level: 0,
      line: first.from,
      target: { targetId: first.id, before: true }
    }
  ]
  for (const block of blocks) {
    if (block.kind !== 'heading' || block.id === source.id || !actionable.has(block.id)) continue
    entries.push({
      key: `h:${block.id}`,
      kind: 'heading',
      title: headingTitleOf(lines[block.from] ?? ''),
      level: block.level,
      line: block.from,
      target: { targetId: block.id, before: true }
    })
  }
  entries.push({
    key: 'end',
    kind: 'end',
    title: '',
    level: 0,
    line: last.from,
    target: { targetId: last.id, before: false }
  })
  return entries
}

export interface MovePickerTarget {
  key: string
  group: 'start' | 'end' | 'heading' | 'block'
  title: string
  level: number
  typeLabelKey: string | null
  line: number
  target: BlockMoveTarget
}

function blockAt(blocks: readonly MarkdownBlock[], id: number): MarkdownBlock | null {
  return blocks.find((block) => block.id === id) ?? null
}

/**
 * 「移动到…」的候选。标题永远优先；没有任何标题时才列出顶层非标题块，
 * 避免选择器在长文档里铺出几百行普通段落。
 */
export function buildMovePickerTargets(
  blocks: readonly MarkdownBlock[],
  lines: readonly string[],
  source: MarkdownBlock,
  includeRootBlocks = true
): MovePickerTarget[] {
  // 嵌套块只能在同级里挪，没有「文首 / 文末」这种语义 —— 选择器显示空状态与提示
  if (!isTopLevelScoped(blocks, source)) return []
  const targets: MovePickerTarget[] = []
  const start = docStartSlot(blocks, lines, source)
  const startBlock = start === null ? null : blockAt(blocks, start.targetId)
  if (start !== null) {
    targets.push({
      key: 'start',
      group: 'start',
      title: '',
      level: 0,
      typeLabelKey: null,
      line: startBlock?.from ?? 0,
      target: { type: 'start' }
    })
  }

  const headings = blocks
    .filter((block) => block.kind === 'heading' && block.id !== source.id)
    .filter((block) => !isInsideBlock(source, block) && isMarkdownBlockDraggable(block))
    .filter((block) => canDropBeside(blocks, lines, source, block))
    .sort((a, b) => a.from - b.from)
  for (const block of headings) {
    targets.push({
      key: `h:${block.id}`,
      group: 'heading',
      title: headingTitleOf(lines[block.from] ?? ''),
      level: block.level,
      typeLabelKey: null,
      line: block.from,
      target: { type: 'block', locator: locatorOf(block), before: true }
    })
  }

  if (includeRootBlocks && headings.length === 0) {
    for (const block of moveCandidates(blocks, lines, source)) {
      if (block.kind === 'heading' || !isTopLevelScoped(blocks, block)) continue
      targets.push({
        key: `b:${block.id}`,
        group: 'block',
        title: firstLineOf(block, lines),
        level: 0,
        typeLabelKey: blockTypeLabelKey(block),
        line: block.from,
        target: { type: 'block', locator: locatorOf(block), before: true }
      })
    }
  }

  const end = docEndSlot(blocks, lines, source)
  const endBlock = end === null ? null : blockAt(blocks, end.targetId)
  if (end !== null) {
    targets.push({
      key: 'end',
      group: 'end',
      title: '',
      level: 0,
      typeLabelKey: null,
      line: endBlock?.from ?? Math.max(0, lines.length - 1),
      target: { type: 'end' }
    })
  }
  return targets
}

export function filterMovePickerTargets(
  targets: readonly MovePickerTarget[],
  query: string,
  t: (key: string) => string
): MovePickerTarget[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...targets]
  return targets.filter((target) => {
    const title =
      target.group === 'start'
        ? t('notes.blockMove.start')
        : target.group === 'end'
          ? t('notes.blockMove.end')
          : target.title
    const type = target.typeLabelKey === null ? '' : t(target.typeLabelKey)
    return `${title} ${type}`.toLowerCase().includes(q)
  })
}

export interface SlotDestination {
  kind: 'heading' | 'block'
  level: number
  title: string
  typeLabelKey: string | null
  before: boolean
  block: MarkdownBlock
}

/** 落点 → 用于提示文案的目标信息。 */
export function destinationForSlot(
  blocks: readonly MarkdownBlock[],
  lines: readonly string[],
  slot: DropSlot
): SlotDestination | null {
  const block = blockAt(blocks, slot.targetId)
  if (block === null) return null
  if (block.kind === 'heading') {
    return {
      kind: 'heading',
      level: block.level,
      title: headingTitleOf(lines[block.from] ?? ''),
      typeLabelKey: null,
      before: slot.before,
      block
    }
  }
  return {
    kind: 'block',
    level: 0,
    title: firstLineOf(block, lines),
    typeLabelKey: blockTypeLabelKey(block),
    before: slot.before,
    block
  }
}
