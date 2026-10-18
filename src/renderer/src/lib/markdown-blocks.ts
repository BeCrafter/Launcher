import { noteAssetKindOfUrl, type NoteAssetKind } from '@shared/notes'
import type { CalloutKind } from './markdown'

export type MarkdownBlockKind =
  | 'frontmatter'
  | 'heading'
  | 'paragraph'
  | 'listItem'
  | 'quote'
  | 'callout'
  | 'table'
  | 'fence'
  | 'details'
  | 'thematicBreak'
  /** ```mermaid 围栏：是一张图，不是一段代码 */
  | 'diagram'
  /** ```embed 围栏：是一个网页嵌入 */
  | 'embed'
  /** 整段就是一张图 / 一段视频 / 音频 / PDF */
  | 'media'

/**
 * A source block uses half-open line ranges. `to` includes the blank lines
 * following the block so moving a block keeps the author's spacing intact.
 * Heading blocks and list items contain their complete subtree.
 */
export interface MarkdownBlock {
  id: number
  kind: MarkdownBlockKind
  from: number
  to: number
  /** Last non-blank line plus one. Used to avoid folding trailing whitespace only. */
  contentTo: number
  /**
   * 该块**自有正文**的结束行(不含子块)。标题 = 自己那一行;段落 = contentTo;
   * 列表项 = 它自己的续行到哪里为止(子项不算)。
   * 块菜单的「先选中整块再套格式」用它 —— 否则会把子块一起改掉。
   */
  bodyTo: number
  /** Heading depth; zero for non-heading blocks. */
  level: number
  /** The nearest containing block — a heading or a list item — or null at the root. */
  parentId: number | null
  movable: boolean
  /** 提示块的具体类型（`[!NOTE]` 等）。手柄据此出对应的图标，而不是笼统的「引用」。 */
  callout?: CalloutKind
  /** `kind === 'media'` 时的媒体类型（图 / 视频 / 音频 / PDF）—— 图标据此区分。 */
  media?: NoteAssetKind
}

interface ConsumedBlock {
  kind: Exclude<MarkdownBlockKind, 'frontmatter' | 'heading' | 'listItem'>
  contentTo: number
  to: number
  /** 自有正文的结束行；缺省等于 contentTo */
  bodyTo?: number
  /** details 的内部区间（开标签与 summary 之后、闭合行之前）—— 交给递归解析 */
  inner?: { from: number; to: number }
  callout?: CalloutKind
  media?: NoteAssetKind
}

