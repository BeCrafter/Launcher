// 媒体尺寸的读写 —— 语法是 Obsidian 那一套:`![alt|宽](url)`。
//
// 为什么用 `|宽` 而不是 HTML 的 width 属性:渲染器**刻意不解析 HTML**(那是 XSS 的入口),
// 为了一行宽度把那条口子开出来不划算。`|宽` 是 Obsidian 原生认的写法,
// 拿到别处最坏也只是 alt 文本里多出一段 `|300`,图片照常显示。
//
// 三种形态:
//   `|300`     → 只定宽(高按比例)
//   `|300x200` → 宽高都定(会拉伸,是用户自己的选择)
//   `|x400`    → 只定高(PDF 这种宽度总是铺满的用这个)

export interface MediaSize {
  width: number | null
  height: number | null
}

/** 拖拽的下限与上限:太小点不中,太大一屏放不下 */
export const MEDIA_MIN = 40
export const MEDIA_MAX = 2400

/**
 * 网页嵌入的高度区间。**与图片不同** —— 图片 40px 还能看,嵌一个 40px 高的网页没意义。
 * 定义在这里而不是 markdown.tsx,是因为「解析时夹一次、拖拽写回时也夹一次」,
 * 两处必须是同一组数,否则会出现「拖到 40,渲染成 120」的错位。
 */
export const EMBED_HEIGHT_MIN = 120
export const EMBED_HEIGHT_MAX = 2000

export function clampEmbedHeight(n: number): number {
  if (Number.isNaN(n)) return EMBED_HEIGHT_MIN
  return Math.min(EMBED_HEIGHT_MAX, Math.max(EMBED_HEIGHT_MIN, Math.round(n)))
}

export function clampMediaSize(n: number): number {
  // NaN 必须单独拦:它会让 Math.min/max 一路传下去,最后写出 `NaNpx`
  if (Number.isNaN(n)) return MEDIA_MIN
  // ±Infinity 交给 min/max 自己夹,结果正是上下限
  return Math.min(MEDIA_MAX, Math.max(MEDIA_MIN, Math.round(n)))
}

/**
 * `封面|300` → `{ alt: '封面', width: 300, height: null }`
 * `|300x200` → `{ alt: '', width: 300, height: 200 }`
 * `封面`      → `{ alt: '封面', width: null, height: null }`
 *
 * 贪婪的 `.*` 让它匹配**最后一个** `|数字`,所以 alt 里本身带竖线也不会被截错。
 */
export function splitMediaSize(alt: string): { alt: string } & MediaSize {
  const m = /^(.*)\|(?:(\d+)(?:x(\d+))?|x(\d+))$/.exec(alt)
  if (m === null) return { alt, width: null, height: null }
  const width = m[2] !== undefined ? clampMediaSize(Number(m[2])) : null
  const height = (m[3] ?? m[4]) !== undefined ? clampMediaSize(Number(m[3] ?? m[4])) : null
  return { alt: m[1], width, height }
}

/** 反向:把尺寸拼回 alt。宽高都没有就是原样返回 */
export function joinMediaSize(alt: string, size: MediaSize): string {
  if (size.width !== null && size.height !== null) return `${alt}|${size.width}x${size.height}`
  if (size.width !== null) return `${alt}|${size.width}`
  if (size.height !== null) return `${alt}|x${size.height}`
  return alt
}

/**
 * 尺寸 → 内联样式。宽高都为 null 时返回 undefined(交给 CSS 的默认值)。
 *
 * ⚠ 显式定了宽就**必须同时解除 max-width**:预览里那条 `max-width: 100%` 会把图
 * 卡在栏宽上,于是「拖到 463 却被压回 343」—— 用户看到的是「拖了没反应」。
 * 定了宽的图允许超出栏宽(预览会横向滚动),这是用户自己要的尺寸。
 */
export function mediaStyle(size: MediaSize): { width?: string; height?: string; maxWidth?: string } | undefined {
  if (size.width === null && size.height === null) return undefined
  return {
    ...(size.width !== null ? { width: `${size.width}px`, maxWidth: 'none' } : {}),
    ...(size.height !== null ? { height: `${size.height}px` } : {})
  }
}

export interface MediaTarget {
  /** 源文里那一行的行号(0 起)—— 用来在多张同地址的图之间消歧 */
  line: number
  /** 括号里的原始地址,与源文逐字相同 */
  src: string
}

/** 把地址里的正则元字符转义 —— 它来自用户正文,不能直接拼进 RegExp */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 一行里匹配某个地址的 `![alt](src)`。`\s*` 容忍 `![]( x.png )` 这种写法 */
function imageRe(src: string): RegExp {
  return new RegExp(`!\\[([^\\]]*)\\]\\(\\s*${escapeRe(src)}\\s*\\)`, 'g')
}

/**
 * 在正文里找到那张图、改写它的尺寸,返回新的正文。
 *
 * 为什么按「地址 + 行号」找而不是记住字符偏移:偏移要一路穿过
 * 「块引用剥掉 `> ` 前缀」这种改写,算起来脆;而行号在提示块里也是准的
 * (正文数组与源文数组行数一一对应),地址又是逐字相同的。
 *
 * 找不到、或找到多个又对不上行号 → 返回 null(调用方提示,不猜)。
 */
