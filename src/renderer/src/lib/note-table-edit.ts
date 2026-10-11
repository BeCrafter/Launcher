// 表格的解析 / 序列化 / 增删改(纯函数)。
//
// 预览里的表格之前只能看 —— 用户想改一个错字得跑到左边源码里数竖线。
// 这里给出「按行列坐标改一格」的能力,写回时**整块重排**。
//
// 为什么重排整块而不是只改那一行:表格的价值一半在列对齐,只改一行会让它错位;
// 而且列增删本来就必须动所有行。重排只动空白,不动任何单元格内容。

import { clampTableWidth } from '@shared/note-table-style'
import { linePrefix } from './note-media-size'

export type TableAlign = 'left' | 'center' | 'right' | null

export interface TableBlock {
  /** 表格在正文里的行区间(含首尾,0 起) */
  from: number
  to: number
  /** 表头单元格(已去转义) */
  header: string[]
  aligns: TableAlign[]
  /** 正文行;每行单元格数可能少于表头(源文允许) */
  rows: string[][]
}

/** 一行是不是表格行:`| a | b |` */
export function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line)
}

/** 一行是不是分隔行:`|---|:--:|` */
export function isTableSep(line: string): boolean {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes('-')
}

/**
 * 拆一行成单元格。单元格里的字面竖线写作 `\|`(如 `curl … \| bash`),
 * 不能当分隔符,否则该行从那里裂开、后面所有列错位。
 */
export function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'))
}

/** 单元格 → 源文形态(把裸竖线重新转义,否则写回去会把这一行拆坏) */
function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

