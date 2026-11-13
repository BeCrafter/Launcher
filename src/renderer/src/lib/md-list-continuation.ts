// 回车的「规整 + 续行」计划(纯函数)。
//
// 上游 `insertNewlineContinueMarkup` 已经能处理标准写法;这里只接管它不认的那几种:
//   `-[]` / `- []` / `- [x]文字` / 行尾不带空格的 `- [ ]`,以及所有有序任务。
// 字母 / 罗马有序项(`a.` / `i.`)上游也不认,行尾回车在这里续出同一档的下一个序号,
// 并把后面刚好连着的同层兄弟一起 +1。空的 `a.` / `i.` 退一级,接上父列表的下一个编号。
// 十进制非任务仍返回 null,交给 CodeMirror。
// 规整与换行由调用方放进同一个 transaction —— 一次撤销就回到输入前。

import {
  formatOrderedToken,
  listSyntaxAt,
  parseListLine,
  QUOTE_PREFIX_RE,
  THEMATIC_BREAK_RE,
  type ListLineSyntax,
  type OrderedStyle
} from './md-list-syntax'

export interface ContinuationPlan {
  /** 当前行前缀的规整(相对行首);已是标准写法时为 undefined */
  normalize?: { from: number; to: number; insert: string }
  /** 换行插入位置(相对行首),固定在物理行尾 */
  insertAt: number
  /** 插入的 `\n` + 下一行前缀 */
  insert: string
  /** 执行后的光标列(相对行首,按新文档计算) */
  caret: number
  /**
   * 后面同层、同写法、序号刚好连着的兄弟,各自 +1。
   * 下标相对**当前行**(插入点之后的行,0 = 下一行)。空行退级时不用。
   */
  renumber?: { lineOffset: number; from: number; to: number; insert: string }[]
}

export function planMarkdownContinuation(
  line: string,
  caretCol: number,
  lines?: readonly string[],
  index?: number
): ContinuationPlan | null {
  // 只接行尾回车;行中切分交给上游,避免复杂的光标映射。
  if (line.slice(caretCol).trim() !== '') return null

  const doc = lines ?? [line]
  const at = index ?? 0
  const syntax = listSyntaxAt(doc, at) ?? taskSyntaxOf(line)
  if (syntax === null) return null

  if (syntax.task) return planTaskContinuation(line, syntax)
  if (syntax.style === null || syntax.style === 0 || syntax.delimiter === null || syntax.number === null) {
    return null
  }
  if (syntax.content.trim() === '') return planEmptyOrderedExit(doc, at, syntax)
  return planOrderedSibling(doc, at, syntax)
}

/** 任务续行走字面解析:有序任务不看字母档,顶格 `1. [ ]` 仍要接管。 */
function taskSyntaxOf(line: string): ListLineSyntax | null {
  const syntax = parseListLine(line)
  if (syntax === null || !syntax.task || THEMATIC_BREAK_RE.test(line.slice(syntax.quote.length))) return null
  return syntax
}

function planTaskContinuation(line: string, syntax: ListLineSyntax): ContinuationPlan | null {
  // 上游已经能正确续行的标准任务,原样交给它。
  if (syntax.canonical) return null

  const checked = syntax.checked ? '[x]' : '[ ]'
  const prefix = `${syntax.quote}${syntax.indent}${syntax.marker} ${checked} `
  const normalize =
    prefix === line.slice(0, syntax.contentStart)
      ? undefined
      : { from: 0, to: syntax.contentStart, insert: prefix }

  const nextMarker = syntax.ordered
    ? `${(syntax.number ?? 1) + 1}${syntax.marker.slice(-1)}`
    : syntax.marker
  const nextPrefix = `${syntax.quote}${syntax.indent}${nextMarker} [ ] `

  const contentLength = line.length - syntax.contentStart
  return {
    normalize,
    insertAt: line.length,
    insert: `\n${nextPrefix}`,
    caret: prefix.length + contentLength + 1 + nextPrefix.length
  }
}

