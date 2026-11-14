// 列表 / 任务行的**宽松**识别。预览、块模型、勾选回写、编辑器共用这一份口径。
//
// 与 GFM 的差别是刻意的:用户会敲出 `-[]`、`- []`、`- [x]文字` 这类写了一半的记号。
// 编辑器应当当场认出来,并在回车时补成标准写法(`- [ ] `),而不是等他们回头改。
//
// 但有一个边界不能松:`- [x](url)` / `- [text](url)` 是链接,不是任务。
// 判据是 `]` 后面紧跟 `(` 或 `[`。要写「勾选 + 括号开头的内容」,中间留一个空格即可。

/** 有序标记的书写档:0 = 十进制,1 = 字母,2 = 罗马数字。无序行为 null。 */
export type OrderedStyle = 0 | 1 | 2

export interface ListLineSyntax {
  /** 精确的引用前缀(`> ` / `> > `,含最多 3 个前导空格);无引用时为空串 */
  quote: string
  /** 列表标记前的缩进(相对引用前缀之后) */
  indent: string
  /** `-` / `+` / `*` / `1.` / `a.` / `i.` / `1)` */
  marker: string
  ordered: boolean
  /** 有序序号(1-based);无序行为 null */
  number: number | null
  /** 有序书写档;无序行为 null。`i.` 同时是字母和罗马,这里先放字母,`listSyntaxAt` 再按上级改。 */
  style: OrderedStyle | null
  /** 这个标记字面上能当的档。`i.` 是 [1, 2]。 */
  styles: readonly OrderedStyle[]
  /** 分隔符跟着这一行走:`.` 或 `)` */
  delimiter: '.' | ')' | null
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
// 字母 / 罗马数字也吃进来,但标记必须到此为止:后面再粘着字母就不是列表(`# A` 不能被看成 `a.`)。
// 它们是不是列表要再看上级档位 —— 见 `listSyntaxAt`。
const LIST_MARK_RE =
  /^([ \t]*)([-+*]|\d{1,9}[.)]|[a-z]{1,8}[.)](?![A-Za-z])|[ivxlcdm]{1,16}[.)](?![A-Za-z]))([ \t]*)/
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

const ROMAN_VALUES: Readonly<Record<string, number>> = {
  i: 1,
  v: 5,
  x: 10,
  l: 50,
  c: 100,
  d: 500,
  m: 1000
}
const ROMAN_PARTS: ReadonlyArray<readonly [number, string]> = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i']
]

/** 字母档:a=1 … z=26,aa=27(表格那种双射,没有 0)。 */
export function encodeAlpha(n: number): string {
  if (!Number.isInteger(n) || n < 1) return 'a'
  let rest = n
  let out = ''
  while (rest > 0) {
    rest -= 1
    out = String.fromCharCode(97 + (rest % 26)) + out
    rest = Math.floor(rest / 26)
  }
  return out
}

export function decodeAlpha(token: string): number | null {
  if (!/^[a-z]+$/.test(token)) return null
  let n = 0
  for (const ch of token) n = n * 26 + (ch.charCodeAt(0) - 96)
  return n
}

/** 罗马数字用常规减法写法,到 3999;再大就停在 mmmcmxcix。 */
export function encodeRoman(n: number): string {
  if (!Number.isInteger(n) || n < 1) return 'i'
  let rest = Math.min(n, 3999)
  let out = ''
  for (const [value, glyph] of ROMAN_PARTS) {
    while (rest >= value) {
      out += glyph
      rest -= value
    }
  }
  return out
}

export function decodeRoman(token: string): number | null {
  if (!/^[ivxlcdm]+$/.test(token)) return null
  let total = 0
  let prev = 0
  for (let i = token.length - 1; i >= 0; i -= 1) {
    const value = ROMAN_VALUES[token[i]]
    if (value === undefined) return null
    total += value < prev ? -value : value
    prev = Math.max(prev, value)
  }
  if (total < 1 || total > 3999 || encodeRoman(total) !== token) return null
  return total
}

/** 按档位写出标记主体(不含分隔符)。档位对 3 取余:0 十进制、1 字母、2 罗马。 */
export function formatOrderedToken(n: number, tier: number): string {
  const style = ((tier % 3) + 3) % 3
  if (style === 1) return encodeAlpha(n)
  if (style === 2) return encodeRoman(n)
  return String(Math.max(1, Math.floor(n)))
}