export function setMediaSizeInBody(body: string, target: MediaTarget, size: MediaSize): string | null {
  const lines = body.split('\n')
  const re = imageRe(target.src)

  const hits: { line: number; from: number; to: number; alt: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(lines[i])) !== null) {
      hits.push({ line: i, from: m.index, to: m.index + m[0].length, alt: m[1] })
    }
  }
  if (hits.length === 0) return null

  // 优先取行号对得上的那一张;否则只有唯一一张时才敢下手
  const onLine = hits.filter((h) => h.line === target.line)
  const pick = onLine.length === 1 ? onLine[0] : hits.length === 1 ? hits[0] : null
  if (pick === null) return null

  /*
   * ⚠ 在**表格行**里,alt 里的竖线必须转义成 `\|`。
   * `|` 是列分隔符 —— 写出 `![|259](x.mp4)` 会把这一行拆成更多格,整张表当场崩掉,
   * 媒体自然也渲染不出来。踩过:把表格里那个视频拖宽之后,它变成一个打不开的空框。
   * (非表格行里不能转义:那样 alt 会原样显示出反斜杠。)
   */
  const inTableRow = /^\s*(?:>\s?)*\|/.test(lines[pick.line]!)
  const altText = joinMediaSize(splitMediaSize(pick.alt).alt, size)
  const alt = inTableRow ? altText.replace(/\\?\|/g, '\\|') : altText
  const next = `![${alt}](${target.src})`
  const line = lines[pick.line]
  lines[pick.line] = line.slice(0, pick.from) + next + line.slice(pick.to)
  return lines.join('\n')
}

/** 网页嵌入的围栏在源文里的行区间(含首尾两行围栏) */
export interface EmbedRange {
  from: number
  to: number
}

/**
 * 改写 ```` ```embed ```` 围栏的尺寸,返回新的正文。
 *
 * 与图片不同:嵌入的尺寸写在围栏**正文**的 `width:` / `height:` 行上,不是行内语法。
 * 已有的行就改它,没有就在末尾补一行 —— 两种写法都合法(见 parseEmbed)。
 * **两个轴各自独立**:某一个是 null 就保持原样(不写、也不删已有的那行)。
 * 区间对不上(比如用户同时在编辑器里删了行)就返回 null,不猜。
 */
export function setEmbedSizeInBody(body: string, range: EmbedRange, size: MediaSize): string | null {
  const lines = body.split('\n')
  const from = range.from
  const to = range.to
  if (from < 0 || to >= lines.length || to <= from) return null
  const prefix = linePrefix(lines[from]!)
  if (!/^\s*`{3,}|^\s*~{3,}/.test(lines[from]!.slice(prefix.length))) return null

  /** 改已有的那一行,没有就插到闭合围栏之前。**每一行都带前缀** */
  const put = (key: 'width' | 'height', value: number): void => {
    const text = `${key}: ${key === 'width' ? clampMediaSize(value) : clampEmbedHeight(value)}`
    const at = lines.findIndex(
      (l, i) => i > from && i < to && new RegExp(`^\\s*${key}\\s*:`, 'i').test(l.slice(linePrefix(l).length))
    )
    if (at >= 0) lines[at] = linePrefix(lines[at]!) + text
    else lines.splice(to, 0, prefix + text)
  }
  if (size.width !== null) put('width', size.width)
  if (size.height !== null) put('height', size.height)
  return lines.join('\n')
}

/**
 * 改围栏**信息串**里的 `width=`,返回新的正文。
 *
 * 为什么图表要用信息串而不是像 embed 那样写在正文行里:图表的正文是 **mermaid 源码**,
 * 往里塞一行 `width: 600` 会直接把那张图弄坏。信息串(\`\`\`mermaid width=600)不参与解析,
 * 是唯一安全的落点。语言名与其它选项原样保留。
 */
/**
 * 一行的**前缀**:缩进 + 引用标记(`> ` / `> > ` / `  > `)。
 *
 * 引用与提示块里的围栏行长这样:`> ```mermaid …`。改写这一行、或往这一层里插行时,
 * **前缀必须原样带着** —— 否则围栏会跑到引用外面去。
 * (表格那边已经踩过一次:每拖一次多插一层围栏,整篇渲染错乱。这里是同一件事。)
 */
export function linePrefix(line: string): string {
  return /^\s*(?:>\s?)*/.exec(line)?.[0] ?? ''
}

export function setFenceWidthInBody(body: string, openLine: number, width: number | null): string | null {
  const lines = body.split('\n')
  if (openLine < 0 || openLine >= lines.length) return null
  const prefix = linePrefix(lines[openLine]!)
  const m = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(lines[openLine]!.slice(prefix.length))
  if (m === null) return null

  const words = m[3].trim().split(/\s+/).filter((w) => w !== '')
  const lang = words.shift() ?? ''
  const kept = words.filter((w) => !/^width=/i.test(w))
  if (width !== null) kept.push(`width=${clampMediaSize(width)}`)
  lines[openLine] = prefix + `${m[1]}${m[2]}${lang}${kept.length > 0 ? ' ' + kept.join(' ') : ''}`
  return lines.join('\n')
}