/** 行尾回车:同一档下一个序号,后面连号的兄弟一起 +1。 */
function planOrderedSibling(
  lines: readonly string[],
  index: number,
  syntax: ListLineSyntax
): ContinuationPlan {
  const style = syntax.style as OrderedStyle
  const delim = syntax.delimiter as '.' | ')'
  const nextNumber = (syntax.number ?? 1) + 1
  const nextPrefix = `${syntax.quote}${syntax.indent}${formatOrderedToken(nextNumber, style)}${delim} `
  return {
    insertAt: lines[index].length,
    insert: `\n${nextPrefix}`,
    caret: lines[index].length + 1 + nextPrefix.length,
    renumber: followingRenumber(lines, index, syntax, 1)
  }
}

/**
 * 空的字母 / 罗马项:退一级。
 * 父级是有序项时接上它的下一个编号(和空 `1.` 交给 CodeMirror 时一样);
 * 父级是无序、或没有父级,就只去掉这一级标记。
 */
function planEmptyOrderedExit(
  lines: readonly string[],
  index: number,
  syntax: ListLineSyntax
): ContinuationPlan {
  const parent = parentListItem(lines, index, syntax)
  const line = lines[index]
  let insert = ''
  if (parent !== null && parent.ordered && parent.style !== null && parent.delimiter !== null && parent.number !== null) {
    const token = formatOrderedToken(parent.number + 1, parent.style)
    insert = `${parent.quote}${parent.indent}${token}${parent.delimiter} `
  } else if (parent !== null && !parent.ordered) {
    insert = `${parent.quote}${parent.indent}${parent.marker} `
  }
  // 标记连同它后面的空白一起清掉。被抛下的这一项从列表里消失,
  // 后面连着的兄弟各 -1(CodeMirror 对空 `1.` 是 renumberList(..., -2),起点是被抛下的项本身)。
  return {
    normalize: { from: 0, to: line.length, insert },
    insertAt: line.length,
    insert: '',
    caret: insert.length,
    renumber: followingRenumber(lines, index, syntax, -1)
  }
}

/**
 * 后面同层、同写法、序号刚好连着的兄弟。碰到断号、空行或另一种标记就停,
 * 与 CodeMirror `renumberList` 同一口径。`delta` 是每一项要加的量(续行是 +1)。
 * `from` / `to` 相对那一行的行首。
 */
function followingRenumber(
  lines: readonly string[],
  index: number,
  syntax: ListLineSyntax,
  delta: number
): ContinuationPlan['renumber'] {
  const out: NonNullable<ContinuationPlan['renumber']> = []
  let prev = syntax.number ?? 1
  const indent = syntax.indent.length
  const quote = syntax.quote
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '') break
    if ((QUOTE_PREFIX_RE.exec(line)?.[1] ?? '') !== quote) break
    const next = parseListLine(line)
    if (
      next === null ||
      next.task ||
      !next.ordered ||
      next.indent.length !== indent ||
      next.style !== syntax.style ||
      next.delimiter !== syntax.delimiter ||
      next.number === null
    ) {
      break
    }
    if (next.number !== prev + 1) break
    const at = next.quote.length + next.indent.length
    const token = formatOrderedToken(next.number + delta, syntax.style as OrderedStyle)
    out.push({
      lineOffset: i - index,
      from: at,
      to: at + next.marker.length - 1,
      insert: token
    })
    prev = next.number
  }
  return out.length > 0 ? out : undefined
}

/** 最近一个更浅的列表项。续行落在它的内容列之外,上下文就算结束。 */
function parentListItem(
  lines: readonly string[],
  index: number,
  syntax: ListLineSyntax
): ListLineSyntax | null {
  const leads: number[] = []
  const quote = syntax.quote
  let indent = syntax.indent.length
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = lines[i]
    if (line.trim() === '') continue
    if ((QUOTE_PREFIX_RE.exec(line)?.[1] ?? '') !== quote) return null
    const item = THEMATIC_BREAK_RE.test(line.slice(quote.length)) ? null : parseListLine(line)
    if (item === null) {
      leads.push(/^[ \t]*/.exec(line.slice(quote.length))?.[0].length ?? 0)
      continue
    }
    if (item.indent.length >= indent) continue
    const content = item.taskFrom - item.quote.length
    if (leads.some((lead) => lead < content)) return null
    return item
  }
  return null
}
