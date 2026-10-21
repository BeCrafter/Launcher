// 表格样式的两级配置:
//   · 全局默认 —— 设置页里的「表格样式」,套在整个预览区上;
//   · 单表覆盖 —— ```` ```table border=none color=#8b5cf6 ```` 包一层。
//
// 为什么单表要包围栏:GFM 的表格语法**没有属性位**,`| a | b |` 里塞不下任何东西。
// 代价是文件拿到别处会露出一段围栏文本 —— 所以它只是「覆盖」,默认那套仍然写在设置里,
// 一篇笔记里不写任何围栏也能有统一好看的表格。

export type TableBorder = 'none' | 'thin' | 'medium' | 'thick'

export const TABLE_BORDERS: readonly TableBorder[] = ['none', 'thin', 'medium', 'thick']

/** 边框档位 → 像素。0 表示不画(而不是 border: none,那样会连表头的底边一起没掉) */
export const TABLE_BORDER_PX: Record<TableBorder, number> = {
  none: 0,
  thin: 1,
  medium: 2,
  thick: 3
}

export interface TableOptions {
  /** null = 不覆盖,用全局默认 */
  border: TableBorder | null
  /** 边框色。null = 不覆盖。只收十六进制与简单的颜色关键字,别的一律忽略 */
  color: string | null
  /**
   * 表头底色。null = 不覆盖。
   *
   * 底色**不直接铺满格子**,而是按比例调进主题底色(见 notes.css) —— 用户随手挑的
   * 颜色不会把深/浅主题下的正文压得看不见。
   */
  head: string | null
  /** 正文单元格底色;和 head 同一条规则。null = 不覆盖 */
  fill: string | null
  /**
   * 表格宽度(px);null = 铺满一栏。
   * GFM 的表格语法里没有放尺寸的地方,所以它只能住在 ````table 围栏的选项里 ——
   * 这也是「拖动改宽」必须把表包进围栏的原因。
   */
  width: number | null
  /**
   * 每列宽度(px),下标对列;`null` 项 = 该列按内容自动。
   * 整个为 null = 不覆盖(现有笔记的行为一字不变)。
   *
   * 为什么按列存而不是按格:拖列边界时改的是**一整列**,而且列宽本来就该是
   * 「这一列多宽」而不是「这一格多宽」—— 按格存会在增删行时错位。
   */
  cols: (number | null)[] | null
  /** 每行的**最小**高度(px),下标对**所有行**(第 0 行是表头);同上 */
  rows: (number | null)[] | null
  /**
   * 排版表格:```` ```table layout ````。
   *
   * 它是一张**网格**而不是数据表 —— 所以不带边框,而且**第一行不再当表头**
   * (去掉底色/加粗/不换行那套)。左图右文这类版式要靠它:GFM 的表格必须有分隔行,
   * 内容只能写在第一行,而第一行默认是按表头渲染的,直接拿 border=none 排出来
   * 会得到「一行加粗不换行的表头」。
   */
  layout: boolean
}

/** 表格宽度区间:太窄列挤成一团,太宽一屏放不下 */
export const TABLE_WIDTH_MIN = 160
export const TABLE_WIDTH_MAX = 2400

export function clampTableWidth(n: number): number {
  if (Number.isNaN(n)) return TABLE_WIDTH_MIN
  return Math.min(TABLE_WIDTH_MAX, Math.max(TABLE_WIDTH_MIN, Math.round(n)))
}

/** 单列宽度区间。比整表宽得多 —— 一列 60px 放个图标是正当用法 */
export const TABLE_COL_MIN = 40
export const TABLE_COL_MAX = 2400

export function clampTableCol(n: number): number {
  if (Number.isNaN(n)) return TABLE_COL_MIN
  return Math.min(TABLE_COL_MAX, Math.max(TABLE_COL_MIN, Math.round(n)))
}

/** 行高区间。下限比列宽还低:一行只放一个角标也说得过去 */
export const TABLE_ROW_MIN = 24
export const TABLE_ROW_MAX = 1200