/**
 * 字面能当哪几档。`i.` 既是字母第 9 项也是罗马第 1 项,两档都留着;
 * 落到哪一档由有序上级的个数决定,不能在解析时就定死。
 */
function literalStylesOf(token: string): OrderedStyle[] {
  if (/^\d+$/.test(token)) return [0]
  const styles: OrderedStyle[] = []
  if (decodeAlpha(token) !== null) styles.push(1)
  if (decodeRoman(token) !== null) styles.push(2)
  return styles
}

function numberInStyle(token: string, style: OrderedStyle): number | null {
  if (style === 0) {
    const n = Number.parseInt(token, 10)
    return Number.isFinite(n) ? n : null
  }
  if (style === 1) return decodeAlpha(token)
  return decodeRoman(token)
}

export function parseListLine(line: string): ListLineSyntax | null {
  const quoteMatch = QUOTE_PREFIX_RE.exec(line)
  const quote = quoteMatch === null ? '' : quoteMatch[1]
  const body = line.slice(quote.length)

  const match = LIST_MARK_RE.exec(body)
  if (match === null) return null
  const indent = match[1]
  const marker = match[2]
  const gap = match[3]
  const delim = marker.slice(-1)
  const token = marker.slice(0, -1)
  const bullet = marker === '-' || marker === '+' || marker === '*'
  const ordered = !bullet && (delim === '.' || delim === ')')
  const styles: readonly OrderedStyle[] = ordered ? literalStylesOf(token) : []
  // 字面默认档:十进制、否则字母优先于罗马。`i.` 先当第 9 项,有罗马上级时再改。
  const style: OrderedStyle | null = styles.includes(1) ? 1 : (styles[0] ?? null)
  const number = style === null ? null : numberInStyle(token, style)
  if (ordered && (style === null || number === null)) return null
  const after = body.slice(match[0].length)
  const taskMatch = TASK_MARK_RE.exec(after)

  // 无空白只有一种合法情况:无序标记直接贴着任务括号(`-[]` / `-[x]`)。
  // `-foo`、`1.[]`、`a.[]` 仍不是列表。
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
    number,
    style,
    styles,
    delimiter: ordered && (delim === '.' || delim === ')') ? delim : null,
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

/** 顶格的列表行(引用整体由调用方另行处理)。顶格的 a. / i. 是句子,不是列表。 */
export function isListLine(line: string): boolean {
  const syntax = parseListLine(line)
  if (syntax === null || syntax.quote !== '') return false
  if (syntax.ordered && syntax.style !== 0 && !syntax.task) return false
  return true
}

/** 菜单/工具条显示的「当前标记」。任务统一按 `- [ ] ` 显示,有序(含 a. / i.)统一按 `1. `。 */
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

interface OrderedContext {
  /** 有序上级的个数。无序上级不算。扫到列表上下文结束就停。 */
  orderedAncestors: number
  /** 同一层、同一书写档、同一分隔符的前一个兄弟序号;没有就是 null。 */
  siblingNumber: number | null
}

/**
 * 从这一行往上找列表上下文。空行跳过;续行必须落在候选上级的内容列里,
 * 否则上下文结束 —— 与块模型 `inItem` 同一口径。
 * 引用前缀必须一致。分隔线既不当上级,也不算续行。
 */
function orderedContextOf(
  lines: readonly string[],
  index: number,
  indent: number,
  quote: string,
  style: OrderedStyle | null,
  delimiter: '.' | ')' | null
): OrderedContext {
  const leads: number[] = []
  let siblingNumber: number | null = null
  let orderedAncestors = 0
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = lines[i]
    if (line.trim() === '') continue
    if ((QUOTE_PREFIX_RE.exec(line)?.[1] ?? '') !== quote) break
    const syntax = THEMATIC_BREAK_RE.test(bodyAfterQuote(line)) ? null : parseListLine(line)
    if (syntax === null) {
      leads.push(leadWidth(line))
      continue
    }
    if (syntax.indent.length > indent) continue
    if (syntax.indent.length === indent) {
      // 同一层:只取最近一个同档兄弟。十进制旧笔记(style 0)不算字母档的兄弟。
      if (
        siblingNumber === null &&
        style !== null &&
        syntax.ordered &&
        !syntax.task &&
        syntax.style === style &&
        syntax.delimiter === delimiter &&
        syntax.number !== null
      ) {
        siblingNumber = syntax.number
      }
      continue
    }
    const content = syntax.taskFrom - syntax.quote.length
    if (leads.some((lead) => lead < content)) break
    if (syntax.ordered && !syntax.task) orderedAncestors += 1
    // 再往上只数更浅的有序上级,不再找兄弟
    indent = syntax.indent.length
    leads.length = 0
  }
  return { orderedAncestors, siblingNumber }
}

