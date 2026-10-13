// 最小安全 Markdown 渲染(真实 LLM 正文普遍带 md,
// 纯文本渲染会把代码块/列表退化成原文)
//
// 安全策略:产 React 节点、**绝不用 dangerouslySetInnerHTML**——React 默认把字符串当文本转义,
// 因此输入里的 HTML 天然 inert;不需要也不允许「先转义再拼 HTML」的那条路。
// 支持面刻意收窄:围栏代码块 / 行内代码 / 粗体 / 标题 #~#### / 无序有序列表 / 引用块 / 链接 / 表格 / 分隔线;
// 其余一律按纯文本段落透出。链接统一走 openExternal(main 侧 https? 白名单),不渲染裸 URL。
//
// `anchors` 选项:开启后标题带 GitHub 风格 id、`#foo` 链接改为应用内滚动 —— 帮助页(内嵌
// 仓库里的 docs/help.md / docs/install.md)需要它;AI 消息渲染不开,保持原行为。
//
// `extended` 选项(笔记预览用):在基础语法之上加 斜体/粗斜体/删除线/任务清单/嵌套列表/
// #####-###### / 角括号 autolink / 表格列对齐 / 反斜杠转义,标题补 role="heading"。
// **基础模式与扩展模式是两份独立实现**:renderMarkdownBasic 一个字都没动,扩展模式走
// renderMarkdownExtended。这样「帮助页与 AI 消息渲染不变」是结构性的,而不是靠测试兜住的
// (markdown.test.tsx 里那条逐字节相等的回归用例是第二道保险)。
//
// 扩展模式仍然不渲染裸 URL、不认 HTML 块。
//
// 两件「本来以为做不到」的事,靠**回调**做成了,而这份文件一点依赖都没多:
//   · 代码高亮:highlightCode() 的回调版给我们 (文本, class) 对,由调用方产 React 节点。
//     常见用法是拿 HTML 字符串,那就必须 dangerouslySetInnerHTML —— 这条路被绕开了。
//   · 图表:```mermaid 交给调用方注入的 renderDiagram。这份文件不知道 mermaid 的存在,
//     而 mermaid 那唯一一处注入被关在 lib/mermaid-render.ts 里。

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { noteAssetKindOfUrl } from '@shared/notes'
import {
  clampEmbedHeight,
  clampMediaSize,
  setFenceWidthInBody,
  mediaStyle,
  splitMediaSize,
  type EmbedRange,
  type MediaSize,
  type MediaTarget
} from './note-media-size'
import { openExternal } from './utils'
import {
  clampTableCol,
  clampTableRow,
  clampTableWidth,
  joinSizeList,
  parseTableOptions,
  tableCssVars
} from '@shared/note-table-style'
import {
  addTableColumn,
  addTableRow,
  cellFromEditText,
  cellToEditText,
  colCount,
  setTableOptionInBody,
  setTableOptionsInBody,
  setTableWidthInBody,
  parseTableBlock,
  removeTableColumn,
  removeTableRow,
  setTableCell,
  type TableBlock
} from './note-table-edit'

/** 行内片段:纯文本 / 行内代码 / 粗体(可嵌套行内代码) / 链接 */
type Inline = string | { code: string } | { bold: Inline[] } | { linkText: string; url: string }

const INLINE_RE = /(\*\*([\s\S]+?)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/g

/** 行内解析:命中粗体时对其内容递归(允许 **..`code`..** 嵌套);未命中部分原样为文本 */
function parseInline(src: string, noBold = false): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of src.matchAll(INLINE_RE)) {
    if (m.index > last) out.push(src.slice(last, m.index))
    if (!noBold && m[1] !== undefined) out.push({ bold: parseInline(m[2], true) })
    else if (m[3] !== undefined) out.push({ code: m[4] })
    else if (m[5] !== undefined) out.push({ linkText: m[6], url: m[7] })
    else out.push(m[0])
    last = m.index + m[0].length
  }
  if (last < src.length) out.push(src.slice(last))
  return out
}

function renderInline(parts: Inline[], keyBase: string, anchors = false): ReactNode[] {
  return parts.map((p, i) => {
    const key = `${keyBase}-${i}`
    if (typeof p === 'string') return p
    if ('code' in p)
      return (
        <code className="md-code-inline" key={key}>
          {p.code}
        </code>
      )
    if ('bold' in p)
      return (
        <strong key={key}>{renderInline(p.bold, key, anchors)}</strong>
      )
    // 应用内锚点(帮助页正文里的 `§10` 这类交叉引用):滚动到同文档内的标题,不走外链
    if (anchors && p.url.startsWith('#')) {
      return (
        <a
          key={key}
          className="md-link md-anchor"
          href={p.url}
          onClick={(e) => {
            e.preventDefault()
            // ⚠️ 必须 instant:本环境(Electron 44)程序化平滑滚动不工作(见 HelpModal 的说明)。
            // 落点余量由 CSS 的 `scroll-margin-top` 给,不在这里减偏移。
            document
              .getElementById(p.url.slice(1))
              ?.scrollIntoView({ behavior: 'instant', block: 'start' })
          }}
        >
          {p.linkText}
        </a>
      )
    }
    return (
      <a
        key={key}
        className="md-link"
        href={p.url}
        onClick={(e) => {
          e.preventDefault()
          openExternal(p.url)
        }}
      >
        {p.linkText}
        <i className="fa-solid fa-arrow-up-right-from-square md-link-icon" />
      </a>
    )
  })
}

/**
 * 围栏开启行。**必须捕获反引号的个数** —— CommonMark 的规则是「闭合围栏的反引号
 * 不少于开启围栏」,所以 ````markdown 里面可以正常放 ``` 而不被提前截断。
 * 之前固定按三个反引号配对,导致文档里「四反引号包一段带围栏的示例」这种写法全渲染错了。
 */
