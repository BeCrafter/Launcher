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
const QUOTE_PREFIX_RE = /^([ \t]{0,3}(?:>[ \t]?)+)/
const LIST_MARK_RE = /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]*)/
// 括号内:空 / 纯空白 = 未勾选,x/X = 已勾选;紧跟 ( 或 [ 更像链接,不算任务。
const TASK_MARK_RE = /^\[([ \t]*|[xX])\](?!\(|\[)/
const CANONICAL_TASK_RE = /^\[[ xX]\][ \t]/

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

/** 批量缩进;没有任何行需要改时返回 null,调用方据此省掉一次 dispatch。 */
export function indentMarkdownLines(
  lines: readonly string[],
  dir: 'in' | 'out',
  width = 2
): string[] | null {
  let changed = false
  const out = lines.map((line) => {
    const next = indentMarkdownLine(line, dir, width)
    if (next !== line) changed = true
    return next
  })
  return changed ? out : null
}