/**
 * 这一行在整篇里是不是列表。
 * `parseListLine` 只看字面,顶格 `a. 注意` 也会被认成字母列表。
 * 字母 / 罗马必须落在对应档位(有序上级个数 mod 3)才算;十进制任何一层都认。
 * 任务项不参与档位。
 */
export function listSyntaxAt(lines: readonly string[], index: number): ListLineSyntax | null {
  if (index < 0 || index >= lines.length) return null
  const line = lines[index]
  if (typeof line !== 'string') return null
  const syntax = parseListLine(line)
  if (syntax === null || THEMATIC_BREAK_RE.test(bodyAfterQuote(line))) return null
  if (!syntax.ordered || syntax.task || syntax.styles.includes(0) || syntax.delimiter === null) {
    return syntax
  }
  const ctx = orderedContextOf(lines, index, syntax.indent.length, syntax.quote, null, null)
  const tier = (ctx.orderedAncestors % 3) as OrderedStyle
  if (!syntax.styles.includes(tier)) return null
  if (tier === syntax.style) return syntax
  const number = numberInStyle(syntax.marker.slice(0, -1), tier)
  return number === null ? null : { ...syntax, style: tier, number }
}

/** 顶格的列表行,字母 / 罗马要过档位。 */
export function isListLineAt(lines: readonly string[], index: number): boolean {
  const syntax = listSyntaxAt(lines, index)
  return syntax !== null && syntax.quote === ''
}

/**
 * 目标行的上一级无序列表标记,以及由它推出的本级标记。
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

/** 把有序标记换成新档位的写法,分隔符和标记后的空白保持不动。 */
function rewriteOrderedMarker(line: string, syntax: ListLineSyntax, token: string): string {
  const at = syntax.quote.length + syntax.indent.length
  const delim = syntax.delimiter ?? '.'
  return line.slice(0, at) + token + delim + line.slice(at + syntax.marker.length)
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
 * 有序、非任务项先加减空格,再看新位置的有序上级个数:
 * 档位没变(顶格再缩进、或上级是无序)只动空格;档位变了改成那一档,
 * 序号取同一层同写法的前一个兄弟 + 1,没有就从 1 开始。
 * 任务项只缩进。按行号升序处理;父项也在本批里时,用改过之后的标记继续算。
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
    if (syntax === null || syntax.task) continue
    // 按缩进**前**的样子判断分隔线:缩进后已经越过 3 个空格的上限,但那仍是用户的分隔线
    if (THEMATIC_BREAK_RE.test(bodyAfterQuote(line))) continue
    const orderedItem = syntax.ordered && syntax.delimiter !== null && syntax.number !== null && syntax.style !== null
    if (!orderedItem) {
      const marker = parentMarkerOf(working, index, syntax.indent.length, syntax.quote)
      if (marker === syntax.marker) continue
      const at = syntax.quote.length + syntax.indent.length
      working[index] = next.slice(0, at) + marker + next.slice(at + syntax.marker.length)
      continue
    }
    const tier = orderedContextOf(working, index, syntax.indent.length, syntax.quote, null, null)
      .orderedAncestors % 3
    // 父项若也在本批里,比较要用改过之后的文档,否则子项还看着旧缩进,档位会被算成没变。
    const prevTier = orderedContextOf(
      working,
      index,
      syntax.indent.length + (dir === 'in' ? -width : width),
      syntax.quote,
      null,
      null
    ).orderedAncestors % 3
    // 档位没变:只动空格。顶格 `1.` 再缩进、或 `  1.` 上面是无序,序号都不改。
    // 旧笔记里缩进过的十进制因此也不会被批量改写。
    // 档位变了才换成这一档,序号取同一层同写法的前一个兄弟 + 1。
    if (tier === prevTier) continue
    const siblings = orderedContextOf(
      working,
      index,
      syntax.indent.length,
      syntax.quote,
      tier as OrderedStyle,
      syntax.delimiter
    )
    const number = (siblings.siblingNumber ?? 0) + 1
    working[index] = rewriteOrderedMarker(next, syntax, formatOrderedToken(number, tier))
  }

  const changed = new Map<number, string>()
  for (const index of targets) {
    if (working[index] !== lines[index]) changed.set(index, working[index])
  }
  return changed.size > 0 ? changed : null
}