const FENCE_RE = /^(`{3,})(\w*)/
const HEAD_RE = /^(#{1,4})\s+(.*)$/
const UL_RE = /^[-*]\s+(.*)$/
const OL_RE = /^\d+[.)]\s+(.*)$/
/** 分隔线:三个以上 - / * / _(独占一行,允许前后空白) */
const HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/

/**
 * GitHub 风格的标题锚点。
 * 与帮助文档里手写的目录链接(如 `#1-四个页面各管什么`)对齐:小写 → 去标点 → 空格转连字符。
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

/** 抽取 `##` 标题(帮助页左栏目录用;不解析标题里的行内标记) */
export function extractHeadings(src: string): { text: string; id: string }[] {
  return src
    .split('\n')
    .filter((l) => /^##\s+/.test(l))
    .map((l) => {
      const text = l.replace(/^##\s+/, '').trim()
      return { text, id: slugifyHeading(text) }
    })
}

export interface MarkdownOptions {
  anchors?: boolean
  extended?: boolean
  /**
   * 图片地址解析:返回 null 表示**不**渲染(降级为 chip)。
   * 放不放行 http(s) 由调用方决定 —— 笔记预览放行(远程图片直接显示),
   * 帮助页 / AI 消息不传这个回调,于是一律降级。
   */
  resolveImage?: (src: string) => string | null
  /** 任务项勾选回调;不传则复选框只读。参数是**该行在 src 里的下标** */
  onToggleTask?: (line: number, next: boolean) => void
  /**
   * 图表的渲染入口(```mermaid)。不传 = 按普通代码块渲染。
   *
   * 为什么是回调而不是在这里直接 import MermaidBlock:markdown.tsx 的定位是
   * 「零依赖、产 React 节点、绝不注入」,而 mermaid 三样都占。让调用方注入渲染器,
   * 这份文件就仍然不知道 mermaid 的存在。
   */
  renderDiagram?: (block: DiagramBlock) => ReactNode
  /**
   * 给块级元素标上它在源文里的起始行(`data-line`)。
   * 滚动同步靠它把「预览里的第几块」映射回「编辑器里的第几行」。
   * 只影响扩展模式 —— 基础模式的 DOM 仍与改动前逐字节相同。
   */
  lineAnchors?: boolean
  /**
   * 围栏代码块的高亮。不传 = 纯文本。
   *
   * 做成回调是为了让这份文件**不依赖任何语法包** —— 它被帮助页与 AI 消息共用,
   * 不该为了笔记里的代码块把几十个语法一起拖进主包。实现见 lib/code-highlight.tsx。
   */
  highlight?: (code: string, lang: string, key: string) => ReactNode
  /**
   * 提示块(```> [!WARNING]```)没有自定义标题时显示的名字。
   * 不传就用类型名本身(Note / Tip / …)—— 这份文件不引 i18n,调用方给。
   */
  calloutLabel?: (kind: CalloutKind) => string
  /**
   * 网页嵌入(```` ```embed ````)的地址解析:返回 null 表示**不**渲染 iframe(退回代码块)。
   * 与 `resolveImage` 是同一个放行规则(笔记页两处都传 `resolvePreviewSrc`)。
   */
  resolveEmbed?: (url: string) => string | null
  /**
   * 拖拽改完尺寸后回写源文。不传 = 媒体只读、不出角柄(帮助页 / AI 消息就是只读的)。
   * `target` 带着源文行号与原始地址,调用方据此在正文里定位那一张。
   */
  onResizeMedia?: (target: MediaTarget, size: MediaSize) => void
  /** 网页嵌入的高度回写(改围栏里的 height: 行);不传则嵌入不可缩放 */
  onResizeEmbed?: (range: EmbedRange, size: MediaSize) => void
  /** 代码块复制按钮的提示文案。不传用英文兜底 —— 这份文件不引 i18n */
  copyCodeLabel?: string
  /**
   * 预览里改表格:回调收到**整篇新正文**,调用方负责写回 store。
   * 不传 = 表格只读(帮助页 / AI 消息就是只读的)。
   */
  onEditTable?: (body: string) => void
  /** 表格编辑的界面文案;不传用英文兜底 */
  tableLabels?: TableLabels
}

/** 表格编辑用到的文案。这份文件不引 i18n,由调用方给 */
export interface TableLabels {
  addRow: string
  addColumn: string
  delRow: string
  delColumn: string
  /** 单元格的悬停提示:告诉用户怎么改 */
  editHint: string
  /** 列边界 / 行边界拖拽手柄的无障碍名 */
  resizeColumn: string
  resizeRow: string
}

/** 提示块(GitHub / Obsidian callout)的五个类型 */
export type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution'

export const CALLOUT_KINDS: readonly CalloutKind[] = ['note', 'tip', 'important', 'warning', 'caution']

/** `[!WARNING] 可选的自定义标题` —— 必须是块引用正文的第一行 */
const CALLOUT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i

/** 从一行文本里认出提示块标记;不是就返回 null */
export function parseCallout(line: string): { kind: CalloutKind; title: string } | null {
  const m = CALLOUT_RE.exec(line.trim())
  if (!m) return null
  const kind = m[1].toLowerCase() as CalloutKind
  return (CALLOUT_KINDS as readonly string[]).includes(kind) ? { kind, title: m[2].trim() } : null
}

/** 一个 ```mermaid 围栏在源文里的位置与内容 */
export interface DiagramBlock {
  lang: string
  code: string
  /** 起始围栏行在 src 里的下标(0 起) */
  from: number
  /** 结束围栏行的下标;未闭合时为最后一行 */
  to: number
  key: string
  /** 显式宽度(px);null = 按图自身大小、不超过栏宽。来自围栏信息串的 `width=` */
  width: number | null
  /**
   * 能不能「重新编辑」。表格单元格里的图**只读** —— 单元格在源文里只是一行,
   * 里面的围栏没有自己的行号,按 from/to 回写会把整条表格行写坏。
   */
  editable: boolean
}

/**
 * 块级解析入口。`extended` 未开时走 renderMarkdownBasic ——
 * 帮助页与 AI 消息的输出与本次改动之前逐字节相同(两份独立实现,不是同一份里加分支)。
 */
export function renderMarkdown(
  src: string,
  keyPrefix = 'md',
  opts: MarkdownOptions = {}
): ReactNode[] {
  return opts.extended === true
    ? renderMarkdownExtended(src, keyPrefix, opts)
    : renderMarkdownBasic(src, keyPrefix, opts)
}

/** 基础模式:行扫描;未识别的连续行合为一段(段内保留换行,交由 pre-wrap 展示) */
function renderMarkdownBasic(src: string, keyPrefix: string, opts: MarkdownOptions): ReactNode[] {
  const anchors = opts.anchors === true
  const lines = src.split('\n')
  const out: ReactNode[] = []
  let i = 0
  let k = 0
  const key = (): string => `${keyPrefix}-${k++}`

  while (i < lines.length) {
    const line = lines[i]

    // 围栏代码块:未闭合则吃到结尾(不静默丢弃后半段)
    const fence = line.match(FENCE_RE)
    if (fence) {
      // 闭合围栏的反引号**不少于**开启的个数(CommonMark):``` 里的 ```` 不算闭合
      const closeRe = new RegExp('^`{' + fence[1].length + ',}\\s*$')
      const body: string[] = []
      i++
      while (i < lines.length && !closeRe.test(lines[i])) body.push(lines[i++])
      if (i < lines.length) i++ // 跳过闭合行
      out.push(
        <pre className="md-code" key={key()}>
          <code>{body.join('\n')}</code>
        </pre>
      )
      continue
    }

    // 分隔线(必须在表格判断之前:`---` 单独一行是 hr,不是表格分隔行)
    if (HR_RE.test(line)) {
      out.push(<hr className="md-hr" key={key()} />)
      i++
      continue
    }

    const head = line.match(HEAD_RE)
    if (head) {
      const level = head[1].length
      const id = anchors ? slugifyHeading(head[2]) : undefined
      out.push(
        <div className={`md-h md-h${level}`} id={id} key={key()}>
          {renderInline(parseInline(head[2]), key(), anchors)}
        </div>
      )
      i++
      continue
    }

    if (UL_RE.test(line)) {
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(UL_RE)
        if (!m) break
        items.push(m[1])
        i++
      }
      out.push(
        <ul className="md-list" key={key()}>
          {items.map((it, n) => (
            <li key={n}>{renderInline(parseInline(it), `${keyPrefix}-ul${k}-${n}`, anchors)}</li>
          ))}
        </ul>
      )
      continue
    }

    if (OL_RE.test(line)) {
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(OL_RE)
        if (!m) break
        items.push(m[1])
        i++
      }
      out.push(
        <ol className="md-list" key={key()}>
          {items.map((it, n) => (
            <li key={n}>{renderInline(parseInline(it), `${keyPrefix}-ol${k}-${n}`, anchors)}</li>
          ))}
        </ol>
      )
      continue
    }

    if (/^>\s?/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      // 正文按块再渲染一遍(与扩展模式同一套行为):引用里也能放列表、代码块、嵌套引用。
      // 从前是整段当行内文本 + pre-wrap,那些块级写法会原样露出源码。
      const k0 = key()
      out.push(
        <blockquote className="md-quote" key={k0}>
          {renderMarkdownBasic(body.join('\n'), k0, opts)}
        </blockquote>
      )
      continue
    }

    if (line.trim() === '') {
      i++
      continue
    }

    // 表格(GFM):形如 `| a | b |` + `|---|---|`。只支持带表头的简单表格 ——
    // 模型在「概览/对比」类回答里很自然地用表格,不认它就会退化成一堆竖线
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i])) rows.push(splitRow(lines[i++]))
      out.push(
        <div className="md-table-wrap" key={key()}>
          <table className="md-table">
            <thead>
              <tr>
                {header.map((h, n) => (
                  <th key={n}>{renderInline(parseInline(h), `${keyPrefix}-th${n}`, anchors)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, rn) => (
                <tr key={rn}>
                  {r.map((c, cn) => (
                    <td key={cn}>{renderInline(parseInline(c), `${keyPrefix}-td${rn}-${cn}`, anchors)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // 普通段落:吃到空行或下一个块级结构为止
    const para: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i], lines[i + 1])) para.push(lines[i++])
    out.push(
      <p className="md-p" key={key()}>
        {renderInline(parseInline(para.join('\n')), key(), anchors)}
      </p>
    )
  }
  return out
}

function isBlockStart(line: string, next?: string): boolean {
  return (
    FENCE_RE.test(line) ||
    HR_RE.test(line) ||
    HEAD_RE.test(line) ||
    UL_RE.test(line) ||
    OL_RE.test(line) ||
    /^>\s?/.test(line) ||
    // 表格要连着看下一行:单独一行 `| a | b |` 只是普通文本,配上分隔行才是表格
    (isTableRow(line) && next !== undefined && isTableSep(next))
  )
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line)
}
function isTableSep(line: string): boolean {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes('-')
}
function splitRow(line: string): string[] {
  return (
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      // 单元格里的字面竖线写作 `\|`(如 `curl ... \| bash`)—— 不能当分隔符,
      // 否则该行从那里裂开、后面所有列错位(install.md 的表头行就是这种)
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, '|'))
  )
}

// ════════════════════════ 扩展模式(笔记预览)════════════════════════
//
// 与基础模式是两份独立实现 —— 基础模式的代码路径一个字都没动。

interface ExtCtx {
  anchors: boolean
  resolveImage?: (src: string) => string | null
  onToggleTask?: (line: number, next: boolean) => void
  renderDiagram?: (block: DiagramBlock) => ReactNode
  highlight?: (code: string, lang: string, key: string) => ReactNode
  calloutLabel?: (kind: CalloutKind) => string
  resolveEmbed?: (url: string) => string | null
  /**
   * 预览里拖拽改完尺寸后回写源文。不传 = 媒体不可拖拽(帮助页/AI 消息就是只读的)。
   * 参数里的 `target` 带着源文行号与原始地址,调用方据此定位。
   */
  onResizeMedia?: (target: MediaTarget, size: MediaSize) => void
  /** 网页嵌入的高度回写(改围栏里的 height: 行);不传则嵌入不可拖拽 */
  onResizeEmbed?: (range: EmbedRange, size: MediaSize) => void
  /** 代码块复制按钮的提示文案。不传就用英文兜底(这份文件不引 i18n) */
  copyCodeLabel?: string
  /** 整篇正文 —— 表格编辑要按行号在**完整正文**里定位 */
  body?: string
  onEditTable?: (body: string) => void
  tableLabels?: TableLabels
  lineAnchors: boolean
  /**
   * 这些行全都来自**同一行源文**(表格单元格用 `<br>` 分隔出来的那些)。
   * 见 srcLine()。
   */
  flatLine?: number
}

/** 提示块默认标题的兜底(GitHub 的写法:首字母大写) */
function defaultCalloutLabel(kind: CalloutKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

/** 提示块图标 —— 与 CSS 里的配色一一对应(块菜单的样式变体也用它) */
export const CALLOUT_ICON: Record<CalloutKind, string> = {
  note: 'fa-circle-info',
  tip: 'fa-lightbulb',
  important: 'fa-circle-exclamation',
  warning: 'fa-triangle-exclamation',
  caution: 'fa-fire'
}

/**
 * 源文行号。
 *
 * 表格单元格里的块**全都来自同一行**(一行源文用 `<br>` 分隔成几行迷你文档),
 * 所以那里把行号压平:不压的话格子里第二块的行号会落到**下一条表格行**上 ——
 * 联动滚动会跳错地方,任务勾选更会去改别人的行。
 */
function srcLine(ctx: ExtCtx, n: number): number {
  return ctx.flatLine ?? n
}

/** 块级元素的源行锚点。`lineAnchors` 关掉时返回 undefined —— DOM 里就不该出现这个属性 */
function anchor(ctx: ExtCtx, line: number): number | undefined {
  return ctx.lineAnchors ? srcLine(ctx, line) : undefined
}

/** 围栏信息串 → 语言名。`{.js}` 这种 Pandoc 写法也认;取不到就是空串 */
function fenceLang(info: string): string {
  const first = info.trim().split(/\s+/)[0] ?? ''
  return first
    .replace(/^\{\.?/, '')
    .replace(/\}$/, '')
    .toLowerCase()
}

/**
 * 围栏信息串里**去掉语言名**之后剩下的部分。
 * ```` ```embed https://x ```` 的 info 是 `embed https://x` —— 直接把 info 交给
 * parseEmbed 会把 `embed` 自己当成地址(第一次就是这么错的)。
 */
function fenceRest(info: string): string {
  const trimmed = info.trim()
  const sp = trimmed.search(/\s/)
  return sp < 0 ? '' : trimmed.slice(sp + 1).trim()
}

/** 网页嵌入的配置 */
export interface EmbedSpec {
  url: string
  /** 像素宽;没写就是 null(默认铺满一栏) */
  width: number | null
  /** 像素高;没写就是 null(由 CSS 给默认值) */
  height: number | null
}

/**
 * 解析 ```` ```embed ```` 的内容。地址可以写在信息串上,也可以写在正文第一行 ——
 * 两种都认,因为「在围栏后面直接跟地址」和「换行写」都有人写。
 *
 * ```
 * ```embed https://example.com
 * ```
 * ```embed
 * https://example.com
 * height: 420
 * ```
 */
export function parseEmbed(info: string, body: string[]): EmbedSpec | null {
  let url = ''
  let width: number | null = null
  let height: number | null = null
  for (const raw of [info, ...body]) {
    const line = raw.trim()
    if (line === '') continue
    const h = /^height\s*:\s*(\d+)\s*$/i.exec(line)
    if (h) {
      height = clampEmbedHeight(Number(h[1]))
      continue
    }
    const w = /^width\s*:\s*(\d+)\s*$/i.exec(line)
    if (w) {
      width = clampMediaSize(Number(w[1]))
      continue
    }
    if (url === '') url = line
  }
  return url === '' ? null : { url, width, height }
}

type InlineExt =
  | string
  | { code: string }
  | { bold: InlineExt[] }
  | { boldItalic: InlineExt[] }
  | { italic: InlineExt[] }
  | { strike: InlineExt[] }
  | { sub: InlineExt[] }
  | { sup: InlineExt[] }
  | { linkText: string; url: string }
  /** `line` = 它在源文里的行号,拖拽改尺寸时按它定位 */
  | { alt: string; url: string; line: number }

/**
 * 行内正则(带 u 标志,`\p{L}` 才生效)。顺序即优先级:
 * 转义 → 粗斜体 → 粗体 → 斜体 → 删除线 → 行内代码 → 图片 → 链接 → 角括号 autolink。
 *
 * 两处边界是刻意的,不是随手加的:
 *   · `*斜体*` 开界符后不能是空白、闭界符前不能是空白 —— 否则 `2 * 3 * 4` 会被吃掉;
 *   · `_斜体_` 两侧不能是字母/数字 —— 否则 `foo_bar_baz` 会断成三截。
 *
 * 图片与链接的地址用 `[^)\n]+?` 而不是 `[^)\s]+?`:后者**不允许空格**,
 * 而本应用自己粘贴图片时写的名字就是 `assets/Pasted image 20261009150211.png` ——
 * 于是每一张粘进去的图都匹配不上,整行退化成字面文本。空格在 CommonMark 里确实要写成
 * `%20` 或 `<>`,但 Obsidian 认这种写法,而我们要读的是**用户已有的文件**。
 * 见 markdown-extended.test.tsx 的「地址带空格的图片」。
 */
const INLINE_EXT_RE =
  /(?<esc>\\(?<escChar>[\\`*_~[\]()!#>+\-.|]))|(?<bi>\*\*\*(?!\s)(?<biText>[\s\S]+?)(?<!\s)\*\*\*)|(?<b>\*\*(?!\s)(?<bText>[\s\S]+?)(?<!\s)\*\*)|(?<i>\*(?!\s)(?<iText>[^*\n]+?)(?<!\s)\*)|(?<bi2>___(?!\s)(?<bi2Text>[\s\S]+?)(?<!\s)___)|(?<b2>__(?!\s)(?<b2Text>[\s\S]+?)(?<!\s)__)|(?<i2>(?<![\p{L}\p{N}])_(?!\s)(?<i2Text>[^_\n]+?)(?<!\s)_(?![\p{L}\p{N}]))|(?<s>~~(?!\s)(?<sText>[\s\S]+?)(?<!\s)~~)|(?<sub>~(?!\s)(?<subText>[^~\n]+?)(?<!\s)~)|(?<sup>\^(?!\s)(?<supText>[^^\n]+?)(?<!\s)\^)|(?<c>`(?<cText>[^`]+)`)|(?<img>!\[(?<imgAlt>[^\]]*)\]\((?<imgUrl>[^)\n]+?)\))|(?<l>\[(?<lText>[^\]]+)\]\((?<lUrl>[^)\n]+?)\))|(?<auto><(?<autoUrl>https?:\/\/[^>\s]+)>)/gu

/** 嵌套深度上限:病态输入(几千个 `*`)不该把渲染栈打穿 */
const MAX_INLINE_DEPTH = 8

/** `src.slice(0, at)` 里有几个换行 —— 用来把行内节点的字符偏移换算成行号 */
function newlinesBefore(src: string, at: number): number {
  let n = 0
  const end = Math.min(at, src.length)
  for (let i = 0; i < end; i++) if (src.charCodeAt(i) === 10) n++
  return n
}

/**
 * 行内解析。
 *
 * `lineBase` 是这个字符串**第一行**在原文档里的行号 —— 图片要带上自己的行号,
 * 预览里拖拽改尺寸时才能精确定位到源文里的那一张(同一地址出现多次时不至于改错)。
 * 嵌套(粗体里的图片)会把行号往下推:内容起点之前有几个换行就算几行。
 */
function parseInlineExt(src: string, depth = 0, lineBase = 0): InlineExt[] {
  if (depth > MAX_INLINE_DEPTH) return [src]
  const out: InlineExt[] = []
  let last = 0
  /** 某个分组的内容起点相对本串的行号偏移 */
  const innerBase = (m: RegExpExecArray, skip: number): number => lineBase + newlinesBefore(src, m.index + skip)
  for (const m of src.matchAll(INLINE_EXT_RE)) {
    if (m.index === undefined) continue
    if (m.index > last) out.push(src.slice(last, m.index))
    const g = m.groups ?? {}
    if (g.esc !== undefined) out.push(g.escChar ?? '')
    else if (g.bi !== undefined) out.push({ boldItalic: parseInlineExt(g.biText ?? '', depth + 1, innerBase(m, 3)) })
    else if (g.b !== undefined) out.push({ bold: parseInlineExt(g.bText ?? '', depth + 1, innerBase(m, 2)) })
    else if (g.i !== undefined) out.push({ italic: parseInlineExt(g.iText ?? '', depth + 1, innerBase(m, 1)) })
    else if (g.bi2 !== undefined) out.push({ boldItalic: parseInlineExt(g.bi2Text ?? '', depth + 1, innerBase(m, 3)) })
    else if (g.b2 !== undefined) out.push({ bold: parseInlineExt(g.b2Text ?? '', depth + 1, innerBase(m, 2)) })
    else if (g.i2 !== undefined) out.push({ italic: parseInlineExt(g.i2Text ?? '', depth + 1, innerBase(m, 1)) })
    else if (g.s !== undefined) out.push({ strike: parseInlineExt(g.sText ?? '', depth + 1, innerBase(m, 2)) })
    else if (g.sub !== undefined) out.push({ sub: parseInlineExt(g.subText ?? '', depth + 1, innerBase(m, 1)) })
    else if (g.sup !== undefined) out.push({ sup: parseInlineExt(g.supText ?? '', depth + 1, innerBase(m, 1)) })
    else if (g.c !== undefined) out.push({ code: g.cText ?? '' })
    else if (g.img !== undefined)
      out.push({ alt: g.imgAlt ?? '', url: (g.imgUrl ?? '').trim(), line: lineBase + newlinesBefore(src, m.index) })
    else if (g.l !== undefined) out.push({ linkText: g.lText ?? '', url: (g.lUrl ?? '').trim() })
    else if (g.auto !== undefined) out.push({ linkText: g.autoUrl ?? '', url: g.autoUrl ?? '' })
    else out.push(m[0])
    last = m.index + m[0].length
  }
  if (last < src.length) out.push(src.slice(last))
  return out
}

/**
 * `![](…)` 的地址后缀决定它到底是什么。
 *
 * 为什么不给视频/音频另发明一套语法:Obsidian、Typora 都是这么写的,
 * 用户从别处搬过来的笔记直接就能用。图片是默认,其余按后缀分流。
 *
 * 类型表本身在 `@shared/notes`(协议白名单与渲染分流**必须是同一张表**,
 * 否则会出现「协议放行了但渲染层当成图片」这种打不开的黑框)。
 */
function mediaKindOf(url: string): 'video' | 'audio' | 'pdf' | null {
  const kind = noteAssetKindOfUrl(url)
  return kind === 'video' || kind === 'audio' || kind === 'pdf' ? kind : null
}

/** 降级形态:一个可点的标签。外链给「在浏览器打开」,本地路径不给 */
function imgChip(url: string, alt: string, key: string | undefined, withTitle: boolean): ReactNode {
  const external = /^https?:\/\//i.test(url)
  const label = alt.trim() !== '' ? alt : url
  const inner = (
    <>
      <i className="fa-regular fa-image" />
      <span className="md-img-chip-alt">{label}</span>
      {external && <i className="fa-solid fa-arrow-up-right-from-square md-link-icon" />}
    </>
  )
  return external ? (
    <a
      className="md-img-chip md-link"
      key={key}
      href={url}
      title={withTitle ? url : undefined}
      onClick={(e) => {
        e.preventDefault()
        openExternal(url)
      }}
    >
      {inner}
    </a>
  ) : (
    <span className="md-img-chip" key={key}>
      {inner}
    </span>
  )
}

/**
 * 图片元素。
 *
 * 两个细节值得说明:
 *   · `referrerPolicy="no-referrer"` —— 远程图会真的发请求(放不放行由调用方决定),
 *     但至少不把「你从哪篇笔记点过来的」一起送出去。
 *   · **加载失败时降级成 chip**。盗链防护(B 站、知乎、微博的图床都拦)与 404 都很常见,
 *     留一个浏览器默认的碎图标,不如留一个点开就能看的标签。
 */
function MdImage({ src, alt, url, style }: { src: string; alt: string; url: string; style?: CSSProperties }): ReactNode {
  const [broken, setBroken] = useState(false)
  if (broken) return imgChip(url, alt, undefined, true)
  return (
    <img
      className="md-img"
      src={src}
      alt={alt}
      style={style}
      // ⚠ 这里**不能**加 loading="lazy":在本应用里它会让图片永远不加载
      //   (懒加载的交叉观察对「尚未加载、因而高度为 0」的图片不触发,
      //   于是高度保持 0 —— 自己把自己锁死)。实测连直接挂在 document.body 上的
      //   懒加载图都不加载,loading="auto" 就正常。详见 CLAUDE.md。
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  )
}

/** 拖拽手柄拖出来的尺寸。`null` = 没在拖,用源文里写着的那个 */
interface DragState {
  width: number | null
  height: number | null
}

/**
 * 可选中、可拖拽缩放的媒体盒子。
 *
 * 交互分两步:先点一下选中(出描边与角柄),再拖角柄改尺寸;松手才写回源文。
 * 不做「悬停即出角柄」—— 预览是给人读的,鼠标扫过去就冒出一堆控件很吵。
 *
 * 拖拽中只改本地尺寸(实时预览),**不动源文**:每一帧都去改文档会把撤销栈冲垮,
 * 也会让自动保存疯狂触发。松手时一次写入。
 *
 * `onResize` 只收尺寸、不收目标 —— 目标(哪张图 / 哪段围栏)由调用方闭包带上,
 * 因为图片与网页嵌入的「写回」走的是两条完全不同的路(行内语法 vs 围栏配置)。
 */
function MediaBox({
  kind,
  size,
  onResize,
  children
}: {
  kind: 'image' | 'video' | 'audio' | 'pdf' | 'embed'
  size: MediaSize
  onResize?: (size: MediaSize) => void
  children: (style: CSSProperties | undefined) => ReactNode
}): ReactNode {
  const [drag, setDrag] = useState<DragState | null>(null)
  const boxRef = useRef<HTMLSpanElement | null>(null)
  /**
   * 拖拽期间挂在 window 上的监听器的拆除函数。
   *
   * ⚠ 必须在卸载时拆掉。不拆的话:一次没正常结束的拖拽(指针在窗口外松开、
   * 或者拖到一半切走笔记导致这个盒子被卸载)会把监听留在 window 上,
   * 之后**任意一次** pointermove + pointerup 都会触发 onUp,
   * 把当时量到的尺寸写进**当前打开的那篇笔记**里 —— 一篇没碰过的笔记凭空多出尺寸。
   */
  const dragCleanup = useRef<(() => void) | null>(null)
  /**
   * 拖拽中的尺寸,放在 ref 里与 state 并行。
   *
   * ⚠ 不能只在 onUp 里用 `setDrag((d) => { …onResize… })` 取那个值 ——
   * **updater 必须是纯函数**:React(StrictMode 下尤其)会重复调用它,
   * 副作用跟着执行两次,于是一次拖拽提交两遍(实测写回了**两行** `width:`)。
   */
  const dragValue = useRef<DragState | null>(null)
  const effective = drag ?? size
  const resizable = onResize !== undefined
  /**
   * **五种媒体统一用悬停**,没有「点一下选中」这个状态了。
   *
   * 为什么去掉:一是两套交互不一致(图片要点、PDF 要悬停);二是「点一下」本来就
   * 对 iframe 类无效(点击落进 iframe 自己的文档,传不到盒子上),对音频也不可靠
   * (点击落在原生播放器控件上)—— 于是那两个的角柄从来没露过面。
   *
   * 悬停之所以能成立:角柄虽然画在盒子边框之外,但它仍是盒子的**后代**,
   * 指针移到它上面时盒子依然算 `:hover` —— 不会「一离开就消失、抓不到」。
   */
  const resizableKind = resizable

  useEffect(
    () => () => {
      dragCleanup.current?.()
      dragCleanup.current = null
    },
    []
  )

  const startDrag = (e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const box = boxRef.current?.getBoundingClientRect()
    if (box === undefined) return
    const startX = e.clientX
    const startY = e.clientY
    const startW = box.width
    const startH = box.height

    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      // 死区:斜着拖的时候手总会带出几像素的横向位移,不设死区会把宽度也改成
      // 一个用户没想要的数(还会让「只想改高」变成两个轴都写进源文)
      const moved = (d: number): boolean => Math.abs(d) > 3

      let next: DragState
      if (kind === 'pdf' || kind === 'embed') {
        // PDF 与网页嵌入:**两个轴都能拖**。它们是「盒子」,没有固有宽高比,
        // 想多宽多高都是用户的事。某一轴没动就保持源文里的原值(没写就还是没写),
        // 于是竖着拖只改高、横着拖只改宽、斜着拖两个一起改。
        next = {
          width: moved(dx) ? clampMediaSize(startW + dx) : size.width,
          height: moved(dy) ? clampMediaSize(startH + dy) : size.height
        }
      } else {
        // 图片/视频/音频有固有宽高比:只拖宽度,高度按比例跟
        const w = clampMediaSize(startW + dx)
        // 源文里本来就写死了高,就一起等比缩放,免得拖完变形成另一个样子
        const keepH = size.height !== null && startW > 0 ? clampMediaSize((startH * w) / startW) : null
        next = { width: w, height: keepH }
      }
      dragValue.current = next
      setDrag(next)
    }

    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      dragCleanup.current = null
    }
    const onUp = (): void => {
      cleanup()
      const d = dragValue.current
      dragValue.current = null
      setDrag(null)
      // 尺寸没变就不回写:点一下角柄(按下即松开)不该往正文里塞一个 `|435`
      if (d !== null && (d.width !== size.width || d.height !== size.height)) onResize?.(d)
    }

    dragCleanup.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <span
      // `sized` = 用户显式定过宽 → 盒子也跟着解除 max-width,否则盒子仍被栏宽卡住,
      // 角柄会停在栏宽处而不是图片的右下角
      className={
        'md-media-box' +
        (resizableKind ? ' resizable' : '') +
        (drag !== null ? ' dragging' : '') +
        (effective.width !== null ? ' sized' : '')
      }
      ref={boxRef}
      data-kind={kind}
    >
      {children(mediaStyle(effective))}
      {resizableKind && (
        <span className="md-resize-handle" role="slider" aria-label="调整大小" onPointerDown={startDrag} />
      )}
    </span>
  )
}