const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+|$)/
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(?:[^`~]*)$/
const LIST_RE = /^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/
const QUOTE_RE = /^ {0,3}>/
const THEMATIC_BREAK_RE = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/
const CALLOUT_RE = /^ {0,3}>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i
const DETAILS_OPEN_RE = /^ {0,3}<details(?:\s|>)/i
const DETAILS_CLOSE_RE = /^ {0,3}<\/details\s*>/i
const DETAILS_SUMMARY_RE = /^ {0,3}<summary(?:\s|>)/i
/** 整行只有一个媒体引用（可带 `|宽x高`）—— 那样它是一张图，不是一段文字 */
const MEDIA_LINE_RE = /^!\[[^\]]*\]\(([^)\n]+)\)\s*$/

function blank(line: string): boolean {
  return /^\s*$/.test(line)
}

function headingOf(line: string): { level: number } | null {
  const match = HEADING_RE.exec(line)
  return match === null ? null : { level: match[1].length }
}

function fenceOf(line: string): { char: '`' | '~'; length: number } | null {
  const match = FENCE_RE.exec(line)
  if (match === null) return null
  return { char: match[1][0] as '`' | '~', length: match[1].length }
}

function tableDelimiter(line: string): boolean {
  // GFM 只要求「冒号 + 一个以上破折号」;写死 {3,} 会漏掉 `:--` 这类 2 破折号对齐行
  // (预览渲染器认、块解析器不认 → 数据行 hover 出的是 Paragraph 手柄而非表格)
  return /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/.test(line)
}

function tableRow(line: string): boolean {
  return line.includes('|')
}

function consumeFence(
  lines: string[],
  start: number,
  fence: { char: '`' | '~'; length: number },
  limit: number
): ConsumedBlock {
  let i = start + 1
  const close = new RegExp(`^ {0,3}${fence.char}{${fence.length},}\\s*$`)
  while (i < limit && !close.test(lines[i])) i += 1
  if (i < limit) i += 1
  // 信息串的第一个词决定它到底是什么 —— 手柄/菜单据此出不同的图标与类型名。
  // 这三个是应用自带的围栏语言（预览各有各的渲染），其余一律是代码块：
  //   mermaid → 图表、embed → 网页嵌入、table → 带样式的表格（预览会套一层 .md-table-scope）
  const info = lines[start].slice(lines[start].indexOf(fence.char) + fence.length).trim().toLowerCase()
  const lang = info.split(/\s+/)[0] ?? ''
  const kind = lang === 'mermaid' ? 'diagram' : lang === 'embed' ? 'embed' : lang === 'table' ? 'table' : 'fence'
  return { kind, contentTo: i, to: withTrailingBlanks(lines, i, limit) }
}

/** 整行就是一个媒体引用时，给出它的媒体类型；否则 null。 */
function mediaKindOfLine(line: string): NoteAssetKind | null {
  const match = MEDIA_LINE_RE.exec(line.trim())
  return match === null ? null : noteAssetKindOfUrl(match[1])
}

function consumeDetails(lines: string[], start: number, limit: number): ConsumedBlock {
  let close = start + 1
  while (close < limit && !DETAILS_CLOSE_RE.test(lines[close])) close += 1
  const end = close < limit ? close + 1 : close
  // 自有正文 = 开标签那一行（外加 summary 那一行）；里面装的块由递归解析出来
  let bodyTo = start + 1
  if (bodyTo < close && DETAILS_SUMMARY_RE.test(lines[bodyTo])) bodyTo += 1
  return {
    kind: 'details',
    contentTo: end,
    to: withTrailingBlanks(lines, end, limit),
    bodyTo,
    inner: bodyTo < close ? { from: bodyTo, to: close } : undefined
  }
}

function consumeQuote(lines: string[], start: number, limit: number): ConsumedBlock {
  const callout = CALLOUT_RE.exec(lines[start])
  let i = start
  while (i < limit && QUOTE_RE.test(lines[i])) i += 1
  const base = { contentTo: i, to: withTrailingBlanks(lines, i, limit) }
  // 提示块记下自己的类型（note / tip / …）—— 手柄要出对应那张图标，而不是笼统的引用
  return callout === null
    ? { kind: 'quote', ...base }
    : { kind: 'callout', callout: callout[1].toLowerCase() as CalloutKind, ...base }
}

// ── 列表项 ──
//
// 一个列表**不再**是一个块：每一项各成一块、带自己的子项（与飞书一致，可单独拖走）。
// 与预览解析器（markdown.tsx 的 parseListExt）对齐的几条：同层 = 缩进**完全相等**、
// ul/ol 混排算两层、空行在预览里会把列表断开。唯一放宽的是**条目之间容忍空行**
// （空行归前一个条目的 `to`，于是拖拽槽位仍然严丝合缝）。

/** 列表标记：无序 `-+*`、有序 `1.` / `1)`、任务项 `- [ ]`。缩进不设上限。 */
const ITEM_RE = /^([ \t]*)(?:([-+*])|(\d+[.)]))([ \t]+)/

interface ItemMark {
  /** 标记前导空白宽度（字符数，与预览 parseListExt 同口径） */
  indent: number
  /** 内容列 = 前导空白 + 标记宽度 + 标记后空白 */
  content: number
  ordered: boolean
}

function itemMarkOf(line: string): ItemMark | null {
  const match = ITEM_RE.exec(line)
  if (match === null) return null
  const width = (match[2] ?? match[3]).length
  return {
    indent: match[1].length,
    content: match[1].length + width + match[4].length,
    ordered: match[3] !== undefined
  }
}