export function clampTableRow(n: number): number {
  if (Number.isNaN(n)) return TABLE_ROW_MIN
  return Math.min(TABLE_ROW_MAX, Math.max(TABLE_ROW_MIN, Math.round(n)))
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const NAME_RE = /^[a-z]{3,20}$/i

/**
 * `cols=220,auto,180` → `[220, null, 180]`。
 *
 * 认不出的项按「自动」处理而不是丢掉整串 —— 与 parseTableOptions 同一个态度:
 * 写错一个词不该把整张表变成错误提示。
 * 整串都是 auto 时返回 null(等于没覆盖),免得平白把表格切成固定布局。
 */
function parseSizeList(value: string, clamp: (n: number) => number): (number | null)[] | null {
  const out = value.split(',').map((part) => {
    const t = part.trim().toLowerCase()
    if (t === '' || t === 'auto') return null
    const n = Number(t)
    return Number.isFinite(n) && n > 0 ? clamp(n) : null
  })
  return out.some((n) => n !== null) ? out : null
}

/** 反向:`[220, null]` → `220,auto`(写回围栏选项时用,键由调用方拼) */
export function joinSizeList(list: readonly (number | null)[]): string {
  return list.map((n) => (n === null ? 'auto' : String(Math.round(n)))).join(',')
}

/**
 * 解析围栏信息串里语言名之后的部分:`border=none color=#8b5cf6`。
 *
 * 认不出的键与值**直接忽略**而不是报错 —— 它只是个样式覆盖,
 * 为写错一个词把整张表变成错误提示不值得。
 */
export function parseTableOptions(rest: string): TableOptions {
  const out: TableOptions = {
    border: null,
    color: null,
    head: null,
    fill: null,
    width: null,
    cols: null,
    rows: null,
    layout: false
  }
  for (const token of rest.trim().split(/\s+/)) {
    if (token === '') continue
    // 裸词:目前只有 layout 一个
    if (token.toLowerCase() === 'layout') {
      out.layout = true
      continue
    }
    const at = token.indexOf('=')
    if (at < 0) continue
    const key = token.slice(0, at).toLowerCase()
    const value = token.slice(at + 1)
    if (key === 'border') {
      const v = value.toLowerCase()
      if ((TABLE_BORDERS as readonly string[]).includes(v)) out.border = v as TableBorder
    } else if (key === 'color' || key === 'colour') {
      if (HEX_RE.test(value) || NAME_RE.test(value)) out.color = value
    } else if (key === 'head' || key === 'header') {
      if (HEX_RE.test(value) || NAME_RE.test(value)) out.head = value
    } else if (key === 'fill' || key === 'bg' || key === 'background') {
      if (HEX_RE.test(value) || NAME_RE.test(value)) out.fill = value
    } else if (key === 'width') {
      const n = Number(value)
      if (Number.isFinite(n) && n > 0) out.width = clampTableWidth(n)
    } else if (key === 'cols' || key === 'columns') {
      out.cols = parseSizeList(value, clampTableCol)
    } else if (key === 'rows') {
      out.rows = parseSizeList(value, clampTableRow)
    }
  }
  return out
}

/** 选项 → 内联 CSS 变量。空对象表示什么都不覆盖 */
export function tableCssVars(o: TableOptions): Record<string, string> {
  const vars: Record<string, string> = {}
  if (o.border !== null) vars['--md-table-bw'] = `${TABLE_BORDER_PX[o.border]}px`
  if (o.color !== null) vars['--md-table-bc'] = o.color
  if (o.head !== null) vars['--md-table-head-bg'] = o.head
  if (o.fill !== null) vars['--md-table-fill-bg'] = o.fill
  if (o.width !== null) vars['--md-table-w'] = `${o.width}px`
  return vars
}

/** 两个来源合并:单表覆盖优先,没写的落回全局 */
export function mergeTableOptions(base: TableOptions, over: TableOptions): TableOptions {
  return {
    border: over.border ?? base.border,
    color: over.color ?? base.color,
    head: over.head ?? base.head,
    fill: over.fill ?? base.fill,
    width: over.width ?? base.width,
    cols: over.cols ?? base.cols,
    rows: over.rows ?? base.rows,
    layout: over.layout || base.layout
  }
}