/**
 * 图片与媒体:**只有 resolveImage 给出地址才渲染**,否则降级成 chip。
 *
 * 「给不给地址」是调用方的策略,这份文件不预设:笔记预览放行 http(s)(远程图片直接显示,
 * 见 lib/note-asset.ts),而帮助页 / AI 消息不传 resolveImage,于是一律降级 ——
 * 同一份渲染器,两种策略。
 */
function renderImageExt(p: { alt: string; url: string; line: number }, key: string, ctx: ExtCtx): ReactNode {
  const resolved = ctx.resolveImage ? ctx.resolveImage(p.url) : null
  if (resolved === null) return imgChip(p.url, p.alt, key, false)

  // `![封面|300](a.png)` —— 尺寸写在 alt 里(Obsidian 的写法)
  const parsed = splitMediaSize(p.alt)
  const size: MediaSize = { width: parsed.width, height: parsed.height }
  const target: MediaTarget = { line: p.line, src: p.url }
  const media = mediaKindOf(p.url)
  // 目标由这里闭包带上 —— MediaBox 只负责量尺寸,「写回哪一张」是调用方的事
  const resize =
    ctx.onResizeMedia === undefined ? undefined : (s: MediaSize): void => ctx.onResizeMedia?.(target, s)

  // mediaKindOf 只认视频/音频/PDF;返回 null 就是图片(或后缀不认识,一律按图片处理)
  if (media === null) {
    return (
      <MediaBox kind="image" size={size} onResize={resize} key={key}>
        {(style) => <MdImage src={resolved} alt={parsed.alt} url={p.url} style={style} />}
      </MediaBox>
    )
  }

  if (media === 'video') {
    return (
      <MediaBox kind="video" size={size} onResize={resize} key={key}>
        {(style) => (
          <video className="md-media" src={resolved} style={style} controls preload="metadata" playsInline>
            {parsed.alt}
          </video>
        )}
      </MediaBox>
    )
  }

  if (media === 'audio') {
    return (
      <MediaBox kind="audio" size={size} onResize={resize} key={key}>
        {(style) => (
          <audio className="md-media md-media-audio" src={resolved} style={style} controls preload="metadata" />
        )}
      </MediaBox>
    )
  }

  // PDF 走 Chromium 自带的阅读器(需要在 webPreferences 里开 plugins)。
  // 用 iframe 而不是 embed:它同样触发阅读器,但能拿到滚动与自适应宽度。
  return (
    <MediaBox kind="pdf" size={size} onResize={resize} key={key}>
      {(style) => (
        <iframe
          className="md-media md-media-pdf"
          src={resolved}
          style={style}
          title={parsed.alt !== '' ? parsed.alt : p.url}
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      )}
    </MediaBox>
  )
}