/**
 * 行首空白宽度（**字符数**）。缩进一律按字符算：预览这么算，`indentLine` 也是插 2 空格。
 * 拖拽落点判定用它区分「同一层的兄弟」。
 */
export function indentOf(line: string): number {
  const match = /^[ \t]*/.exec(line)
  return match === null ? 0 : match[0].length
}

interface ItemNode {
  from: number
  /** 自有正文的结束行（不含子项） */
  ownEnd: number
  /** 整棵子树的结束行（含子项），不含尾随空行 */
  contentTo: number
  indent: number
  ordered: boolean
  children: ItemNode[]
}

/** 该行是否仍在这个条目里：更深的条目算（子项），缩进达内容列的任意内容算（续行 / 围栏）。 */
function inItem(line: string, mark: ItemMark): boolean {
  const nested = itemMarkOf(line)
  if (nested !== null) return nested.indent > mark.indent
  return indentOf(line) >= mark.content
}

/**
 * 条目「吃到」的最后一行的下一行（不含尾随空行）。
 * 判据顺序即优先级：围栏整段跳过 → 缩进到内容列的行算续行 → 空行往后看一个非空行
 * （仍属于条目就继续，否则停在空行前）→ 同层 / 更浅的条目标记结束 → 顶格的其他块结束。
 */
function itemRegionEnd(lines: string[], from: number, limit: number, mark: ItemMark): number {
  let i = from + 1
  let end = from + 1
  while (i < limit) {
    const line = lines[i]
    if (blank(line)) {
      let j = i
      while (j < limit && blank(lines[j])) j += 1
      if (j < limit && inItem(lines[j], mark)) {
        i = j
        continue
      }
      break
    }
    if (!inItem(line, mark)) break
    const fence = fenceOf(line)
    i = fence !== null ? Math.max(consumeFence(lines, i, fence, limit).contentTo, i + 1) : i + 1
    end = i
  }
  return end
}

/** 一层条目：缩进完全相等 + 同一种标记。条目之间允许空行（松列表）。 */
function parseItemRun(
  lines: string[],
  start: number,
  limit: number,
  indent: number,
  ordered: boolean
): { items: ItemNode[]; end: number } {
  const items: ItemNode[] = []
  let i = start
  while (i < limit) {
    const mark = itemMarkOf(lines[i])
    if (mark === null || mark.indent !== indent || mark.ordered !== ordered) break

    const regionEnd = itemRegionEnd(lines, i, limit, mark)
    const children: ItemNode[] = []
    // 自有正文只取「标记行起连续的一段」——撞到第一个子项就封口，免得把子项算进正文
    let ownEnd = i + 1
    let k = i + 1
    while (k < regionEnd) {
      const nested = itemMarkOf(lines[k])
      if (nested !== null && nested.indent > mark.indent) {
        const sub = parseItemRun(lines, k, regionEnd, nested.indent, nested.ordered)
        children.push(...sub.items)
        k = sub.end
        continue
      }
      if (!blank(lines[k]) && children.length === 0) ownEnd = k + 1
      k += 1
    }
    items.push({
      from: i,
      ownEnd,
      contentTo: children.length > 0 ? children[children.length - 1].contentTo : ownEnd,
      indent: mark.indent,
      ordered: mark.ordered,
      children
    })
    i = regionEnd

    // 松列表：条目之间的空行归前一个条目的 `to`，槽位因此不留缝
    let j = i
    while (j < limit && blank(lines[j])) j += 1
    const next = j < limit ? itemMarkOf(lines[j]) : null
    if (next !== null && next.indent === indent && next.ordered === ordered) {
      i = j
      continue
    }
    break
  }
  return { items, end: i }
}

/** 层级序输出（父在子前），`parentId` 因此总能指向已经存在的块。 */
function emitItemRun(
  blocks: MarkdownBlock[],
  lines: string[],
  limit: number,
  items: readonly ItemNode[],
  parentId: number | null
): void {
  for (const item of items) {
    const id = blocks.length
    blocks.push({
      id,
      kind: 'listItem',
      from: item.from,
      to: withTrailingBlanks(lines, item.contentTo, limit),
      contentTo: item.contentTo,
      bodyTo: item.ownEnd,
      level: 0,
      parentId,
      movable: true
    })
    emitItemRun(blocks, lines, limit, item.children, id)
  }
}

