// 列表 / 任务行的**宽松**识别。预览、块模型、勾选回写、编辑器共用这一份口径。
//
// 与 GFM 的差别是刻意的:用户会敲出 `-[]`、`- []`、`- [x]文字` 这类写了一半的记号。
// 编辑器应当当场认出来,并在回车时补成标准写法(`- [ ] `),而不是等他们回头改。
//
// 但有一个边界不能松:`- [x](url)` / `- [text](url)` 是链接,不是任务。
// 判据是 `]` 后面紧跟 `(` 或 `[`。要写「勾选 + 括号开头的内容」,中间留一个空格即可。

export interface ListLineSyntax {
  /** 精确的引用前缀(`> ` / `> > `,含最多 3 个前导空格);无引用时为空串 */
  quote: string
  /** 列表标记前的缩进(相对引用前缀之后) */
  indent: string
  /** `-` / `+` / `*` / `1.` / `1)` */
  marker: string
  ordered: boolean
  number: number | null
  /** 标记与内容之间的空白;`-[]` 这类无空白形式为空串 */
  gap: string
  task: boolean
  checked: boolean
  /** 任务标记 `[` 与 `]` 之后相对整行的下标 */
  taskFrom: number
  taskTo: number
  /** 内容起始列(任务标记后的空白已跳过) */
  contentStart: number
  content: string
  /** Lezer / GFM 认的 TaskMarker 口径:`[ ]` 之后必须还有空白 —— 决定是否交给上游续行 */
  canonical: boolean
}