function renderInlineExt(parts: InlineExt[], keyBase: string, ctx: ExtCtx): ReactNode[] {
  return parts.map((p, i) => {
    const key = `${keyBase}-${i}`
    if (typeof p === 'string') return p
    if ('code' in p)
      return (
        <code className="md-code-inline" key={key}>
          {p.code}
        </code>
      )
    if ('bold' in p) return <strong key={key}>{renderInlineExt(p.bold, key, ctx)}</strong>
    if ('boldItalic' in p)
      return (
        <strong key={key}>
          <em>{renderInlineExt(p.boldItalic, key, ctx)}</em>
        </strong>
      )
    if ('italic' in p) return <em key={key}>{renderInlineExt(p.italic, key, ctx)}</em>
    if ('strike' in p)
      return (
        <del className="md-del" key={key}>
          {renderInlineExt(p.strike, key, ctx)}
        </del>
      )
    if ('sub' in p) return <sub key={key}>{renderInlineExt(p.sub, key, ctx)}</sub>
    if ('sup' in p) return <sup key={key}>{renderInlineExt(p.sup, key, ctx)}</sup>
    if ('alt' in p) return renderImageExt(p, key, ctx)
    if (ctx.anchors && p.url.startsWith('#')) {
      return (
        <a
          key={key}
          className="md-link md-anchor"
          href={p.url}
          onClick={(e) => {
            e.preventDefault()
            // ⚠️ 必须 instant:本环境(Electron 44)程序化平滑滚动不工作(同 HelpModal)
            document
              .getElementById(p.url.slice(1))
              ?.scrollIntoView({ behavior: 'instant', block: 'start' })
          }}
        >
          {p.linkText}
        </a>
      )
    }
    return (
      <a
        key={key}
        className="md-link"
        href={p.url}
        onClick={(e) => {
          e.preventDefault()
          openExternal(p.url)
        }}
      >
        {p.linkText}
        <i className="fa-solid fa-arrow-up-right-from-square md-link-icon" />
      </a>
    )
  })
}

/**
 * 围栏信息串:`js` / `js title="a"` / `c++` / `objective-c` / `{.js}` / `embed https://…`。
 *
 * 第 2 组收**整行剩余部分**而不是第一个词 —— `embed` 这类围栏要把地址原样拿到手,
 * 只收第一个词会把地址丢掉。语言名由 fenceLang() 从这里面取第一个词。
 */