function consumeTable(lines: string[], start: number, limit: number): ConsumedBlock {
  let i = start
  while (i < limit && tableRow(lines[i]) && !headingOf(lines[i])) i += 1
  return { kind: 'table', contentTo: i, to: withTrailingBlanks(lines, i, limit) }
}

function consumeParagraph(lines: string[], start: number, limit: number): ConsumedBlock {
  let i = start + 1
  while (i < limit && !blank(lines[i]) && headingOf(lines[i]) === null) i += 1
  return { kind: 'paragraph', contentTo: i, to: withTrailingBlanks(lines, i, limit) }
}

function withTrailingBlanks(lines: string[], end: number, limit: number): number {
  let i = end
  while (i < limit && blank(lines[i])) i += 1
  return i
}

function consumeBlock(lines: string[], start: number, limit: number): ConsumedBlock {
  const fence = fenceOf(lines[start])
  if (fence !== null) return consumeFence(lines, start, fence, limit)
  if (DETAILS_OPEN_RE.test(lines[start])) return consumeDetails(lines, start, limit)
  if (QUOTE_RE.test(lines[start])) return consumeQuote(lines, start, limit)
  if (start + 1 < limit && tableRow(lines[start]) && tableDelimiter(lines[start + 1])) {
    return consumeTable(lines, start, limit)
  }
  if (THEMATIC_BREAK_RE.test(lines[start])) {
    return { kind: 'thematicBreak', contentTo: start + 1, to: withTrailingBlanks(lines, start + 1, limit) }
  }
  // 整段只有一个媒体引用 → 它是「一张图 / 一段视频 / 音频 / PDF」，不是一段文字
  const media = mediaKindOfLine(lines[start])
  const paragraph = consumeParagraph(lines, start, limit)
  if (media !== null && paragraph.contentTo === start + 1) return { ...paragraph, kind: 'media', media }
  return paragraph
}

/** 标题的自有正文就是它自己那一行 —— 子树交给子块。 */
function closeHeading(lines: string[], block: MarkdownBlock, end: number): void {
  block.to = end
  let contentTo = end
  while (contentTo > block.from + 1 && blank(lines[contentTo - 1])) contentTo -= 1
  block.contentTo = contentTo
}

function frontmatterEnd(lines: string[], limit: number): number | null {
  if (lines[0]?.trim() !== '---') return null
  for (let i = 1; i < limit; i += 1) {
    if (/^(?:---|\.\.\.)\s*$/.test(lines[i])) return withTrailingBlanks(lines, i + 1, limit)
  }
  return null
}

/** Parse the movable/foldable Markdown source structure without changing text. */
export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.split('\n')
  // split() adds a final empty sentinel for a document ending in `\\n`.
  // It must stay at the end of the document instead of travelling with a block.
  const limit = lines.length > 1 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
  const blocks: MarkdownBlock[] = []
  let start = 0

  const fmEnd = frontmatterEnd(lines, limit)
  if (fmEnd !== null) {
    blocks.push({
      id: blocks.length,
      kind: 'frontmatter',
      from: 0,
      to: fmEnd,
      contentTo: fmEnd,
      bodyTo: fmEnd,
      level: 0,
      parentId: null,
      movable: false
    })
    start = fmEnd
  }

  collectBlocks(lines, start, limit, null, blocks)
  return blocks
}

/**
 * 解析 `[from, to)` 这一段，把块按文档序推进 `blocks`。
 *
 * 递归只为一件事：**`<details>` 里面装的东西也是块**。以前整段 `<details>…</details>`
 * 算一个块，于是里面嵌的列表 / 表格 / 引用全都顶着「折叠块」的标识；
 * 现在里面的内容单独解析一遍，父级是那个 details —— 最内层的块因此能出自己的标识，
 * 而真正没有更内层块的行（空行、details 自己的行）仍然落到 details 上。
 */
