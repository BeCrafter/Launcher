export type MarkdownBlockKind =
  | 'frontmatter'
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'quote'
  | 'callout'
  | 'table'
  | 'fence'
  | 'details'
  | 'thematicBreak'

/**
 * A source block uses half-open line ranges. `to` includes the blank lines
 * following the block so moving a block keeps the author's spacing intact.
 * Heading blocks contain their complete heading subtree.
 */
export interface MarkdownBlock {
  id: number
  kind: MarkdownBlockKind
  from: number
  to: number
  /** Last non-blank line plus one. Used to avoid folding trailing whitespace only. */
  contentTo: number
  /** Heading depth; zero for non-heading blocks. */
  level: number
  /** The nearest containing heading, or null for root blocks. */
  parentId: number | null
  movable: boolean
}

interface ConsumedBlock {
  kind: Exclude<MarkdownBlockKind, 'frontmatter' | 'heading'>
  contentTo: number
  to: number
}

const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+|$)/
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(?:[^`~]*)$/
const LIST_RE = /^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/
const QUOTE_RE = /^ {0,3}>/
const THEMATIC_BREAK_RE = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/
const CALLOUT_RE = /^ {0,3}>[ \t]*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i
const DETAILS_OPEN_RE = /^ {0,3}<details(?:\s|>)/i
const DETAILS_CLOSE_RE = /^ {0,3}<\/details\s*>/i

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

function listContinuation(line: string): boolean {
  return /^ {2,}\S/.test(line)
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
  return { kind: 'fence', contentTo: i, to: withTrailingBlanks(lines, i, limit) }
}

function consumeDetails(lines: string[], start: number, limit: number): ConsumedBlock {
  let i = start + 1
  while (i < limit && !DETAILS_CLOSE_RE.test(lines[i])) i += 1
  if (i < limit) i += 1
  return { kind: 'details', contentTo: i, to: withTrailingBlanks(lines, i, limit) }
}

function consumeQuote(lines: string[], start: number, limit: number): ConsumedBlock {
  const kind = CALLOUT_RE.test(lines[start]) ? 'callout' : 'quote'
  let i = start
  while (i < limit && QUOTE_RE.test(lines[i])) i += 1
  return { kind, contentTo: i, to: withTrailingBlanks(lines, i, limit) }
}

function consumeList(lines: string[], start: number, limit: number): ConsumedBlock {
  let i = start
  while (i < limit) {
    const line = lines[i]
    if (LIST_RE.test(line) || listContinuation(line)) {
      i += 1
      continue
    }
    break
  }
  return { kind: 'list', contentTo: i, to: withTrailingBlanks(lines, i, limit) }
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
  if (LIST_RE.test(lines[start])) return consumeList(lines, start, limit)
  if (start + 1 < limit && tableRow(lines[start]) && tableDelimiter(lines[start + 1])) {
    return consumeTable(lines, start, limit)
  }
  if (THEMATIC_BREAK_RE.test(lines[start])) {
    return { kind: 'thematicBreak', contentTo: start + 1, to: withTrailingBlanks(lines, start + 1, limit) }
  }
  return consumeParagraph(lines, start, limit)
}

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
  const headings: MarkdownBlock[] = []
  let i = 0

  const fmEnd = frontmatterEnd(lines, limit)
  if (fmEnd !== null) {
    blocks.push({
      id: blocks.length,
      kind: 'frontmatter',
      from: 0,
      to: fmEnd,
      contentTo: fmEnd,
      level: 0,
      parentId: null,
      movable: false
    })
    i = fmEnd
  }

  while (i < limit) {
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
        to: limit,
        contentTo: i + 1,
        level: heading.level,
        parentId: headings.length > 0 ? headings[headings.length - 1].id : null,
        movable: true
      }
      blocks.push(block)
      headings.push(block)
      i += 1
      continue
    }

    const consumed = consumeBlock(lines, i, limit)
    blocks.push({
      id: blocks.length,
      kind: consumed.kind,
      from: i,
      to: consumed.to,
      contentTo: consumed.contentTo,
      level: 0,
      parentId: headings.length > 0 ? headings[headings.length - 1].id : null,
      movable: true
    })
    i = consumed.to
  }

  while (headings.length > 0) closeHeading(lines, headings.pop()!, limit)
  return blocks
}

export function isMarkdownBlockDraggable(block: MarkdownBlock): boolean {
  return block.movable && (block.kind === 'heading' || block.kind === 'fence' || block.kind === 'table')
}

export function isMarkdownBlockFoldable(block: MarkdownBlock): boolean {
  return block.movable && (block.kind === 'heading' || block.kind === 'fence' || block.kind === 'table') && block.contentTo > block.from + 1
}

/** Find the most specific block containing a source line. */
export function blockAtLine(blocks: readonly MarkdownBlock[], line: number): MarkdownBlock | null {
  let result: MarkdownBlock | null = null
  for (const block of blocks) {
    if (line < block.from || line >= block.to) continue
    if (result === null || block.from > result.from || (block.from === result.from && block.to < result.to)) {
      result = block
    }
  }
  return result
}

export function draggableBlockAtLine(blocks: readonly MarkdownBlock[], line: number): MarkdownBlock | null {
  let result: MarkdownBlock | null = null
  for (const block of blocks) {
    if (!isMarkdownBlockDraggable(block) || line < block.from || line >= block.to) continue
    if (result === null || block.from > result.from || (block.from === result.from && block.to < result.to)) {
      result = block
    }
  }
  return result
}

/**
 * Move one block before/after another direct sibling. Returns null for invalid
 * moves (frontmatter, different parents, or a block dropped onto itself).
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
  if (source.parentId !== target.parentId) return null
  if (source.from < target.to && target.from < source.to) return null

  const lines = text.split('\n')
  // Move the block body, not the separator after it. Separators belong to the
  // document layout and are recreated at the new boundary below.
  const sourceLines = lines.slice(source.from, source.contentTo)
  const count = source.to - source.from
  lines.splice(source.from, count)

  const originalInsertAt = before ? target.from : target.to
  let insertAt = originalInsertAt - (source.from < originalInsertAt ? count : 0)
  if (insertAt > 0 && lines[insertAt - 1] !== '' && sourceLines[0] !== '') {
    lines.splice(insertAt, 0, '')
    insertAt += 1
  }
  lines.splice(insertAt, 0, ...sourceLines)
  const afterSource = insertAt + sourceLines.length
  if (
    afterSource < lines.length &&
    lines[afterSource - 1] !== '' &&
    lines[afterSource] !== ''
  ) {
    lines.splice(afterSource, 0, '')
  }

  const trailingNewlines = text.match(/\n+$/)?.[0].length ?? 0
  const body = lines.join('\n').replace(/\n+$/, '')
  const next = body + '\n'.repeat(trailingNewlines)
  return next === text ? null : next
}