const FENCE_EXT_RE = /^\s*(`{3,}|~{3,})(.*)$/
const HEAD_EXT_RE = /^(#{1,6})\s+(.*)$/
const HR_EXT_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/
const QUOTE_EXT_RE = /^>\s?/
/** 列表项:缩进 + 无序(- * +)或有序(1. / 1))标记 + 内容 */
const LIST_EXT_RE = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/
/**
 * 段落对齐的包裹行。**这是全项目第二处、也是最后一处「认一小段 HTML」**
 * (第一处是表格单元格里的 `<br>`)—— 同样是字面量匹配 + 产 React 节点,
 * 块里的其它标签照样按纯文本转义。
 *
 * 为什么只能走 HTML:Markdown 没有段落对齐的标准语法。而 align 属性是
 * **实践中可移植**的那一个 —— GitHub 认、Obsidian 也认。
 */
const ALIGN_OPEN_RE = /^\s*<(?:div|p)\s+align=["']?(left|center|right)["']?\s*>\s*$/i
const ALIGN_CLOSE_RE = /^\s*<\/(?:div|p)>\s*$/i
/**
 * 折叠块。Markdown 标准里**没有**折叠语法,通行的是 HTML 的 details/summary ——
 * GitHub 认、Obsidian 也认。这是全项目第三处「认一小段 HTML」,
 * 同样是字面量匹配 + 产 React 节点,块里的其它标签照样按纯文本转义。
 */
const DETAILS_OPEN_RE = /^\s*<details(\s+open)?\s*>\s*$/i
const DETAILS_ONE_LINE_RE = /^\s*<details(\s+open)?\s*>\s*<summary>([\s\S]*?)<\/summary>\s*>?\s*$/i
const SUMMARY_RE = /^\s*<summary>([\s\S]*?)<\/summary>\s*$/i
const DETAILS_CLOSE_RE = /^\s*<\/details>\s*$/i
const TASK_EXT_RE = /^\[([ xX])\]\s*(.*)$/

interface ListItemExt {
  /** 该行在**原文档**里的下标 —— 任务项勾选要按它回写源文件 */
  line: number
  text: string
  /** undefined = 非任务项 */
  task: boolean | undefined
  children: ListNodeExt | null
}
interface ListNodeExt {
  ordered: boolean
  items: ListItemExt[]
}

/** `baseLine` 把子数组里的下标换算回原文档的行号(提示块正文会用到) */
function parseListExt(lines: string[], start: number, baseLine = 0): { list: ListNodeExt; next: number } {
  const first = LIST_EXT_RE.exec(lines[start])!
  const indent = first[1].length
  const ordered = first[3] !== undefined
  const items: ListItemExt[] = []
  let i = start

  while (i < lines.length) {
    const m = LIST_EXT_RE.exec(lines[i])
    if (!m || m[1].length !== indent) break
    // 同层混排 ul/ol → 另起一个列表(渲染成两个相邻列表,与 GFM 的松列表行为一致)
    if ((m[3] !== undefined) !== ordered) break
    const line = baseLine + i
    let text = m[4]
    let task: boolean | undefined
    const t = TASK_EXT_RE.exec(text)
    if (t) {
      task = t[1].toLowerCase() === 'x'
      text = t[2]
    }
    i++
    // 子列表:紧随其后、缩进更深的那一串
    let children: ListNodeExt | null = null
    if (i < lines.length) {
      const n = LIST_EXT_RE.exec(lines[i])
      if (n && n[1].length > indent) {
        const sub = parseListExt(lines, i, baseLine)
        children = sub.list
        i = sub.next
      }
    }
    items.push({ line, text, task, children })
  }
  return { list: { ordered, items }, next: i }
}

function renderListExt(node: ListNodeExt, keyBase: string, ctx: ExtCtx): ReactNode {
  const Tag = node.ordered ? 'ol' : 'ul'
  return (
    <Tag className="md-list" key={keyBase}>
      {node.items.map((it, n) => (
        <li key={n} className={it.task !== undefined ? 'md-task' : undefined} data-line={anchor(ctx, it.line)}>
          {it.task !== undefined && (
            <input
              type="checkbox"
              className="md-task-box"
              checked={it.task}
              disabled={ctx.onToggleTask === undefined}
              readOnly={ctx.onToggleTask === undefined}
              onChange={
                ctx.onToggleTask ? () => ctx.onToggleTask!(srcLine(ctx, it.line), !it.task) : undefined
              }
            />
          )}
          {renderInlineExt(parseInlineExt(it.text, 0, srcLine(ctx, it.line)), `${keyBase}-i${n}`, ctx)}
          {it.children !== null && renderListExt(it.children, `${keyBase}-c${n}`, ctx)}
        </li>
      ))}
    </Tag>
  )
}

/**
 * 围栏代码块。
 *
 * 高亮是**回调**:这份文件因此仍然不依赖任何语法包(它被帮助页与 AI 消息共用,
 * 不该为了笔记的代码块把几十个语法一起拖进来)。调用方不给就退化成纯文本。
 *
 * 语言角标回答「这段到底是什么」,复制按钮回答「我要拿走它」——
 * 少了角标,一段没高亮的配置和普通文本长得一样;少了复制,读的人只能手工划选。
 */
function renderFenceExt(
  code: string,
  lang: string,
  key: string,
  startLine: number,
  ctx: ExtCtx
): ReactNode {
  return (
    <div className="md-code-block" key={key} data-line={anchor(ctx, startLine)}>
      {(lang !== '' || ctx.copyCodeLabel !== undefined) && (
        <div className="md-code-bar">
          {lang !== '' && <span className="md-code-lang">{lang}</span>}
          {ctx.copyCodeLabel !== undefined && <CopyCodeButton code={code} label={ctx.copyCodeLabel} />}
        </div>
      )}
      <pre className="md-code">
        <code>{ctx.highlight ? ctx.highlight(code, lang, key) : code}</code>
      </pre>
    </div>
  )
}

/** 复制按钮:复制**原始代码**,不带任何高亮标记 —— 拿出去要能直接粘进终端 */
function CopyCodeButton({ code, label }: { code: string; label: string }): ReactNode {
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 组件卸载时把定时器清掉,否则会对着已卸载的组件 setState
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])

  const copy = (): void => {
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        setDone(true)
        if (timer.current !== null) clearTimeout(timer.current)
        timer.current = setTimeout(() => setDone(false), 1400)
      })
      .catch(() => {
        /* 剪贴板被拒时静默:不值得为一次复制失败弹一个 toast */
      })
  }

  return (
    <button type="button" className={'md-code-copy' + (done ? ' done' : '')} title={label} onClick={copy}>
      <i className={done ? 'fa-solid fa-check' : 'fa-regular fa-copy'} />
    </button>
  )
}

/**
 * 预览里的表格。只读时与以前完全一样;调用方给了 `onEditTable` 才多出编辑能力。
 *
 * **双击进编辑**而不是 contentEditable:后者要让 React 与浏览器共管同一棵子树,
 * 光标位置、受控更新、撤销栈全都会打架。双击把格子换成一个受控 `<input>`,
 * 编辑期间那棵子树完全由 React 说了算 —— 没有那一类问题。
 *
 * 编辑写回时**整块重排**(见 note-table-edit.ts):表格的价值一半在列对齐,
 * 而且列增删本来就要动所有行。重排只动空白,不动任何单元格内容。
 */
function TableView({
  block,
  line,
  ctx,
  k,
  fenced,
  width,
  cols,
  rows
}: {
  block: TableBlock
  line: number
  ctx: ExtCtx
  k: string
  /** 这张表是不是已经包在 ````table 围栏里(宽度/列宽/行高只能存在那儿) */
  fenced: boolean
  width: number | null
  /** 每列宽度(px),null 项 = 按内容自动;整个 null = 没指定 */
  cols: (number | null)[] | null
  /** 每行的最小高度(px),下标对数据行(不含表头) */
  rows: (number | null)[] | null
}): ReactNode {
  /*
   * 引用 / 提示块**里面**的表格不给编辑。
   *
   * 它们的行号虽然对得上,但那一层的正文被剥过 `> ` 前缀 —— 回写时「往某一行插一段」
   * (包 ```table 围栏就是插两行)会插到引用**外面**去,而且因为围栏插在外面、
   * 里面那张表下一轮仍然被判定为「没围栏」,于是**每拖一次就再插一层**:
   * 源码里堆出一串 ```table,整篇跟着渲染错乱。宁可只读,也不要改错。
   */
  /** 能拖尺寸 —— 围栏选项的回写是**带前缀**的,引用/提示块里也安全 */
  const canResize = ctx.onEditTable !== undefined && ctx.body !== undefined && line >= 0
  /**
   * 还能改内容(双击格子、加行加列、删行删列)。
   *
   * 和 canResize 现在是**同一个条件** —— 引用 / 提示块里的表格和正文里的行为完全一致:
   * 那条「按行整段重排」的路也认前缀了(见 note-table-edit 的 at / splice)。
   */
  const editable = canResize
  const labels = ctx.tableLabels

  /**
   * 正在编辑的格子 + 它的草稿。
   *
   * ⚠ 双击的落点必须是**整个格子(td/th)**,不能是里面那层文字 span ——
   * 空单元格的 span 宽度是 0,鼠标没有落点,于是「新增一行之后改不了」。
   * 状态放在这里而不是每个格子组件里,也是为了这个:谁在被编辑由格子说了算。
   */
  const [editing, setEditing] = useState<{ r: number; c: number; draft: string } | null>(null)
  /** 拖拽中的宽度(ref 与 state 并行:updater 必须是纯函数,不能在里面写回) */
  const [dragW, setDragW] = useState<number | null>(null)
  const dragWRef = useRef<number | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const tableRef = useRef<HTMLTableElement | null>(null)
  /** 拖拽中的列宽 / 行高。与 dragW 同一套:ref 存真值,state 只为重渲染 */
  const [dragCols, setDragCols] = useState<(number | null)[] | null>(null)
  const dragColsRef = useRef<(number | null)[] | null>(null)
  const [dragRows, setDragRows] = useState<(number | null)[] | null>(null)
  const dragRowsRef = useRef<(number | null)[] | null>(null)

  const run = (fn: (body: string, line: number) => string | null): void => {
    if (ctx.onEditTable === undefined || ctx.body === undefined) return
    const next2 = fn(ctx.body, line)
    if (next2 !== null) ctx.onEditTable(next2)
  }

  /** 表格在正文里的行区间 —— 所有尺寸回写都要它 */
  const range = { line, to: line + block.to - block.from, fenced }

  const lastCol = colCount(block) - 1
  /*
   * ⚠ `cols=` 的项数**必须夹到表格的真实列数**。
   * 多出来的项会让 <colgroup> 凭空造出列:表格列数 = max(colgroup, 单元格数) ——
   * 于是源文里只有 2 列的表会渲染成 4 列、宽到 1317px(栏宽才 754),右边全是空白,
   * 悬停时那个描边框也跟着变成一大条。踩过:删掉一列之后围栏里还留着旧的列宽。
   */
  const clampCols = (list: (number | null)[] | null): (number | null)[] | null =>
    list === null ? null : list.slice(0, colCount(block))
  const shownCols = clampCols(dragCols ?? cols)
  const shownRows = dragRows ?? rows

  /**
   * 拖列边界 / 行边界。
   *
   * ⚠ 起手必须把**每一列(每一行)的当前实宽(实高)量下来**,而不是只记被拖的那一个:
   * 尺寸是按列/按行存的,只写一个的话其余列会跟着重新分配,拖完一看「别的列也变了」。
   * 量出来的这一份同时也是「有没有变」的判据 —— 点一下没动就不回写。
   */
  const startSizeDrag = (
    // 只用到这几样 —— 收窄成最小形状,React 合成事件与原生事件都能喂进来(见下面的抓手)
    e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void },
    axis: 'col' | 'row',
    index: number
  ): void => {
    e.preventDefault()
    e.stopPropagation()
    const table = tableRef.current
    if (table === null) return
    const boxes =
      axis === 'col'
        ? [...table.querySelectorAll('thead th')].map((el) => el.getBoundingClientRect().width)
        : // 行高按**所有行**算,表头也算第 0 行 —— 排版表格里内容就写在第一行(它没有数据行)
          [...table.querySelectorAll('tr')].map((el) => el.getBoundingClientRect().height)
    if (boxes.length === 0 || boxes[index] === undefined) return

    const base = boxes.map((n) => Math.round(n))
    const start = axis === 'col' ? e.clientX : e.clientY
    const clamp = axis === 'col' ? clampTableCol : clampTableRow

    const onMove = (ev: PointerEvent): void => {
      const next = base.slice()
      next[index] = clamp(base[index]! + ((axis === 'col' ? ev.clientX : ev.clientY) - start))
      if (axis === 'col') {
        dragColsRef.current = next
        setDragCols(next)
      } else {
        dragRowsRef.current = next
        setDragRows(next)
      }
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    const onUp = (): void => {
      cleanup()
      const next = axis === 'col' ? dragColsRef.current : dragRowsRef.current
      if (axis === 'col') {
        dragColsRef.current = null
        setDragCols(null)
      } else {
        dragRowsRef.current = null
        setDragRows(null)
      }
      // 尺寸没变就不回写:点一下边界不该往正文里塞一串数字
      if (next === null || next.every((n, i) => n === base[i])) return
      if (axis === 'col') {
        /*
         * 列宽与**整表宽度**一起写。
         * 只写列宽的话,固定布局会把富余的那点宽度摊给别的列 —— 拖窄第一列,
         * 旁边那列反而变宽(实测 105→80 时,147 自己长到了 158)。
         * 两个键必须**在一次调用里**写:没围栏时第一次调用会插入两行,行号就变了。
         */
        const trimmed = next.slice(0, colCount(block))
        const total = trimmed.reduce<number>((a, n) => a + (n ?? 0), 0)
        run((b) =>
          setTableOptionsInBody(b, range, [
            ['cols', joinSizeList(trimmed)],
            ['width', String(clampTableWidth(total))]
          ])
        )
        return
      }
      run((b) => setTableOptionInBody(b, range, 'rows', joinSizeList(next)))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const cell = (raw: string, row: number, col: number, key: string, head: boolean): ReactNode => {
    const Tag = head ? 'th' : 'td'
    const isLast = col === lastCol
    const isEditing = editing !== null && editing.r === row && editing.c === col

    /*
     * 这一**行**在源文里的行号。
     * ⚠ 不能拿整张表的起始行糊弄:格子里那张图的尺寸要写回**它自己这一行**
     * (`setMediaSizeInBody` 按行号找那一张)。用表格起始行的话,那一行根本没有这张图 ——
     * 表现为「拖得动、松手却弹回去,文件一个字没改」(踩过)。
     * 表头在第 0 行,分隔行占 1 行,所以数据行要再 +1。
     */
    const rowLine = line + row + (row > 0 ? 1 : 0)

    const done = (commit: boolean): void => {
      const d = editing
      setEditing(null)
      if (d === null || !commit) return
      const next = cellFromEditText(d.draft)
      if (next !== raw) run((b, l) => setTableCell(b, l, row, col, next))
    }

    return (
      <Tag
        key={key}
        className={editable ? 'md-cell-host' : undefined}
        style={{ textAlign: block.aligns[col] ?? undefined }}
        title={editable && !isEditing ? labels?.editHint : undefined}
        // 整个格子都是双击落点 —— 空单元格同样点得到
        onDoubleClick={
          editable && !isEditing ? () => setEditing({ r: row, c: col, draft: cellToEditText(raw) }) : undefined
        }
      >
        {isEditing ? (
          // 用 textarea 而不是 input:格子里要能按回车换行(写回时变成 <br>)。
          // 没有边框、背景透明、高度按行数长 —— 看起来就是「直接在格子里改」。
          <textarea
            className="md-cell-input"
            rows={Math.max(1, editing.draft.split('\n').length)}
            value={editing.draft}
            /*
             * 不用 autoFocus + onFocus 去放光标:那个组合里 focus 事件的时机不可靠,
             * 实测光标仍停在位置 0(双击一格准备接着改,却要按一下 End)。
             * ref 回调在「节点建好、value 也写进去」之后才跑,这时候设光标才稳。
             * dataset 标记保证只做一次 —— 否则每敲一个字都会把光标弹回末尾。
             */
            ref={(el) => {
              if (el === null || el.dataset.caretSeeded === '1') return
              el.dataset.caretSeeded = '1'
              /*
               * ⚠ `preventScroll: true` 不能省。
               * 编辑框是刚挂进 DOM 的,此刻布局还没稳 —— 不带这个参数时,浏览器会把它
               * 「滚进视野」,而它算出来的位置是错的:预览会**从你正在改的那张表直接跳到
               * 几千像素以外**(实测 8684 → 697)。格子本来就在视野里,根本不需要滚。
               */
              el.focus({ preventScroll: true })
              el.setSelectionRange(el.value.length, el.value.length)
            }}
            onChange={(e) => setEditing({ r: row, c: col, draft: e.target.value })}
            onBlur={() => done(true)}
            onKeyDown={(e) => {
              // 回车换行、Esc 取消;⌘↵ 才是提交(回车在这里有更重要的用途)
              if (e.key === 'Escape') {
                e.preventDefault()
                done(false)
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                done(true)
              }
            }}
          />
        ) : (
          /*
           * 内容套一层 wrapper:单元格里现在可以有块级内容(见 renderCellContent),
           * 而后面还跟着两个**绝对定位**的删除按钮 —— 没有这层就写不出
           * 「首尾块的外边距归零」:`:last-child` 匹配到的是按钮,不是最后那块内容。
           */
          <div className="md-cell-body">{renderCellContent(raw, `${k}-${key}`, ctx, rowLine)}</div>
        )}
        {/* 列删除贴在表头格右上角(它删的是整列,位置就该在列上) */}
        {editable && head && (
          <button
            type="button"
            className="md-table-del col"
            title={labels?.delColumn}
            aria-label={labels?.delColumn}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={() => run((b, l) => removeTableColumn(b, l, col))}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        )}
        {/* 行删除挂在最后一个数据格里,绝对定位到表格右边框之外 —— 不占格子、不撑宽表格 */}
        {editable && !head && isLast && (
          <button
            type="button"
            className="md-table-del row"
            title={labels?.delRow}
            aria-label={labels?.delRow}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={() => run((b, l) => removeTableRow(b, l, row))}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        )}
      </Tag>
    )
  }

  /**
   * 拖动改宽。与媒体那套同一个观感:悬停出框与角柄,横向拖。
   *
   * 表格的宽度**没有行内语法可用**,只能写进 ````table 围栏的 `width=` ——
   * 所以没包围栏的表第一次拖会被**就地包一层**(见 note-table-edit 的说明)。
   */
  /*
   * 拖列宽时**整表宽度也跟着预览**。
   *
   * 不跟的话:表格还是原宽度(100% 或旧的 width=),而固定布局会把富余的宽度摊给别的列 ——
   * 表现就是「把这一列拖窄,旁边那列先变大,松手才缩回去」。跟着一起预览就所见即所得了。
   * (写回时本来就同时写 cols= 和 width=,预览只是提前把它演出来。)
   */
  const previewW =
    dragCols === null ? null : clampTableWidth(dragCols.reduce<number>((a, n) => a + (n ?? 0), 0))
  const shown = dragW ?? previewW ?? width

  const startResize = (e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const box = wrapRef.current?.getBoundingClientRect()
    if (box === undefined) return
    const startX = e.clientX
    const startW = box.width
    const onMove = (ev: PointerEvent): void => {
      const w = clampTableWidth(startW + (ev.clientX - startX))
      dragWRef.current = w
      setDragW(w)
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    const onUp = (): void => {
      cleanup()
      const w = dragWRef.current
      dragWRef.current = null
      setDragW(null)
      if (w !== null && w !== width) {
        run((b) => setTableWidthInBody(b, range, w))
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /**
   * 列 / 行边界的位置(相对表格左上角)。
   *
   * ⚠ 抓手**不塞在格子里**,而是按坐标命中。格子上的定位基准被列删除 / 行删除按钮占着
   * (`position: relative`),抓手塞进去就被困在一格宽里 —— 表头行的行边界只剩第一列那么宽,
   * 列边界也只能在表头上抓。量出边界位置之后,列边界可以整表高、行边界可以整行宽。
   */
  const edgesRef = useRef<{
    cols: number[]
    rows: number[]
    w: number
    h: number
    nested: { left: number; right: number; top: number; bottom: number }[]
  }>({ cols: [], rows: [], w: 0, h: 0, nested: [] })
  const [guides, setGuides] = useState<{
    cols: number[]
    rows: number[]
    w: number
    h: number
    nested: { left: number; right: number; top: number; bottom: number }[]
  } | null>(null)

  // 每次渲染后重量一次(内容、列宽、行高、整表宽度都会让边界移动)。
  // 量出来没变就不 setState —— 否则「渲染 → 量 → 渲染」会一直转下去。
  useLayoutEffect(() => {
    const t = tableRef.current
    if (t === null || !canResize) {
      edgesRef.current = { cols: [], rows: [], w: 0, h: 0, nested: [] }
      setGuides(null)
      return
    }
    const base = t.getBoundingClientRect()
    // **每一列**的右缘都算一条边界,最后一列也是 —— 它的右缘就是表格的右边缘,
    // 拖它改的是最后一列的宽度(整表宽度跟着走)。从前把最后一列切掉了,于是
    // 「行能拖最后一行、列却拖不了最后一列」,不对称(用户报的)。
    const cols = [...t.querySelectorAll('thead th')].map((el) => el.getBoundingClientRect().right - base.left)
    const rows = [...t.querySelectorAll('tr')].map((el) => el.getBoundingClientRect().bottom - base.top)
    /*
     * 格子里那张**嵌套表**的纵向范围。
     *
     * 为什么要单独量:外层表的列边界线是整表高的,它会**横穿过**格子里的那张小表 ——
     * 看起来就像小表自己的列线,拖它改的却是外层那一列(用户报过:「看到能调,实际不能」)。
     * 下面画线时按这些范围把线断开,小表身上就不会再出现不属于它的线。
     */
    // ⚠ 基准取**提示层自己**那一层(.md-table-wrap),不是 <table> ——
    // 线是画在前者上的,两者的原点差一点(实测 13px),混用会让线在竖直方向错位。
    const wrapBox = (t.closest('.md-table-wrap') ?? t).getBoundingClientRect()
    const nested = [...t.querySelectorAll('.md-cell-body .md-table-block')].map((el) => {
      const r = el.getBoundingClientRect()
      return {
        left: r.left - wrapBox.left,
        right: r.right - wrapBox.left,
        top: r.top - wrapBox.top,
        bottom: r.bottom - wrapBox.top
      }
    })
    const next = { cols, rows, w: base.width, h: base.height, nested }
    edgesRef.current = next
    setGuides((cur) =>
      cur !== null &&
      Math.abs(cur.w - next.w) < 0.5 &&
      Math.abs(cur.h - next.h) < 0.5 &&
      cur.cols.length === cols.length &&
      cur.cols.every((c, i) => Math.abs(c - (cols[i] ?? 0)) < 0.5) &&
      cur.rows.length === rows.length &&
      cur.rows.every((c, i) => Math.abs(c - (rows[i] ?? 0)) < 0.5) &&
      cur.nested.length === nested.length &&
      cur.nested.every((n, i) => Math.abs(n.top - nested[i]!.top) < 0.5)
        ? cur
        : next
    )
  })

  /**
   * 落点离哪条边界最近(±8px)。列边界优先:两线交点上拖列更常用。
   *
   * 8 而不是 4:原来贴着边线按,边线只有 1–2px,要瞄准 —— 用户反馈「非常不好操作」。
   * 放宽到 8 之后,按在抓手身上也算命中(抓手浮在离边线 13px 处,它的内侧半边落在带里)。
   */
  const EDGE_BAND = 8
  const hitEdge = (clientX: number, clientY: number): { axis: 'col' | 'row'; index: number } | null => {
    const t = tableRef.current
    if (t === null) return null
    const base = t.getBoundingClientRect()
    if (clientY < base.top - EDGE_BAND || clientY > base.bottom + EDGE_BAND) return null
    if (clientX < base.left - EDGE_BAND || clientX > base.right + EDGE_BAND) return null
    const x = clientX - base.left
    const y = clientY - base.top
    /*
     * ⚠ 落在**格子里的嵌套表**上时,一律不算命中。
     * 那张小表自己没有手柄(格子只有一行源文,列宽没地方存),所以它身上既不该出现
     * 拖拽光标、也不该响应按下 —— 否则就是「看到能拖、拖了没反应(或改了外层)」。
     * 外层表的线也已经在这张表身上断开了(见下面画线那段),这里把事件一起掐掉,两者才一致。
     */
    const wrapBox = (tableRef.current?.closest('.md-table-wrap') ?? tableRef.current)?.getBoundingClientRect()
    if (wrapBox !== undefined && wrapBox !== null) {
      const wx = clientX - wrapBox.left
      const wy = clientY - wrapBox.top
      const inNested = edgesRef.current.nested.some(
        (n) => wx >= n.left && wx <= n.right && wy >= n.top && wy <= n.bottom
      )
      if (inNested) return null
    }
    const ci = edgesRef.current.cols.findIndex((v) => Math.abs(v - x) <= EDGE_BAND)
    if (ci >= 0) return { axis: 'col', index: ci }
    const ri = edgesRef.current.rows.findIndex((v) => Math.abs(v - y) <= EDGE_BAND)
    if (ri >= 0) return { axis: 'row', index: ri }
    return null
  }

  const onTablePointerDown = (e: React.PointerEvent): void => {
    if (!canResize) return
    const hit = hitEdge(e.clientX, e.clientY)
    if (hit !== null) startSizeDrag(e, hit.axis, hit.index)
  }

  /**
   * 光标提示:悬在列 / 行边界上时,整张表换成拖拽光标。
   *
   * ⚠ 靠**给外层块打 data 属性 + CSS 覆盖**,而不是给表格写 style.cursor ——
   * 格子自带 `.md-cell-host { cursor: text }`,子元素自己的 cursor 会压过祖先继承下来的,
   * 只给表格设的话,指针一进格子就又变回 text(踩过:表格的 style 明明设上了,指针还是文本光标)。
   */
  const onTablePointerMove = (e: React.PointerEvent): void => {
    const el = wrapRef.current
    if (el === null || !canResize) return
    const hit = hitEdge(e.clientX, e.clientY)
    el.dataset.cursor = hit === null ? '' : hit.axis
  }

  const clearCursor = (): void => {
    const el = wrapRef.current
    if (el !== null) el.dataset.cursor = ''
  }

  const tools = editable ? (
    <div className="md-table-tools">
      <button type="button" onClick={() => run((b, l) => addTableRow(b, l, block.rows.length))}>
        <i className="fa-solid fa-plus" />
        <span>{labels?.addRow}</span>
      </button>
      <button type="button" onClick={() => run((b, l) => addTableColumn(b, l, colCount(block) - 1))}>
        <i className="fa-solid fa-plus" />
        <span>{labels?.addColumn}</span>
      </button>
    </div>
  ) : null

  return (
    <Fragment>
    {/*
      两层是刻意的:
        · 外层 .md-table-block **不滚动** —— 角柄挂在它上面,才能和媒体一样落在框外(-7px)
          而不被 wrap 的 overflow 裁掉;
        · 内层 .md-table-wrap 保留 overflow-x: auto —— 宽表格仍然自己横向滚,
          不必把整栏拖去滚。
    */}
    <div
      className={
        'md-table-block' +
        (canResize ? ' resizable' : '') +
        (dragW !== null ? ' dragging' : '') +
        (shown !== null ? ' sized' : '')
      }
      data-line={anchor(ctx, line)}
      ref={wrapRef}
    >
      <div className={'md-table-wrap' + (canResize ? ' editable' : '')}>
      {/*
        宽度设在**表格**上,不是外层块上 —— 表格有最小内容宽度,拖到比它还窄时表格不再缩;
        块若自己带着宽度就会继续缩,于是「框(画在表格上)和角柄(在块上)分家」。
        让块 fit-content 跟着表格走,两者就永远一致。
      */}
      <table
        // `md-table-fixed`:列宽是写死的(有 cols=)→ 格子宽度确定 → 里面的嵌套表可以跟着格子走
        className={'md-table' + (shownCols !== null ? ' md-table-fixed' : '')}
        ref={tableRef}
        onPointerDown={onTablePointerDown}
        onPointerMove={onTablePointerMove}
        onPointerLeave={clearCursor}
        style={{
          ...(shown !== null ? { width: `${shown}px`, maxWidth: 'none' } : undefined),
          // 给了列宽就切成固定布局 —— auto 布局下浏览器会按内容重新分配,写进去的宽度不生效
          ...(shownCols !== null ? { tableLayout: 'fixed' as const } : undefined)
        }}
      >
        {shownCols !== null && (
          <colgroup>
            {shownCols.map((w, i) => (
              <col key={i} style={w !== null ? { width: `${w}px` } : undefined} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr style={shownRows?.[0] != null ? { height: `${shownRows[0]}px` } : undefined}>
            {block.header.map((h, c) => cell(h, 0, c, `th${c}`, true))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((r, rn) => (
            // 行高是**最小**高度:`<tr>` 上的 height 在表格里就是下限,内容更高时照样撑开
            <tr key={rn} style={shownRows?.[rn + 1] != null ? { height: `${shownRows[rn + 1]}px` } : undefined}>
              {block.header.map((_, cn) => cell(r[cn] ?? '', rn + 1, cn, `td${rn}-${cn}`, false))}
            </tr>
          ))}
        </tbody>
      </table>
        {/*
          列 / 行边界的可视提示。**不吃指针事件** —— 命中判定在表格的 pointerdown 里按坐标做,
          所以这里的线可以横跨整表(列边界整表高、行边界整行宽),不受格子定位上下文的限制。
        */}
        {canResize && guides !== null && (
          <div className="md-table-guides" style={{ width: `${guides.w}px`, height: `${guides.h}px` }}>

            {guides.cols.flatMap((x, i) => {
              // 避开格子里的嵌套表:线在它身上断开,不给出「小表也能拖」的假象
              const cuts = guides.nested.filter((n) => n.top > 0 && n.bottom < guides.h)
              if (cuts.length === 0) {
                return [
                  <span
                    key={`c${i}`}
                    className="md-col-resize"
                    role="separator"
                    aria-label={labels?.resizeColumn}
                    style={{ left: `${x - 3}px` }}
                  />
                ]
              }
              const segs: { top: number; bottom: number }[] = []
              let cur = 0
              for (const c of [...cuts].sort((a, b) => a.top - b.top)) {
                if (c.top > cur) segs.push({ top: cur, bottom: c.top })
                cur = Math.max(cur, c.bottom)
              }
              if (cur < guides.h) segs.push({ top: cur, bottom: guides.h })
              return segs.map((sg, k) => (
                <span
                  key={`c${i}-${k}`}
                  className="md-col-resize"
                  role="separator"
                  aria-label={labels?.resizeColumn}
                  style={{ left: `${x - 3}px`, top: `${sg.top}px`, height: `${sg.bottom - sg.top}px`, bottom: 'auto' }}
                />
              ))
            })}
            {guides.rows.map((y, i) => (
              <span
                key={`r${i}`}
                className="md-row-resize"
                role="separator"
                aria-label={labels?.resizeRow}
                style={{ top: `${y - 3}px` }}
              />
            ))}
          </div>
        )}
      </div>
      {canResize && (
        <span className="md-resize-handle" role="slider" aria-label="调整宽度" onPointerDown={startResize} />
      )}
    </div>
    {tools}
    </Fragment>
  )
}

/** 围栏信息串里的 `width=600` → 600;没有或写错就是 null */
function parseFenceWidth(rest: string): number | null {
  const m = /(?:^|\s)width=(\d+)(?:\s|$)/i.exec(rest)
  return m === null ? null : clampMediaSize(Number(m[1]))
}

/**
 * 图表块:与图片/表格同一套 —— 悬停出框与角柄,横向拖改宽。
 *
 * 尺寸写进**围栏信息串**(\`\`\`mermaid width=600):正文是 mermaid 源码,往里塞配置会把图弄坏。
 * 只拖宽度、高度按图自身比例 —— 图表有固有宽高比,硬拉高只会把它拉变形。
 */
function DiagramView({ block, ctx }: { block: DiagramBlock; ctx: ExtCtx }): ReactNode {
  const width = block.width
  const editable = ctx.onEditTable !== undefined && ctx.body !== undefined
  const [dragW, setDragW] = useState<number | null>(null)
  const dragRef = useRef<number | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const shown = dragW ?? width

  const startResize = (e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const box = boxRef.current?.getBoundingClientRect()
    if (box === undefined) return
    const startX = e.clientX
    const startW = box.width
    const onMove = (ev: PointerEvent): void => {
      const w = clampMediaSize(startW + (ev.clientX - startX))
      dragRef.current = w
      setDragW(w)
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    const onUp = (): void => {
      cleanup()
      const w = dragRef.current
      dragRef.current = null
      setDragW(null)
      if (w !== null && w !== width && ctx.onEditTable !== undefined && ctx.body !== undefined) {
        const next = setFenceWidthInBody(ctx.body, block.from, w)
        if (next !== null) ctx.onEditTable(next)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      className={'md-diagram' + (editable ? ' resizable' : '') + (dragW !== null ? ' dragging' : '')}
      data-line={anchor(ctx, block.from)}
      ref={boxRef}
      style={shown !== null ? { width: `${shown}px`, maxWidth: 'none' } : undefined}
    >
      {ctx.renderDiagram?.(block)}
      {editable && (
        <span className="md-resize-handle" role="slider" aria-label="调整宽度" onPointerDown={startResize} />
      )}
    </div>
  )
}

/**
 * 单元格的显示内容。`<br>` 渲染成真正的换行 —— 这是全项目唯一认的一小段「HTML」,
 * 而且是**字面量匹配 + 产 React `<br/>`**,不是解析 HTML:markdown.tsx「绝不注入」
 * 那条保证没有被破(单元格里的其它任何标签照样按纯文本转义)。
 */
/** 单元格里的换行标记。源文里一个单元格**只有一行**,`<br>` 就是它的换行符 */
const BR_RE = /<br\s*\/?>/gi

/**
 * 单元格内容。
 *
 * 单元格在源文里只有一行,想在里面写多行结构就只能拿 `<br>` 当行分隔符 ——
 * 于是 `- 甲<br>- 乙` 是一份两行的迷你文档。
 *
 * 分流规则是「**有没有块级行**」,不是「有没有 `<br>`」:
 *   · 没有块级行 → 走行内。`第一行<br>第二行` 必须还是一段两行,不能裂成两个段落
 *     (`<br>` 更常见的用法就是「这里换行」,现有笔记大量这么写);
 *   · 有块级行 → 整格按块渲染。单行也算:写 `- 甲` 的人要的是列表,
 *     而 `- 甲` 单独一行却露出原文、`- 甲<br>- 乙` 才是列表,那种不一致更难解释。
 *
 * 格子里的一切**只读**:这些块全都来自同一行源文,而「写回源文」的入口都是按行定位的,
 * 拿这一行去回写会把整条表格行写坏。图仍然渲染,只是不给「重新编辑」。
 */
function renderCellContent(raw: string, keyBase: string, ctx: ExtCtx, line: number): ReactNode {
  // 两条路都走只读上下文:行内那条也一样 —— 单元格里的图片/视频以前会出拖拽角柄,
  // 而回写用的是**表格起始行**的行号,拖完只会「没有改动」,看着像坏了。
  const ro = cellCtx(ctx, line)
  const parts = raw.split(BR_RE)
  const trimmed = parts.map((p) => p.trim())

  if (!trimmed.some((p, i) => isBlockStartExt(p, trimmed[i + 1]))) {
    if (parts.length === 1) return renderInlineExt(parseInlineExt(raw, 0, line), keyBase, ro)
    return parts.map((part, i) => (
      <Fragment key={i}>
        {i > 0 && <br />}
        {renderInlineExt(parseInlineExt(part, 0, line), `${keyBase}-p${i}`, ro)}
      </Fragment>
    ))
  }

  return renderBlocks(parts, `${keyBase}-b`, ro, line, { k: 0 })
}

/**
 * 单元格里的块共用的上下文:行号压平,并按「那条回写路径认不认前缀 / 要不要插行」逐个决定开关。
 *
 * | 能力 | 格子里 | 为什么 |
 * |---|---|---|
 * | 拖媒体改尺寸 | **开** | 尺寸语法(`![\|80]`)就写在**这一行里**,回写是**行内替换** —— 不插行,安全 |
 * | 双击改格子 | 关 | 那是整段重排,会把这一行的 `\|` 结构写坏 |
 * | 加行加列 / 删行删列 | 关 | 同上 |
 * | 图表拖宽 / 编辑 | 关 | 它的尺寸要写进 ````table` 围栏 —— 那是**插行**,一行里做不到 |
 * | 网页嵌入改尺寸 | 关 | 同上(要往围栏里插 `height:` 行) |
 * | 任务勾选 | 关 | 它要重写「行首的 `- [ ]`」,而这一行行首是 `\|` —— 真开也是空操作,不如不出 |
 */