function collectBlocks(
  lines: string[],
  from: number,
  to: number,
  outerParent: number | null,
  blocks: MarkdownBlock[]
): void {
  const headings: MarkdownBlock[] = []
  /** 段内的标题自成层级；段内没有标题时，块的父级就是 outerParent */
  const parentOf = (): number | null => (headings.length > 0 ? headings[headings.length - 1].id : outerParent)
  let i = from

  while (i < to) {
    if (blank(lines[i])) {
      i += 1
      continue
    }

    const heading = headingOf(lines[i])
    if (heading !== null) {
      while (headings.length > 0 && headings[headings.length - 1].level >= heading.level) {
        closeHeading(lines, headings.pop()!, i)
      }
      const block: MarkdownBlock = {
        id: blocks.length,
        kind: 'heading',
        from: i,
        to,
        contentTo: i + 1,
        bodyTo: i + 1,
        level: heading.level,
        parentId: parentOf(),
        movable: true
      }
      blocks.push(block)
      headings.push(block)
      i += 1
      continue
    }

    // 列表：逐项成块（每项带自己的子项），不再整段算一块
    if (LIST_RE.test(lines[i])) {
      const mark = itemMarkOf(lines[i])
      const run = mark === null ? null : parseItemRun(lines, i, to, mark.indent, mark.ordered)
      // run.end 必须前进，否则这里的 while 会原地打转（渲染进程直接卡死）
      if (run !== null && run.end > i) {
        emitItemRun(blocks, lines, to, run.items, parentOf())
        i = run.end
        continue
      }
    }

    const consumed = consumeBlock(lines, i, to)
    const id = blocks.length
    blocks.push({
      id,
      kind: consumed.kind,
      from: i,
      to: consumed.to,
      contentTo: consumed.contentTo,
      bodyTo: consumed.bodyTo ?? consumed.contentTo,
      level: 0,
      parentId: parentOf(),
      movable: true,
      callout: consumed.callout,
      media: consumed.media
    })
    i = consumed.to
    // `<details>` 里面的内容单独解析一遍 —— 父级就是它
    if (consumed.inner !== undefined) collectBlocks(lines, consumed.inner.from, consumed.inner.to, id, blocks)
  }

  while (headings.length > 0) closeHeading(lines, headings.pop()!, to)
}

export function isMarkdownBlockDraggable(block: MarkdownBlock): boolean {
  // 所有可移动块都能拖（段落 / 列表项 / 引用 / 提示块…）——「有手柄」与「能移动」是同一件事。
  // 能不能落到某处由 `inSameDropScope` 决定，不是在这里按类型卡。
  return block.movable
}

/** 可折叠 = 藏起来还有意义（有子树的块 / 有正文的块）。段落的续行不算，折它没有意义。 */
export function isMarkdownBlockFoldable(block: MarkdownBlock): boolean {
  if (!block.movable || block.contentTo <= block.from + 1) return false
  return (
    block.kind === 'heading' ||
    block.kind === 'listItem' ||
    block.kind === 'fence' ||
    block.kind === 'diagram' ||
    block.kind === 'embed' ||
    block.kind === 'table'
  )
}

/** 该块首行的缩进（字符数）。 */
export function blockIndentOf(lines: readonly string[], block: MarkdownBlock): number {
  return indentOf(lines[block.from] ?? '')
}

/**
 * 行 → 该行的**最内层**归属块。判据与 `narrowestBlockAtLine` 完全一致（行区间取
 * `[from, contentTo)`，块的尾部空行不属于任何块）。
 *
 * 实现只要一条：**外层先写、内层后写覆盖**。跨度大的先写，于是嵌套时内层总在后、
 * 总能盖住外层；标题自己那一行不会被任何子块覆盖，所以仍然归标题。
 * 每个块只在自己的「自有行 + 没有被更内层块认领的行」上出按钮。
 */