// 引用层只吃一个可选空格;多出来的空白留给列表缩进,否则差异会被抹平。
// 首个 `>` 之前最多 3 个空格:4 个空格是缩进代码块,不算引用。
// 回车退出引用(md-quote-continuation)也共用这一份口径。
export const QUOTE_PREFIX_RE = /^([ \t]{0,3}(?:>[ \t]?)+)/
const LIST_MARK_RE = /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]*)/
// 括号内:空 / 纯空白 = 未勾选,x/X = 已勾选;紧跟 ( 或 [ 更像链接,不算任务。
const TASK_MARK_RE = /^\[([ \t]*|[xX])\](?!\(|\[)/
const CANONICAL_TASK_RE = /^\[[ xX]\][ \t]/

/**
 * 分隔线(`---` / `- - -` / `***` / `___`)。`- - -` 会被 `parseListLine` 当成列表,
 * 但换掉标记就把分隔线拆坏了,所以按上一级换标记时要先把它排除。
 */
export const THEMATIC_BREAK_RE = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/

/** 无序标记的上下级关系:上级 `-` → 本级 `*`、`*` → `+`、`+` → `-`。 */
const CHILD_MARKER: Record<string, string> = { '-': '*', '*': '+', '+': '-' }

export function parseListLine(line: string): ListLineSyntax | null {
  const quoteMatch = QUOTE_PREFIX_RE.exec(line)
  const quote = quoteMatch === null ? '' : quoteMatch[1]
  const body = line.slice(quote.length)

  const match = LIST_MARK_RE.exec(body)
  if (match === null) return null
  const indent = match[1]
  const marker = match[2]
  const gap = match[3]
  const ordered = /^\d/.test(marker)
  const after = body.slice(match[0].length)
  const taskMatch = TASK_MARK_RE.exec(after)

  // 无空白只有一种合法情况:无序标记直接贴着任务括号(`-[]` / `-[x]`)。
  // `-foo`、`1.[]` 仍不是列表。
  if (gap === '' && (ordered || taskMatch === null)) return null

  const task = taskMatch !== null
  const checked = task && taskMatch[1].toLowerCase() === 'x'
  const markerEnd = quote.length + indent.length + marker.length + gap.length
  const taskFrom = markerEnd
  const taskTo = task ? markerEnd + taskMatch[0].length : markerEnd
  let contentStart = taskTo
  while (contentStart < line.length) {
    const ch = line[contentStart]
    if (ch !== ' ' && ch !== '\t') break
    contentStart += 1
  }

  return {
    quote,
    indent,
    marker,
    ordered,
    number: ordered ? Number.parseInt(marker, 10) : null,
    gap,
    task,
    checked,
    taskFrom,
    taskTo,
    contentStart,
    content: line.slice(contentStart),
    // 有序任务上游不认;无空白 / `[x]文字` / 行尾 `- [ ]` 也不是上游的口径。
    canonical: task && !ordered && gap !== '' && CANONICAL_TASK_RE.test(after)
  }
}

/** 顶格的列表行(引用整体由调用方另行处理)。 */
export function isListLine(line: string): boolean {
  const syntax = parseListLine(line)
  return syntax !== null && syntax.quote === ''
}

/** 菜单/工具条显示的「当前标记」。任务统一按 `- [ ] ` 显示,应用时由 setListMarker 规整。 */
export function listMarkerOf(line: string): '- ' | '1. ' | '- [ ] ' | '' {
  const syntax = parseListLine(line)
  if (syntax === null) return ''
  if (syntax.task) return '- [ ] '
  return syntax.ordered ? '1. ' : '- '
}

/**
 * 单行增加 / 减少一级缩进(默认 2 空格)。
 * 缩进要加在**引用前缀之后**:`> - item` 是引用里的列表,不是把整行推向右边。
 */
export function indentMarkdownLine(line: string, dir: 'in' | 'out', width = 2): string {
  if (line.trim() === '') return line
  const quoteMatch = QUOTE_PREFIX_RE.exec(line)
  const quote = quoteMatch === null ? '' : quoteMatch[1]
  const rest = line.slice(quote.length)
  if (dir === 'in') return `${quote}${' '.repeat(width)}${rest}`
  const out = /^(?: {1,2}|\t)/.exec(rest)
  return out === null ? line : `${quote}${rest.slice(out[0].length)}`
}

/** 引用前缀之后的主体(无引用时就是整行)。 */
function bodyAfterQuote(line: string): string {
  const match = QUOTE_PREFIX_RE.exec(line)
  return match === null ? line : line.slice(match[1].length)
}

/** 主体行首空白宽度(字符数,与块模型 `indentOf` 一致)。 */
function leadWidth(line: string): number {
  return /^[ \t]*/.exec(bodyAfterQuote(line))?.[0].length ?? 0
}

/**
 * 目标行的上一级列表项标记,以及由它推出的本级标记。
 *
 * 从近往远扫,跳过空行;中间的续行必须落在候选上级的内容列之内
 * (`leadWidth >= taskFrom - quote.length`),否则列表上下文已经结束 ——
 * 与块模型 `parseItemRun` / `inItem` 同一口径(不是预览的 `parseListExt`,
 * 那边遇到缩进不足的续行会直接断开列表)。
 * 没有上级、上级是有序列表、或中间存在更浅的续行 → 本级用基础标记 `-`。
 */
function parentMarkerOf(
  lines: readonly string[],
  index: number,
  indent: number,
  quote: string
): string {
  const leads: number[] = []
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = lines[i]
    if (line.trim() === '') continue
    if ((QUOTE_PREFIX_RE.exec(line)?.[1] ?? '') !== quote) return '-'
    // 分隔线是列表样子的行,但不能当上级,也不参与续行判断
    const syntax = THEMATIC_BREAK_RE.test(bodyAfterQuote(line)) ? null : parseListLine(line)
    if (syntax !== null) {
      if (syntax.indent.length < indent) {
        const content = syntax.taskFrom - syntax.quote.length
        if (leads.some((lead) => lead < content)) return '-'
        return CHILD_MARKER[syntax.marker] ?? '-'
      }
      continue
    }
    leads.push(leadWidth(line))
  }
  return '-'
}

export interface IndentOptions {
  /** 这些 0-based 行号在代码块里:只缩进、不换标记。扫描不感知代码块,最坏只是标记字符差异。 */
  skipMarker?: ReadonlySet<number>
}

/**
 * 给一批 0-based 行增减一级缩进。
 *
 * 无序、非任务项的标记由**上一级列表项**决定:
 * 上级 `-` → 本级 `*`、`*` → `+`、`+` → `-`;上级有序或没有上级 → `-`。
 * 有序 / 任务项只缩进。按行号升序处理;父项也在本批里时,用改过之后的标记继续算。
 * 返回 行号 → 新文本;没有任何行变化时返回 null。
 */
export function indentMarkdownLines(
  lines: readonly string[],
  lineNumbers: Iterable<number>,
  dir: 'in' | 'out',
  width = 2,
  { skipMarker }: IndentOptions = {}
): Map<number, string> | null {
  const working = lines.slice()
  const targets = [...new Set(lineNumbers)]
    .filter((n) => n >= 0 && n < working.length)
    .sort((a, b) => a - b)

  for (const index of targets) {
    const line = working[index]
    if (line.trim() === '') continue
    const next = indentMarkdownLine(line, dir, width)
    // out 且没有缩进可退:这一行不动,也不顺手把标记归一
    if (next === line) continue
    working[index] = next
    if (skipMarker?.has(index) === true) continue
    const syntax = parseListLine(next)
    if (syntax === null || syntax.ordered || syntax.task) continue
    // 按缩进**前**的样子判断分隔线:缩进后已经越过 3 个空格的上限,但那仍是用户的分隔线
    if (THEMATIC_BREAK_RE.test(bodyAfterQuote(line))) continue
    const marker = parentMarkerOf(working, index, syntax.indent.length, syntax.quote)
    if (marker === syntax.marker) continue
    const at = syntax.quote.length + syntax.indent.length
    working[index] = next.slice(0, at) + marker + next.slice(at + syntax.marker.length)
  }

  const changed = new Map<number, string>()
  for (const index of targets) {
    if (working[index] !== lines[index]) changed.set(index, working[index])
  }
  return changed.size > 0 ? changed : null
}