function cellCtx(ctx: ExtCtx, line: number): ExtCtx {
  return {
    ...ctx,
    flatLine: line,
    onToggleTask: undefined,
    onEditTable: undefined,
    onResizeEmbed: undefined,
    body: undefined
  }
}

/** 表格列对齐:`:---` 左 / `:---:` 中 / `---:` 右 */
function alignmentsOf(sep: string): (('left' | 'center' | 'right') | undefined)[] {
  return splitRow(sep).map((cell) => {
    const s = cell.trim()
    const left = s.startsWith(':')
    const right = s.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return undefined
  })
}

function isBlockStartExt(line: string, next?: string): boolean {
  return (
    ALIGN_OPEN_RE.test(line) ||
    DETAILS_OPEN_RE.test(line) ||
    DETAILS_ONE_LINE_RE.test(line) ||
    FENCE_EXT_RE.test(line) ||
    HR_EXT_RE.test(line) ||
    HEAD_EXT_RE.test(line) ||
    LIST_EXT_RE.test(line) ||
    QUOTE_EXT_RE.test(line) ||
    (isTableRow(line) && next !== undefined && isTableSep(next))
  )
}

/** 提示块:图标 + 标题 + 正文(正文按块再走一遍渲染,所以里面可以有列表、代码块…) */
function renderCalloutExt(
  kind: CalloutKind,
  title: string,
  body: string[],
  key: string,
  startLine: number,
  ctx: ExtCtx,
  counter: { k: number }
): ReactNode {
  const label = ctx.calloutLabel ? ctx.calloutLabel(kind) : defaultCalloutLabel(kind)
  return (
    <div className={`md-callout md-callout-${kind}`} key={key} data-line={anchor(ctx, startLine)}>
      <div className="md-callout-hd">
        <i className={`fa-solid ${CALLOUT_ICON[kind]}`} />
        <span>{title !== '' ? title : label}</span>
      </div>
      {body.some((l) => l.trim() !== '') && (
        <div className="md-callout-body">
          {renderBlocks(body, `${key}-b`, ctx, startLine + 1, counter)}
        </div>
      )}
    </div>
  )
}