export function blockOwnersByLine(blocks: readonly MarkdownBlock[]): Map<number, MarkdownBlock> {
  const owners = new Map<number, MarkdownBlock>()
  const outerFirst = blocks
    .filter((block) => block.movable)
    .slice()
    .sort((a, b) => b.contentTo - b.from - (a.contentTo - a.from) || a.from - b.from)
  for (const block of outerFirst) {
    for (let line = block.from; line < block.contentTo; line += 1) owners.set(line, block)
  }
  return owners
}

/**
 * 两个块是否属于「同一批可互换的兄弟」：同一个父级，且**首行缩进相同**。
 *
 * 为什么不能只比 `parentId`：`- 甲\n1. 乙`（ul 换 ol）与 `- 甲\n段落\n- 乙`（列表被打断）
 * 都会让**不同列表**共享同一个父，于是被误当成兄弟。而缩进不同的两块互换，会把子项
 * **静默改挂**到别的父级下（`  - 子` 挪到顶格段落旁边就变成那个段落的子项）——
 * 渲染器与编辑器对「谁是父」的判断随之分裂。
 */
export function inSameDropScope(lines: readonly string[], a: MarkdownBlock, b: MarkdownBlock): boolean {
  return a.parentId === b.parentId && blockIndentOf(lines, a) === blockIndentOf(lines, b)
}

/**
 * 行是否在这个块的**正文范围**内。区间是 `[from, contentTo)` ——
 * 与 `blockOwnersByLine` 的归属区间同口径（块尾的分隔空行不算）。
 *
 * ⚠ 「行归属」和「块范围」是两件事：
 *  · 归属（`blockOwnersByLine`）回答「这一行的手柄属于哪个块」——取**最内层**；
 *  · 范围（这个函数）回答「这个块盖住了哪些行」——用于高亮 / 拖拽 / 折叠。
 * 两者混用的症状：悬停标题时空白行亮了、下面的正文却没亮。
 */
export function blockContainsLine(block: MarkdownBlock, line: number): boolean {
  return line >= block.from && line < block.contentTo
}

/**
 * The most specific block owning a source line. 行区间取 `[from, contentTo)` ——
 * 与 gutter 出按钮、hover 激活用的是同一个判据(块的尾部空行不属于任何块)。
 * 标题块的 `contentTo` 覆盖整棵子树,所以子块行要取**最窄**的那个匹配。
 */
export function narrowestBlockAtLine(
  blocks: readonly MarkdownBlock[],
  line: number,
  accepts: (block: MarkdownBlock) => boolean = () => true
): MarkdownBlock | null {
  let result: MarkdownBlock | null = null
  for (const block of blocks) {
    if (!accepts(block) || !blockContainsLine(block, line)) continue
    if (result === null || block.contentTo - block.from < result.contentTo - result.from) result = block
  }
  return result
}

/**
 * Move one block before/after another direct sibling. Returns null for invalid
 * moves (frontmatter, a different drop scope, or a block dropped onto itself).
 */
export function reorderMarkdownBlocks(
  text: string,
  sourceId: number,
  targetId: number,
  before: boolean
): string | null {
  const blocks = parseMarkdownBlocks(text)
  const source = blocks.find((block) => block.id === sourceId)
  const target = blocks.find((block) => block.id === targetId)
  if (source === undefined || target === undefined) return null
  if (!isMarkdownBlockDraggable(source) || !isMarkdownBlockDraggable(target) || source.id === target.id) return null
  const lines = text.split('\n')
  if (!inSameDropScope(lines, source, target)) return null
  if (source.from < target.to && target.from < source.to) return null

  // Move the block body, not the separator after it. Separators belong to the
  // document layout and are recreated at the new boundary below.
  const sourceLines = lines.slice(source.from, source.contentTo)
  const count = source.to - source.from
  lines.splice(source.from, count)

  const originalInsertAt = before ? target.from : target.to
  let insertAt = originalInsertAt - (source.from < originalInsertAt ? count : 0)
  // ⚠ 同层列表项之间**不能**补空行：预览遇到空行就把列表断开，紧密列表会被悄悄改成
  // 松散列表 / 两个列表。落点在列表内部是最常见的一种拖拽，这一条必须挡住。
  if (insertAt > 0 && lines[insertAt - 1] !== '' && sourceLines[0] !== '' && !sameListRunSeam(sourceLines[0], lines[insertAt - 1])) {
    lines.splice(insertAt, 0, '')
    insertAt += 1
  }
  lines.splice(insertAt, 0, ...sourceLines)
  const afterSource = insertAt + sourceLines.length
  if (
    afterSource < lines.length &&
    lines[afterSource - 1] !== '' &&
    lines[afterSource] !== '' &&
    !sameListRunSeam(lines[afterSource - 1], lines[afterSource])
  ) {
    lines.splice(afterSource, 0, '')
  }

  const trailingNewlines = text.match(/\n+$/)?.[0].length ?? 0
  const body = lines.join('\n').replace(/\n+$/, '')
  const next = body + '\n'.repeat(trailingNewlines)
  return next === text ? null : next
}