function alignsOf(sep: string): TableAlign[] {
  return splitRow(sep).map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

/**
 * 从 `startLine` 开始读一张表。不是表格(缺分隔行)返回 null。
 * 表头行 + 分隔行是必需的 —— 没有分隔行的 `| a | b |` 只是一段普通文本。
 */
export function parseTableBlock(lines: string[], startLine: number): TableBlock | null {
  if (startLine < 0 || startLine + 1 >= lines.length) return null
  if (!isTableRow(lines[startLine]) || !isTableSep(lines[startLine + 1])) return null

  const header = splitRow(lines[startLine])
  const aligns = alignsOf(lines[startLine + 1])
  const rows: string[][] = []
  let i = startLine + 2
  while (i < lines.length && isTableRow(lines[i])) rows.push(splitRow(lines[i++]))
  return { from: startLine, to: i - 1, header, aligns, rows }
}

/** 列数:表头说了算(正文行缺的列在渲染/写回时补齐) */
export function colCount(t: TableBlock): number {
  return t.header.length
}

/** 序列化。补齐每行的列数,并按列宽对齐(只动空白,不动内容) */
export function renderTableBlock(t: TableBlock): string {
  const cols = colCount(t)
  const pad = (r: string[]): string[] => Array.from({ length: cols }, (_, i) => r[i] ?? '')

  const head = pad(t.header).map(escapeCell)
  const body = t.rows.map((r) => pad(r).map(escapeCell))
  // 下限 4 而不是 3:带对齐标记的分隔格是  这种「冒号 + 破折号」,
  // 宽度 3 时只剩 2 个破折号,而多数解析器要求至少 3 个
  const widths = head.map((h, c) => Math.max(h.length, ...body.map((r) => r[c].length), 4))

  const sep = (c: number): string => {
    const w = widths[c]
    const a = t.aligns[c]
    if (a === 'center') return `:${'-'.repeat(w - 2)}:`
    if (a === 'right') return `${'-'.repeat(w - 1)}:`
    if (a === 'left') return `:${'-'.repeat(w - 1)}`
    return '-'.repeat(w)
  }

  const row = (cells: string[]): string =>
    `| ${cells.map((cell, c) => cell.padEnd(widths[c], ' ')).join(' | ')} |`

  return [row(head), row(Array.from({ length: cols }, (_, c) => sep(c))), ...body.map(row)].join('\n')
}

/** 把改好的模型写回正文 */
/** 一次命中:表格的绝对行区间 + 这一层的**前缀**(引用里是 `> `) */
interface TableHit {
  lines: string[]
  t: TableBlock
  prefix: string
}

/**
 * 定位到某张表;`line` 是它**起始行**的行号。
 *
 * **引用与提示块里的表格走的是同一条路** —— 那一层每一行都带前缀(`> ` / `> > `),
 * 所以先把前缀剥掉再按普通表格解析,写回时再贴回去。
 * 不这么做的话,`> | a | b |` 连「这是不是表格行」都判不出来(行首是 `>` 不是 `|`),
 * 双击改格子、加行加列在引用里就全都做不了。
 */
function at(body: string, line: number): TableHit | null {
  const lines = body.split('\n')
  if (line < 0 || line >= lines.length) return null
  const prefix = linePrefix(lines[line]!)
  // 同一前缀、且剥掉前缀后仍是表格行的连续若干行 —— 就是这张表的范围
  let end = line
  while (
    end < lines.length &&
    lines[end]!.startsWith(prefix) &&
    isTableRow(lines[end]!.slice(prefix.length))
  ) {
    end++
  }
  if (end === line) return null
  const t = parseTableBlock(
    lines.slice(line, end).map((l) => l.slice(prefix.length)),
    0
  )
  if (t === null) return null
  return { lines, t: { ...t, from: line + t.from, to: line + t.to }, prefix }
}

/** 把改好的模型写回正文。**每一行都要带上前缀** —— 否则会把表写到引用外面去 */
function splice(hit: TableHit): string {
  const { lines, t, prefix } = hit
  lines.splice(
    t.from,
    t.to - t.from + 1,
    ...renderTableBlock(t)
      .split('\n')
      .map((l) => prefix + l)
  )
  return lines.join('\n')
}

const clone = (t: TableBlock): TableBlock => ({
  ...t,
  header: [...t.header],
  aligns: [...t.aligns],
  rows: t.rows.map((r) => [...r])
})

/**
 * 改一格。`row` 0 = 表头,1..n = 正文行;`col` 从 0 起。
 * 越界返回 null(调用方不提示也行 —— 那是它自己算出来的坐标)。
 */
export function setTableCell(
  body: string,
  line: number,
  row: number,
  col: number,
  value: string
): string | null {
  const hit = at(body, line)
  if (hit === null) return null
  const t = clone(hit.t)
  if (col < 0 || col >= colCount(t)) return null
  if (row === 0) t.header[col] = value
  else {
    const r = t.rows[row - 1]
    if (r === undefined) return null
    while (r.length < colCount(t)) r.push('')
    r[col] = value
  }
  return splice({ ...hit, t })
}

/** 在第 `row` 行**之后**插一行(0 = 表头之后、正文第一行之前) */
export function addTableRow(body: string, line: number, row: number): string | null {
  const hit = at(body, line)
  if (hit === null) return null
  const t = clone(hit.t)
  const at2 = Math.min(Math.max(row, 0), t.rows.length)
  t.rows.splice(at2, 0, Array.from({ length: colCount(t) }, () => ''))
  return splice({ ...hit, t })
}

/** 删掉第 `row` 行(1..n;表头删不得 —— 删了这张表就不成立了) */
export function removeTableRow(body: string, line: number, row: number): string | null {
  const hit = at(body, line)
  if (hit === null || row < 1 || row > hit.t.rows.length) return null
  const t = clone(hit.t)
  t.rows.splice(row - 1, 1)
  return splice({ ...hit, t })
}

/** 在第 `col` 列**之后**插一列 */
export function addTableColumn(body: string, line: number, col: number): string | null {
  const hit = at(body, line)
  if (hit === null) return null
  const t = clone(hit.t)
  const at2 = Math.min(Math.max(col + 1, 0), colCount(t))
  t.header.splice(at2, 0, '')
  t.aligns.splice(at2, 0, null)
  for (const r of t.rows) {
    while (r.length < colCount(t) - 1) r.push('')
    r.splice(at2, 0, '')
  }
  return splice({ ...hit, t })
}

/** 删掉第 `col` 列。只剩一列时拒绝 —— 一张没有列的表没有意义 */
export function removeTableColumn(body: string, line: number, col: number): string | null {
  const hit = at(body, line)
  if (hit === null) return null
  const t = clone(hit.t)
  if (colCount(t) <= 1 || col < 0 || col >= colCount(t)) return null
  t.header.splice(col, 1)
  t.aligns.splice(col, 1)
  for (const r of t.rows) r.splice(col, 1)
  return splice({ ...hit, t })
}

/**
 * 单元格里的换行。
 *
 * GFM 的表格**一行就是一行** —— 单元格里放真正的换行会把这张表拆散。
 * 通行做法(Obsidian / GitHub 都认)是写 `<br>`。所以:
 *   · 编辑时用户按回车 → 写回时转成 `<br>`;
 *   · 再次双击编辑时 → 转回换行,用户在文本框里看到的还是多行。
 *
 * 这是我们**唯一**认的一小段「HTML」,而且是字面量匹配 + 产 React `<br/>`,
 * 不是解析 HTML —— markdown.tsx「绝不注入」那条保证没有被破。
 */
const BR_RE = /<br\s*\/?>/gi

/** 源文里的单元格 → 编辑框里的文本 */
export function cellToEditText(raw: string): string {
  return raw.replace(BR_RE, '\n')
}

/** 编辑框里的文本 → 源文里的单元格。逐行去空白:表格单元格里的缩进没有意义 */
export function cellFromEditText(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .join('<br>')
    .trim()
}


/** 表格的宽度上限/下限由 shared/note-table-style 定义,这里只是转发,免得两处各写一份 */
export { TABLE_WIDTH_MAX, TABLE_WIDTH_MIN, clampTableWidth } from '@shared/note-table-style'

/**
 * 改表格围栏里的一个选项(宽度 / 列宽 / 行高),返回新的正文。
 *
 * 这些尺寸**只能存在 ````table 围栏的选项里**(GFM 表格语法没有属性位),所以:
 *   · 已经包在围栏里 → 改/加那一个键,**其它键原样保留**(改列宽不该把 border=none 抹掉);
 *   · 没包 → **就地包一层**。这会改动用户文件的结构,但那是「拖动改尺寸」的唯一落点 ——
 *     不包的话拖完一刷新就没了,比不做还糟。围栏本身在 Obsidian/GitHub 上只是一段
 *     普通代码块,不破坏可移植性(内容仍然是标准 GFM 表格)。
 *
 * `value` 为 null = 删掉这个键。
 */
export function setTableOptionsInBody(
  body: string,
  table: { line: number; to: number; fenced: boolean },
  opts: ReadonlyArray<readonly [string, string | null]>
): string | null {
  const lines = body.split('\n')
  const { line, to, fenced } = table
  if (line < 0 || to >= lines.length || to < line) return null

  const wanted = opts.filter(([, v]) => v !== null).map(([k, v]) => `${k}=${v}`)
  const keys = new Set(opts.map(([k]) => k.toLowerCase()))
  // 前缀取自**表格那一行**:围栏行与表格行在同一个引用层里,前缀必然相同
  const prefix = linePrefix(lines[line]!)

  if (fenced) {
    // 围栏的开启行在表格上一行
    const open = line - 1
    if (open < 0) return null
    const openLine = lines[open]!
    // 前缀对不上就**不动手** —— 宁可什么都不改,也不要写坏
    if (!openLine.startsWith(prefix)) return null
    const bare = openLine.slice(prefix.length)
    const m = /^\s*(`{3,}|~{3,})table\b\s*/.exec(bare)
    if (m === null) return null
    const kept = bare
      .slice(m[0].length)
      .split(/\s+/)
      .filter((t) => t !== '' && !keys.has((t.split('=')[0] ?? '').toLowerCase()))
    const all = kept.concat(wanted)
    lines[open] = prefix + (all.length > 0 ? `${m[1]}table ${all.join(' ')}` : `${m[1]}table`)
    return lines.join('\n')
  }

  if (wanted.length === 0) return null // 没围栏又没值 —— 没什么可改的
  lines.splice(line, 0, `${prefix}\`\`\`table ${wanted.join(' ')}`)
  lines.splice(to + 2, 0, `${prefix}\`\`\``)
  return lines.join('\n')
}

/**
 * 改**一个**选项(最常用的一档)。
 * 多个一起改(列宽 + 整表宽度)必须走 setTableOptionsInBody:没围栏时第一次调用会插入两行,
 * 行号就变了,第二次再按老行号去改会写错地方。
 */
export function setTableOptionInBody(
  body: string,
  table: { line: number; to: number; fenced: boolean },
  key: string,
  value: string | null
): string | null {
  return setTableOptionsInBody(body, table, [[key, value]])
}

/** 改整表宽度(最常用的一档,单独留个名字) */
export function setTableWidthInBody(
  body: string,
  table: { line: number; to: number; fenced: boolean },
  width: number | null
): string | null {
  return setTableOptionInBody(body, table, 'width', width === null ? null : String(clampTableWidth(width)))
}