/**
 * 网页嵌入。iframe 的 sandbox 是**必须**的:嵌进来的页面是别人写的,
 * 它不该有能力导航我们这一层、弹模态、或者下载东西。
 * 保留 allow-scripts / allow-same-origin 是因为绝大多数站点没有它们就白屏,
 * 而跨源 iframe 本来就碰不到我们的 DOM 与 window.launcher。
 *
 * 它套在 MediaBox 里(与 PDF 同一档:拖高度)—— 之前是裸 iframe,
 * 于是「所有独立渲染区域都能缩放」里独独少了它。
 * 盒子只裹 iframe 本身,不含上面那条地址栏 —— 否则量到的高度会把地址栏也算进去,
 * 拖 100px 结果只长了 71px。
 */
function renderEmbedExt(
  spec: EmbedSpec,
  resolved: string,
  key: string,
  startLine: number,
  ctx: ExtCtx,
  onResize?: (size: MediaSize) => void
): ReactNode {
  const external = /^https?:\/\//i.test(spec.url)
  const size: MediaSize = { width: spec.width, height: spec.height }
  return (
    // 定了宽就跟着收:带边框的是**这一层**,只让里面的盒子收,
    // 边框会留在整栏宽上 —— 看起来就是「内容窄了、框没动」。
    <div
      className={'md-embed' + (spec.width !== null ? ' sized' : '') + (onResize === undefined ? '' : ' resizable')}
      key={key}
      data-line={anchor(ctx, startLine)}
    >
      <div className="md-embed-bar">
        <i className="fa-solid fa-globe" />
        <span className="md-embed-url" title={spec.url}>
          {spec.url}
        </span>
        {external && (
          <a
            className="md-embed-open"
            href={spec.url}
            title={spec.url}
            onClick={(e) => {
              e.preventDefault()
              openExternal(spec.url)
            }}
          >
            <i className="fa-solid fa-arrow-up-right-from-square" />
          </a>
        )}
      </div>
      <MediaBox
        kind="embed"
        size={size}
        onResize={onResize}
      >
        {(style) => (
          <iframe
            className="md-embed-frame"
            src={resolved}
            title={spec.url}
            // 不给 allow-top-navigation / allow-modals / allow-downloads / allow-popups-to-escape-sandbox
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
            referrerPolicy="no-referrer"
            style={style}
          />
        )}
      </MediaBox>
    </div>
  )
}