/** 接缝两侧是不是「同一个列表里相邻的两项」——是的话不该插空行分隔。 */
function sameListRunSeam(above: string, below: string): boolean {
  return itemMarkOf(above) !== null && itemMarkOf(below) !== null && indentOf(above) === indentOf(below)
}

// ── 拖拽落点 ──
//
// 两个纯函数,喂给 editor-blocks.ts 的位移计算。它们只跟「几何快照」打交道:
// 拖拽期间文档一个字都不改,所以快照一次算到底,判定不可能抖。

/** 一个可拖兄弟块的纵向占位,`top` / `height` 是**文档坐标**的像素。 */
export interface BlockSlot {
  id: number
  from: number
  to: number
  top: number
  height: number
  /**
   * 能不能落到它旁边（`inSameDropScope` 的结论）。**几何**永远用全部槽位算
   * （置换必须严丝合缝铺满），只有**落点分界**跳过不允许的那些 —— 于是
   * 「被拖块要绕过它、但不能停在它旁边」这种情形也能正确表达。缺省视为允许。
   */
  allowed?: boolean
}

export interface DropSlot {
  targetId: number
  before: boolean
}

/**
 * 指针落在哪一档。`slots` 是**除被拖块以外**的兄弟,按文档序。
 * 相邻两档的分界是那个块的**中线** —— 所以块只有在指针越过「将被它顶掉的那个块」的
 * 一半时才会动一下,越过之后该块已换到另一侧,不会来回翻(这就是滞回)。
 * 指针跑到整段范围外时自然停在首档/末档(块被夹在自己那一节的边界上,看得见)。
 * 只有 `allowed` 的槽位参与分界(不允许的会被「跨过」,不会被停在旁边)。
 */
export function resolveDropSlot(slots: readonly BlockSlot[], pointerTop: number): DropSlot | null {
  const allowed = slots.filter((slot) => slot.allowed !== false)
  if (allowed.length === 0) return null
  let index = 0
  for (const slot of allowed) {
    if (pointerTop > slot.top + slot.height / 2) index += 1
  }
  const last = allowed[allowed.length - 1]
  if (index >= allowed.length) return { targetId: last.id, before: false }
  return { targetId: allowed[index].id, before: true }
}

/**
 * 把被拖块搬到 `resolveDropSlot` 选中的那一档所需的视觉位移(id → 像素)。
 * 同父兄弟互换是一次**置换**,所以位移后各家仍然严丝合缝地铺满同一段纵向空间,不露缝。
 * `slots` 必须按文档序,且包含被拖块自己。
 */
export function permutationOffsets(
  slots: readonly BlockSlot[],
  sourceId: number,
  targetId: number,
  before: boolean
): Map<number, number> {
  const deltas = new Map<number, number>()
  const source = slots.find((slot) => slot.id === sourceId)
  if (source === undefined || slots.length < 2) return deltas
  const others = slots.filter((slot) => slot.id !== sourceId)
  const at = others.findIndex((slot) => slot.id === targetId)
  if (at < 0) return deltas
  const order = [...others.slice(0, before ? at : at + 1), source, ...others.slice(before ? at : at + 1)]
  let top = slots[0].top
  for (const slot of order) {
    deltas.set(slot.id, top - slot.top)
    top += slot.height
  }
  return deltas
}