/**
 * 块级渲染主循环。
 *
 * `baseLine` 是这一批 lines 在**原文档**里的起始行号 —— 提示块的正文是原文档的
 * 一个子区间,但 `data-line`(滚动同步)与任务项勾选都必须是**绝对行号**,
 * 否则点一下预览里的复选框会改到别处去。
 * `counter` 跨层共享,保证 React key 不重复。
 */
function renderBlocks(
  lines: string[],
  keyPrefix: string,
  ctx: ExtCtx,
  baseLine: number,
  counter: { k: number },
  /** 表格的额外上下文:宽度住在围栏选项里,所以要一路带进来 */
  table?: { fenced: boolean; width: number | null; cols: (number | null)[] | null; rows: (number | null)[] | null }
): ReactNode[] {
  const out: ReactNode[] = []
  const key = (): string => `${keyPrefix}-${counter.k++}`
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 围栏代码块(``` 或 ~~~,三个以上):未闭合吃到结尾,不静默丢弃后半段
    const fence = line.match(FENCE_EXT_RE)
    if (fence) {
      const startLine = i
      const closeRe = new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`)
      const body: string[] = []
      i++
      while (i < lines.length && !closeRe.test(lines[i])) body.push(lines[i++])
      const endLine = i < lines.length ? i : Math.max(startLine, lines.length - 1)
      if (i < lines.length) i++
      const code = body.join('\n')
      const info = fence[2] ?? ''
      const lang = fenceLang(info)
      const k0 = key()
      const abs = baseLine + startLine

      // 图表:语言是 mermaid 且调用方给了渲染器。没给就退回普通代码块 ——
      // 帮助页/AI 消息里若出现 ```mermaid,显示源码比显示一块空白强。
      if (lang === 'mermaid' && ctx.renderDiagram !== undefined) {
        out.push(
          <DiagramView
            key={k0}
            block={{
              lang,
              code,
              from: abs,
              to: baseLine + endLine,
              key: k0,
              width: parseFenceWidth(fenceRest(info)),
              // 单元格里的图不给改(见 DiagramBlock.editable):它没有自己的源文行
              editable:
                ctx.onEditTable !== undefined && ctx.body !== undefined && ctx.flatLine === undefined
            }}
            ctx={ctx}
          />
        )
        continue
      }

      // 网页嵌入。解析不出地址、或调用方不放行(比如 http 未获准)→ 退回代码块,
      // 用户至少能看到自己写了什么,而不是一片空白。
      if (lang === 'embed') {
        const spec = parseEmbed(fenceRest(info), body)
        const resolved = spec !== null && ctx.resolveEmbed ? ctx.resolveEmbed(spec.url) : null
        if (spec !== null && resolved !== null) {
          out.push(
            renderEmbedExt(
              spec,
              resolved,
              k0,
              abs,
              ctx,
              ctx.onResizeEmbed === undefined
                ? undefined
                : (sz) => ctx.onResizeEmbed?.({ from: abs, to: baseLine + endLine }, sz)
            )
          )
          continue
        }
      }

      // 带样式的表格:```` ```table border=none color=#8b5cf6 ```` 包一层。
      // GFM 的表格语法没有属性位,单表覆盖只能靠外层围栏 —— 正文仍按普通块渲染,
      // 只是在外面套一个带 CSS 变量的壳,所以里面的表格、说明文字都照常工作。
      if (lang === 'table') {
        const tableOpts = parseTableOptions(fenceRest(info))
        const vars = tableCssVars(tableOpts)
        out.push(
          <div
            className="md-table-scope"
            key={k0}
            data-line={anchor(ctx, abs)}
            data-layout={tableOpts.layout ? '' : undefined}
            style={vars}
          >
            {renderBlocks(body, `${k0}-t`, ctx, baseLine + startLine + 1, counter, {
              fenced: true,
              width: tableOpts.width,
              cols: tableOpts.cols,
              rows: tableOpts.rows
            })}
          </div>
        )
        continue
      }

      out.push(renderFenceExt(code, lang, k0, abs, ctx))
      continue
    }

    // 分隔线(必须在表格与列表之前:`---` 单独一行是 hr)
    if (HR_EXT_RE.test(line)) {
      out.push(<hr className="md-hr" key={key()} data-line={anchor(ctx, baseLine + i)} />)
      i++
      continue
    }

    const head = line.match(HEAD_EXT_RE)
    if (head) {
      const level = head[1].length
      out.push(
        <div
          className={`md-h md-h${level}`}
          // 扩展模式才补语义:基础模式的 DOM 一字不改(帮助页/AI 消息的 CSS 依赖它)
          role="heading"
          aria-level={level}
          id={ctx.anchors ? slugifyHeading(head[2]) : undefined}
          data-line={anchor(ctx, baseLine + i)}
          key={key()}
        >
          {renderInlineExt(parseInlineExt(head[2], 0, baseLine + i), key(), ctx)}
        </div>
      )
      i++
      continue
    }

    // 折叠块:<details> 里的内容照常按块渲染,<summary> 那行做折叠标题
    const dOpen = DETAILS_OPEN_RE.exec(line) ?? DETAILS_ONE_LINE_RE.exec(line)
    if (dOpen !== null) {
      const k0 = key()
      const startLine = i
      const oneLine = DETAILS_ONE_LINE_RE.exec(line)
      const summary: string[] = []
      if (oneLine !== null) summary.push(oneLine[2])
      i++
      if (oneLine === null && i < lines.length) {
        const sm = SUMMARY_RE.exec(lines[i])
        if (sm !== null) {
          summary.push(sm[1])
          i++
        }
      }
      /*
       * ⚠ 正文第一行在**原文档**里的下标,必须**数出来**,不能写死成 startLine + 1。
       * 折叠块有三种形态:`<details><summary>x</summary>`(一行)、`<details>` + 单独一行
       * `<summary>`(两行)、`<details>` 不带 summary(一行)—— 吃掉的行数不一样。
       * 写死 +1 的话,第二种(最常见的那种)会**整体差一行**:里面所有按行号回写的东西
       * (表格的列宽行高、双击改格子、任务勾选、媒体拖拽、图表)都会写到**上面一行**去。
       * 踩过:折叠块里的表格一拖列宽,源码就错乱。
       */
      const bodyLine = i
      const body: string[] = []
      while (i < lines.length && !DETAILS_CLOSE_RE.test(lines[i])) body.push(lines[i++])
      if (i < lines.length) i++
      const startOpen = dOpen[1] !== undefined
      out.push(
        <details
          className="md-details"
          key={k0}
          data-line={anchor(ctx, baseLine + startLine)}
          /*
           * ⚠ 不把 `open` 交给 React 当受控属性 —— 那样每次重渲染都会把它按回去,
           * 用户点了展不开。这里只在挂载时按源码里的 `<details open>` 设一次,
           * 之后完全交给浏览器原生行为。
           */
          ref={(el) => {
            if (el === null || el.dataset.openSeeded === '1') return
            el.dataset.openSeeded = '1'
            if (startOpen) el.open = true
          }}
        >
          <summary className="md-summary">
            {renderInlineExt(parseInlineExt(summary.join(' '), 0, baseLine + startLine), `${k0}-s`, ctx)}
          </summary>
          {/* 内容套一层 wrapper 再加内边距 —— 直接给子元素加会把 .md-list 自己的
              padding-left 覆盖掉,列表圆点会贴到边框上(提示块也是这么做的) */}
          <div className="md-details-body">
            {renderBlocks(body, `${k0}-d`, ctx, baseLine + bodyLine, counter)}
          </div>
        </details>
      )
      continue
    }

    // 段落对齐包裹块:内容照常按块渲染,只是外面套一层 textAlign。
    // 未闭合就吃到结尾 —— 不静默丢掉后半篇。
    const alignOpen = ALIGN_OPEN_RE.exec(line)
    if (alignOpen !== null) {
      const k0 = key()
      const startLine = i
      const body: string[] = []
      i++
      while (i < lines.length && !ALIGN_CLOSE_RE.test(lines[i])) body.push(lines[i++])
      if (i < lines.length) i++
      out.push(
        <div
          className="md-align"
          key={k0}
          data-line={anchor(ctx, baseLine + startLine)}
          style={{ textAlign: alignOpen[1].toLowerCase() as 'left' | 'center' | 'right' }}
        >
          {renderBlocks(body, `${k0}-al`, ctx, baseLine + startLine + 1, counter)}
        </div>
      )
      continue
    }

    if (LIST_EXT_RE.test(line)) {
      const parsed = parseListExt(lines, i, baseLine)
      out.push(renderListExt(parsed.list, key(), ctx))
      i = parsed.next
      continue
    }

    if (QUOTE_EXT_RE.test(line)) {
      const startLine = i
      const body: string[] = []
      while (i < lines.length && QUOTE_EXT_RE.test(lines[i])) {
        body.push(lines[i].replace(QUOTE_EXT_RE, ''))
        i++
      }
      const k0 = key()
      const callout = parseCallout(body[0] ?? '')
      if (callout !== null) {
        out.push(
          renderCalloutExt(callout.kind, callout.title, body.slice(1), k0, baseLine + startLine, ctx, counter)
        )
        continue
      }
      /*
       * 普通引用:正文**按块再走一遍渲染**,和提示块同一个做法 —— 于是里面可以有列表、
       * 代码块、表格、嵌套引用。
       *
       * 从前这里是把整段当**行内**文本输出(靠 `.md-quote` 的 `white-space: pre-wrap`
       * 保留换行),块级写法因此原样露出来:`- 甲` 就是字面的「减号 + 甲」,``` 也是字面的
       * 三个反引号。而列表圆点是画在**内容盒左边**的(outside),引用那 12px 内边距根本
       * 不够它落脚,短横线看着就快贴到左边框上了。
       */
      out.push(
        <blockquote className="md-quote" key={k0} data-line={anchor(ctx, baseLine + startLine)}>
          {renderBlocks(body, `${k0}-q`, ctx, baseLine + startLine, counter)}
        </blockquote>
      )
      continue
    }

    if (line.trim() === '') {
      i++
      continue
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const startLine = i
      const block = parseTableBlock(lines, i)
      i = block === null ? i + 2 : block.to + 1
      if (block === null) continue
      out.push(
        <TableView
          key={key()}
          block={block}
          line={baseLine + startLine}
          ctx={ctx}
          k={keyPrefix}
          fenced={table?.fenced === true}
          width={table?.width ?? null}
          cols={table?.cols ?? null}
          rows={table?.rows ?? null}
        />
      )
      continue
    }

    const startLine = i
    const para: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStartExt(lines[i], lines[i + 1])) {
      para.push(lines[i++])
    }
    out.push(
      <p className="md-p" key={key()} data-line={anchor(ctx, baseLine + startLine)}>
        {renderInlineExt(parseInlineExt(para.join('\n'), 0, baseLine + startLine), key(), ctx)}
      </p>
    )
  }
  return out
}

function renderMarkdownExtended(src: string, keyPrefix: string, opts: MarkdownOptions): ReactNode[] {
  const ctx: ExtCtx = {
    anchors: opts.anchors === true,
    resolveImage: opts.resolveImage,
    onToggleTask: opts.onToggleTask,
    renderDiagram: opts.renderDiagram,
    highlight: opts.highlight,
    calloutLabel: opts.calloutLabel,
    resolveEmbed: opts.resolveEmbed,
    onResizeMedia: opts.onResizeMedia,
    onResizeEmbed: opts.onResizeEmbed,
    copyCodeLabel: opts.copyCodeLabel,
    body: src,
    onEditTable: opts.onEditTable,
    tableLabels: opts.tableLabels,
    lineAnchors: opts.lineAnchors === true
  }
  return renderBlocks(src.split('\n'), keyPrefix, ctx, 0, { k: 0 })
}
