// 笔记正文编辑器(CodeMirror 6)。
//
// 结构照 components/XmlEditor.tsx:一次性 mount、Compartment 动态重配、ref 桥接 value/onChange
// 避免外部赋值把光标顶走。几处是笔记特有的:
//   · 任务项勾选由预览触发 → 走 toggleTaskAtLine 做**定点 dispatch**,撤销栈记得到(Cmd+Z 可用);
//   · 粘贴/拖入图片 → 落盘到 assets/ 后插入相对路径引用;
//   · 滚动位置对外暴露(topLine / scrollToLine),给预览的双向同步用。
//
// ⚠ **这是源码模式,不是所见即所得。** 编辑区只做两件事:等宽字体 + 语法着色。
//   任何改变**排版**的东西都不属于这里 —— 标题不放大、不加留白、代码块不加底色、
//   引用不加竖条、正文不限宽居中。理由:一旦行高开始参差,它读起来就是「一份渲染过的文档」,
//   而用户要的是「我在改源码」。渲染是右边预览区的事。
//   字形层面(加粗/斜体/删除线)是唯一保留的例外 —— 源码编辑器(VS Code、Obsidian 源码模式)
//   都这么做,而且它们不改变行高。
//   配色词表与预览共用(lib/code-tokens.ts),同一个 `const` 在两边是同一个颜色。

import { useEffect, useImperativeHandle, useMemo, useRef, type RefObject } from 'react'
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  Transaction,
  type Extension
} from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  highlightActiveLine,
  keymap,
  placeholder as placeholderExt,
  rectangularSelection
} from '@codemirror/view'
import { indentUnit, syntaxHighlighting, unfoldAll } from '@codemirror/language'
import { autocompletion, completionStatus } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { dataSource } from '../../data'
import { cleanIpcErrorMessage } from '../../lib/ipc-error'
import { encodeNoteAssetPath } from '../../lib/note-asset'
import { languageFor } from '../../lib/code-langs'
import { TOKEN_STYLE } from '../../lib/code-tokens'
import { inCodeBlock } from '../../lib/editor-code-block'
import { markdownFenceInput } from '../../lib/editor-fence'
import { setBlockAlign } from '../../lib/note-align'
import { planMarkdownContinuation } from '../../lib/md-list-continuation'
import { planQuoteExit } from '../../lib/md-quote-continuation'
import { indentMarkdownLines, listMarkerOf, listSyntaxAt, parseListLine } from '../../lib/md-list-syntax'
import { minimalTextChange, type TextChange } from '../../lib/text-change'
import { toggleTaskLine } from '../../lib/note-task'
import { showToast } from '../../lib/utils'
import { getCurrentLang, makeT } from '../../i18n'
import { calloutCompletion, calloutMarks, extraHeadingMarks, highlightMarks, lenientTaskMarks, noteInlineMarks, syntaxMarks } from './editor-marks'
import { wikilinkCompletion, type WikiTarget } from './note-completions'
import { applyWrap, suppressSelectionBubble } from '../../lib/note-marks'
import { findHighlights, setFindHighlights as setFindHighlightsEffect } from '../../lib/editor-find'
import type { FindMatch } from '../../lib/note-find'
import { markdownSelectionBubble } from '../../lib/editor-bubble'
import {
  markdownBlockFolding,
  markdownBlockHandles,
  moveBlockAtCaret,
  moveBlockByLocator,
  setPinnedLine
} from '../../lib/editor-blocks'
import type { MarkdownBlock } from '../../lib/markdown-blocks'
import type { BlockLocator, BlockMoveStatus, BlockMoveTarget } from '../../lib/block-move'
import type { CalloutKind } from '../../lib/markdown'
import {
  addTableColumn,
  addTableRow,
  readTableMeta,
  removeTableColumn,
  removeTableRow,
  setTableAlignInBody,
  setTableOptionsInBody,
  type TableAlign,
  type TableEdit
} from '../../lib/note-table-edit'

const t = (): ((k: string) => string) => makeT(getCurrentLang())

/**
 * 在 `at` 处插入一条分隔线(---),并按上下文补前后空行。
 * 否则 `---` 会粘进上一段变成 setext 标题,或者变成普通文本。
 * 工具栏与块菜单/插入弹窗共用这一份规则。
 */
function insertRuleAtPos(view: EditorView, at: number): void {
  const before = view.state.sliceDoc(0, at)
  const lead = before === '' ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const after = view.state.sliceDoc(at)
  const trail = after === '' ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  const block = `${lead}---${trail}`
  view.dispatch({
    changes: { from: at, insert: block },
    // 光标落到分隔线下一行(trail 一定以 \n 开头,或原文本本身就以空行开头)
    selection: { anchor: at + lead.length + 4 }
  })
  view.focus()
}

/**
 * 把整篇新文本写回编辑器,但只替换**变化的那一段**。
 *
 * 表格样式/行列操作都是「整篇纯函数 → 新正文」:直接整篇 dispatch 会把光标顶回 0、
 * 滚动位置也一起丢;取公共前后缀后只替换中间,CodeMirror 会照常映射选区与滚动,
 * 撤销栈里也仍然只记一次(Cmd+Z 能整体退回)。
 */
function applyDocText(view: EditorView, next: string): void {
  const change = minimalTextChange(view.state.doc.toString(), next)
  if (change === null) return
  view.dispatch({ changes: change })
}

/** 标题行前缀:已有 1–7 个 `#` 就整体替换,没有就直接加 */
const HEADING_LINE_RE = /^( {0,3})#{1,10}(?:[ \t]+|$)/

function headingLine(text: string, level: HeadingLevel): string {
  const match = HEADING_LINE_RE.exec(text)
  const indent = match?.[1] ?? ''
  const content = match === null ? text : text.slice(match[0].length)
  return `${indent}${'#'.repeat(level)} ${content}`
}

/**
 * 回车:接管上游不认的两类换行。
 *
 * 1. 空引用行上的回车:上游要连续两条空引用行才退出,这里第二次回车就把
 *    最内层 `>` 清掉,只留一个空行(嵌套引用一次退一层)。
 * 2. 宽松任务写法(`-[]` / `- []` / `- [x]文字` / 有序任务):规整当前行前缀并续出新任务。
 *
 * 规整/删除与插入新行放在同一个 transaction 里 —— 一次撤销回到输入前。
 * 其余情况返回 false,继续走 `insertNewlineContinueMarkup`。
 */
function continueMarkdownMarkup(view: EditorView): boolean {
  if (view.composing) return false
  if (view.state.selection.ranges.length !== 1) return false
  if (!view.state.selection.main.empty) return false
  if (completionStatus(view.state) === 'active') return false

  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  if (inCodeBlock(view, head)) return false

  const quoteExit = planQuoteExit(line.text, head - line.from)
  if (quoteExit !== null) {
    view.dispatch({
      changes: { from: line.from + quoteExit.from, to: line.from + quoteExit.to },
      selection: EditorSelection.cursor(line.from + quoteExit.caret),
      userEvent: 'input'
    })
    return true
  }

  const docLines: string[] = []
  for (let n = 1; n <= view.state.doc.lines; n += 1) docLines.push(view.state.doc.line(n).text)
  const plan = planMarkdownContinuation(line.text, head - line.from, docLines, line.number - 1)
  if (plan === null) return false

  const changes: { from: number; to: number; insert: string }[] = []
  if (plan.normalize !== undefined) {
    changes.push({
      from: line.from + plan.normalize.from,
      to: line.from + plan.normalize.to,
      insert: plan.normalize.insert
    })
  }
  if (plan.insert !== '') {
    changes.push({
      from: line.from + plan.insertAt,
      to: line.from + plan.insertAt,
      insert: plan.insert
    })
  }
  // lineOffset 相对**改之前**的当前行。续行是在行尾插入,不挪动后面那些行的位置。
  for (const item of plan.renumber ?? []) {
    const docLine = view.state.doc.line(line.number + item.lineOffset)
    changes.push({
      from: docLine.from + item.from,
      to: docLine.from + item.to,
      insert: item.insert
    })
  }
  view.dispatch({
    changes,
    selection: EditorSelection.cursor(line.from + plan.caret),
    userEvent: 'input'
  })
  return true
}

/**
 * 缩进一批行:每行做「整行纯函数 → 新行」,但只替换真正变化的那一段。
 * 整行替换会把行内光标映射到行首;最小 diff 让它留在原来的文字上。
 * 无序标记由**上一级列表项**决定(见 `indentMarkdownLines`);
 * 围栏 / 缩进代码块里的列表样文本只缩进、不换标记(那是代码,不是列表)。
 * 一次 dispatch:撤销只记一步,自动保存只触发一次。
 */
function applyIndent(view: EditorView, lineNumbers: Iterable<number>, dir: 'in' | 'out'): void {
  const doc = view.state.doc
  const lines: string[] = []
  for (let n = 1; n <= doc.lines; n += 1) lines.push(doc.line(n).text)

  // 调用方给的是 1-based 文档行号;代码块里的目标行只缩进、不换标记
  const targets = [...new Set(lineNumbers)].filter((n) => n >= 1 && n <= doc.lines)
  const skipMarker = new Set<number>()
  for (const n of targets) if (inCodeBlock(view, doc.line(n).from)) skipMarker.add(n - 1)

  const next = indentMarkdownLines(lines, targets.map((n) => n - 1), dir, 2, { skipMarker })
  if (next === null) return
  const changes: TextChange[] = []
  for (const [index, text] of next) {
    const line = doc.line(index + 1)
    const change = minimalTextChange(line.text, text, line.from)
    if (change !== null) changes.push(change)
  }
  if (changes.length > 0) view.dispatch({ changes, userEvent: 'input' })
}

/** 有选区(单行或多行)就整批增减一级缩进;始终消费按键。 */
function indentSelection(view: EditorView, dir: 'in' | 'out'): boolean {
  const { doc, selection } = view.state
  // 多光标时把每个光标覆盖的行并起来,同一行只改一次
  const lineNumbers = new Set<number>()
  for (const range of selection.ranges) {
    const first = doc.lineAt(range.from).number
    const last = doc.lineAt(range.to).number
    for (let n = first; n <= last; n += 1) lineNumbers.add(n)
  }
  applyIndent(view, lineNumbers, dir)
  return true
}

/** 普通段落:Tab 在光标处插入一级空格。 */
function insertSpacesAtCursor(view: EditorView, width: number): boolean {
  view.dispatch(view.state.replaceSelection(' '.repeat(width)), { userEvent: 'input' })
  return true
}

/** 普通段落:Shift+Tab 删掉光标前最多一级的空格(或一个 Tab)。 */
function removeSpacesBeforeCursor(view: EditorView, width: number): boolean {
  let changed = false
  const state = view.state
  const tr = state.changeByRange((range) => {
    if (!range.empty) return { range }
    const before = state.sliceDoc(Math.max(0, range.head - width), range.head)
    const match = /(?:\t| +)$/.exec(before)
    if (match === null) return { range }
    changed = true
    const from = range.head - match[0].length
    return {
      changes: { from, to: range.head, insert: '' },
      range: EditorSelection.cursor(from)
    }
  })
  if (changed) view.dispatch({ ...tr, userEvent: 'input' })
  return true
}

/**
 * Tab / Shift+Tab:编辑器内**始终消费**,焦点不再被移出到工具栏。
 * 列表项与代码块整行增减缩进(无序标记跟随上一级);普通段落改光标处的空格。
 * 输入法组合中与补全弹窗打开时不接管,避免抢掉它们的按键。
 */
function handleTab(view: EditorView, dir: 'in' | 'out'): boolean {
  if (view.composing) return false
  if (completionStatus(view.state) === 'active') return false
  const { doc, selection } = view.state
  if (selection.ranges.some((range) => !range.empty)) return indentSelection(view, dir)
  const head = selection.main.head
  const headLine = doc.lineAt(head)
  const docLines: string[] = []
  for (let n = 1; n <= doc.lines; n += 1) docLines.push(doc.line(n).text)
  // 顶格的 `a. 注意` 不是列表,Tab 插空格;缩进在字母档里的 `a.` 仍整行缩进
  if (inCodeBlock(view, head) || listSyntaxAt(docLines, headLine.number - 1) !== null) {
    return indentSelection(view, dir)
  }
  return dir === 'in' ? insertSpacesAtCursor(view, 2) : removeSpacesBeforeCursor(view, 2)
}

/**
 * 列编辑:多行选区时,在主光标所在列给每一行放一个光标。
 * 配合 `allowMultipleSelections` 后,输入 / 删除会同时作用于所有光标。
 */
function addColumnCursors(view: EditorView): boolean {
  const { doc, selection } = view.state
  if (selection.ranges.length !== 1) return false
  const main = selection.main
  const first = doc.lineAt(main.from)
  const last = doc.lineAt(main.to)
  if (first.number === last.number) return false

  // 列以**主光标所在行**为准:多行选区的头通常落在最后一行
  const column = main.head - doc.lineAt(main.head).from
  const ranges: ReturnType<typeof EditorSelection.cursor>[] = []
  for (let n = first.number; n <= last.number; n += 1) {
    const line = doc.line(n)
    ranges.push(EditorSelection.cursor(line.from + Math.min(column, line.length)))
  }
  view.dispatch({ selection: EditorSelection.create(ranges), userEvent: 'select' })
  view.focus()
  return true
}

/** 支持的标题层级。CommonMark 只到 6;7 是本项目自己的扩展(`####### `),与块模型/预览同一口径 */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

/** 块菜单 / 插入菜单 / 工具条共用的层级列表 */
export const HEADING_LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/** 三种列表写法。工具条的列表按钮与块菜单的列表样式共用 */
export type ListMarker = '- ' | '1. ' | '- [ ] '

/** 编辑器对外的命令式接口(预览勾选任务项、底部工具条排版按钮、滚动同步) */
export interface NoteEditorHandle {
  toggleTaskAtLine(line: number, next: boolean): void
  /** 在选区两侧包标记(如 `**`)。没有选区时插入标记并把光标放到中间 */
  wrapSelection(before: string, after?: string): void
  /** 给选中的每一行加前缀(如 `## ` / `- [ ] `);已有同样前缀则去掉(可切换) */
  prefixLines(prefix: string): void
  /** 在光标处插入整段文本,并把光标放到 `caretOffset` 处 */
  insertBlock(text: string, caretOffset?: number): void
  /** 在指定源码行插入文本并把光标放到插入内容内 */
  insertAtLine(line: number, text: string, caretOffset?: number): void
  /**
   * 在 doc 行 `line`（0 起，可传 doc.lines 表示文末）**之前**插入一个独立块:
   * 按需补空行、并用换行把原行推到下一行。text 为空 = 只插一个空行并放光标。
   * 块菜单「插入到下方」用它 —— 块的 `to` 指向下一个块的首行,直接 insertAtLine 会粘行。
   */
  insertBlockBefore(line: number, text: string, caretOffset?: number): void
  /** 将光标放到指定源码行 */
  focusLine(line: number): void
  /** 选中指定源码行范围(0 起,含首尾)。块菜单的格式化按钮先选中块再套用 */
  selectLines(from: number, to: number): void
  /** 删除包含首尾的源码行范围 */
  deleteLines(from: number, to: number): void
  /** 复制包含首尾的源码行范围 */
  duplicateLines(from: number, to: number): void
  /** 将指定行转换成 ATX 标题级别 */
  setHeadingLevel(line: number, level: HeadingLevel): void
  /** 把选中的每一行(没有选区就是当前行)设成指定标题级别 */
  setHeadingSelection(level: HeadingLevel): void
  /**
   * 把 `line` 所在的引用块首行换成指定样式:普通引用 ↔ 提示块。
   * `kind` 为 null 是普通引用;提示块换类型只换标记,普通引用升级时标记独占一行。
   * 作用于**块首行** —— 解析器只认块的第一行。
   */
  setQuoteStyle(line: number, kind: CalloutKind | null): void
  /**
   * 底部工具条的「引用样式」入口:`null` 是普通引用(切换 `> ` 前缀,同 `prefixLines`),
   * 有 kind 时先把选中的各行加成引用块(只加不切换),再对首行套提示块标记 ——
   * 与块菜单里「普通引用 → 提示块」走同一条升级路径(`setQuoteStyle`)。
   */
  applyQuote(kind: CalloutKind | null): void
  /** 把 `line` 行设成指定列表标记;已是该标记则取消(变回普通行),不同标记直接替换 */
  setListMarker(line: number, marker: ListMarker): void
  /**
   * 底部工具条的列表按钮:对选中的每一行(没有选区就是当前行)设成同一种列表样式。
   * 三种类型互斥 —— 已有列表行直接换标记而不是叠加;选中的行都已是该样式时统一取消。
   */
  setListStyle(marker: ListMarker): void
  /** 整行缩进/反缩进 2 空格(列表嵌套) */
  indentLine(line: number, dir: 'in' | 'out'): void
  /** 对选中的每一行(没有选区就是当前行)缩进/反缩进 2 空格;空行跳过 */
  indentBlock(dir: 'in' | 'out'): void
  /** 插入一个围栏块(图表 / 网页嵌入)。自动补围栏与前后空行 —— 光标在哪都不会和上一段粘在一起 */
  insertFence(lang: string, body: string): void
  /** 插入一条分隔线(---),自动补前后空行,保证它自成一块 */
  insertRule(): void
  /** 在指定**行首**插入分隔线(0 起;可传 doc.lines 表示文末) */
  insertRuleAt(line: number): void
  /** 整段替换若干行(含首尾)。图表的「编辑」走这里 —— 定点替换,能进撤销栈 */
  replaceLines(from: number, to: number, text: string): void
  /**
   * 把**选中的那几行**(没选区就是光标所在行)设成指定对齐。
   * `'left'` 等于去掉包裹 —— 左对齐就是 Markdown 的默认。
   */
  alignBlock(dir: 'left' | 'center' | 'right'): void
  /**
   * 单表样式:写/删 ````table 围栏选项(`border` / `color` / `head` / `fill` /
   * `width` / `layout`)。表格还没有围栏时就地包一层 —— 与预览里拖动改宽同一条规则。
   * `anchor` 是写回锚点(独立表格就是块起始行,引用里的表格由菜单反查);每次调用都会从
   * **当前正文**重新定位,菜单连续调多个选项也不会错位。
   */
  setTableOptions(anchor: number, opts: ReadonlyArray<readonly [string, string | null]>): void
  /** 整表列对齐;`null` = 去掉分隔行里的对齐标记 */
  setTableAlign(anchor: number, align: TableAlign): void
  /** 行列增删。`row` 0 = 表头,1..n = 正文行;按写回锚点定位 */
  editTable(anchor: number, edit: TableEdit, row: number): void
  /** 当前视口顶部的源行号(0 起) */
  topLine(): number
  /** 滚到指定行;小数部分在行内插值,同步时不会一跳一跳 */
  scrollToLine(line: number): void
  /** 清空当前会话的折叠状态(切换笔记/编辑模式时调用) */
  resetFolds(): void
  /** 滚动容器的可滚动余量,同步时用来判断「还能不能滚」 */
  scrollMetrics(): { top: number; max: number }
  /**
   * 当前选中的文本;**没有选区返回空串**。
   * 「引用到 AI」用它决定引整篇还是引这一段 —— 编辑区是源码,选中的就是原文,
   * 不需要任何转换。
   */
  selectionText(): string
  /** 主选区起点(光标偏移),查找面板用它决定从哪一处开始 */
  selectionOffset(): number
  /** 只更新查找高亮;不改选区、不滚动、不聚焦 */
  setFindHighlights(matches: readonly FindMatch[], active: number): void
  /** 选中某处匹配并居中滚动;不抢焦点(焦点留在查找框) */
  revealFindMatch(from: number, to: number): void
  /** 清掉查找高亮(关闭面板时) */
  clearFindMatches(): void
  /**
   * 替换一处并在同一个 transaction 里把选区落到下一处 —— 连续替换时不闪、不丢撤销。
   * `next` 由调用方按**替换后的文本**算好,坐标是新文档里的偏移。
   */
  replaceFindMatch(
    from: number,
    to: number,
    insert: string,
    next?: { from: number; to: number }
  ): void
  /** 「全部替换」:一批 changes 进同一个 transaction,一次 ⌘Z 整体退回 */
  replaceFindAll(changes: readonly { from: number; to: number; insert: string }[]): void
  /** 「移动到…」:按起始行 + 类型定位源块,在实时文档里重新解析后移动 */
  moveBlock(source: BlockLocator, target: BlockMoveTarget): BlockMoveStatus
  focus(): void
}

export interface NoteEditorBlockCallbacks {
  onBlockMenu?: (block: MarkdownBlock, anchor: DOMRect, line: number) => void
  onEmptyMenu?: (line: number, anchor: DOMRect) => void
}

// ── 主题 ──
//
// 源码模式的全部「版式」都在这里,一共三条:等宽字体、铺满、行高固定。
// 任何一条被打破(标题放大、给某类行加纵向留白、正文限宽居中),
// 编辑区就会开始像一份渲染过的文档 —— 那正是它不该有的样子。

const MD_THEME = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--text)',
    /*
     * 拉丁等宽 + 中文黑体。
     * 全等宽在 macOS 上做不到:中文等宽字体基本只有宋体类,深色背景上又细又碎。
     * 字体回退是**逐字符**的,所以 SF Mono 管英文与代码、Noto Sans SC 接管汉字,
     * 两边都不会被拉变形 —— Obsidian 的源码模式也是这个组合。
     */
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Noto Sans SC', monospace",
    fontSize: '13px',
    height: '100%',
    width: '100%'
  },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: 'inherit' },
  // 铺满编辑区,不限宽也不居中 —— 限宽居中那是文档版式,不是编辑器版式
  '.cm-content': {
    padding: '18px 0 200px',
    // 固定行高:所有行严格等高,代码块与标题都不例外
    lineHeight: '1.6',
    caretColor: 'var(--accent2)'
  },
  // 左边留出块手柄的位置:手柄是浮层、不占布局,所以这段留白全由这里的内边距撑着。
  // 60px = 胶囊 42 + 折叠三角 16 + 2px 间隙(飞书实测值),正文左边界对所有块恒定。
  '.cm-line': { padding: '0 22px 0 60px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent2)', borderLeftWidth: '2px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': { display: 'flex', backgroundColor: 'transparent', border: 'none' },
  '.cm-gutter': { backgroundColor: 'transparent' },
  '.cm-activeLine': { backgroundColor: 'var(--wash-accent)' },
  '.cm-selectionLayer .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
    { backgroundColor: 'var(--wash-accent)' },
  '.cm-placeholder': { color: 'var(--dim)', fontStyle: 'normal' }
})

const MD_EXTENSIONS: Extension[] = [
  // `base: markdownLanguage` 才带 GFM(表格 / 任务清单 / 删除线)。
  // 默认的 commonmarkLanguage **不认表格** —— 预览里渲染成表格、编辑区里却是一堆竖线。
  // codeLanguages:围栏里的代码在编辑器里也高亮,且与预览共用同一套 token 配色。
  markdown({ base: markdownLanguage, codeLanguages: (info) => languageFor(info) }),
  syntaxHighlighting(TOKEN_STYLE),
  // 语法树没覆盖到的那几处(表格分隔符 / 表头 / 任务标记)与提示块标记 ——
  // 只有着色,不改变行高,见 editor-marks.ts 顶部
  syntaxMarks,
  lenientTaskMarks,
  // CommonMark 只到 H6;H7–H10 由块模型/预览支持,语法树认不出,这里补字重;
  // `==高亮==` 同样不在语法树里
  extraHeadingMarks,
  highlightMarks,
  calloutMarks,
  // `[[笔记]]` 的着色(Obsidian 扩展语法,语法树里没有)
  noteInlineMarks,
  // 列选择 / 多光标:Option(Alt)+拖动是矩形选择,多光标输入天然同时生效。
  // 不开 allowMultipleSelections 的话,多选区会被折回单光标。
  EditorState.allowMultipleSelections.of(true),
  rectangularSelection(),
  crosshairCursor(),
  // 反引号:行首第三个自动补成对围栏;有选区时第一下包行内、第三下升级成围栏。
  // 代码块内部不介入(见 editor-fence.ts 顶部)。
  markdownFenceInput(),
  EditorView.lineWrapping
]

export function NoteEditor({
  value,
  docSession,
  onChange,
  handleRef,
  placeholder,
  onScroll,
  onBlockMenu,
  onEmptyMenu,
  pinnedLine,
  wikiTargets
}: {
  value: string
  /** 笔记 store 的 docSession:变化即「换了一篇文档」,复位滚动/选区/撤销栈 */
  docSession: number
  onChange: (v: string) => void
  handleRef?: RefObject<NoteEditorHandle | null>
  placeholder?: string
  /** 编辑器滚动。滚动同步由调用方接,编辑器本身不知道预览的存在 */
  onScroll?: () => void
  onBlockMenu?: (block: MarkdownBlock, anchor: DOMRect, line: number) => void
  onEmptyMenu?: (line: number, anchor: DOMRect) => void
  /**
   * 块菜单开着时把它钉在那一行:手柄**常显**、鼠标移进菜单也不收。
   * 菜单关闭（变回 null）后手柄交还给悬停控制。
   */
  pinnedLine?: number | null
  /** `[[` 补全的候选(笔记 id + 标题) */
  wikiTargets: readonly WikiTarget[]
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 外部 value 变化(切笔记 / 冲突用磁盘版本)→ 替换文档;内部输入不回灌(避免光标跳动)
  const externalValue = useRef(value)
  // 撤销栈挂在 compartment 里:换笔记时把它摘掉再挂回,新文档从空栈开始
  const historyComp = useMemo(() => new Compartment(), [])
  const lastSession = useRef(docSession)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // 补全候选随笔记库刷新;编辑器只挂载一次,所以走 ref —— 与 onChange 同一套路
  const wikiTargetsRef = useRef(wikiTargets)
  wikiTargetsRef.current = wikiTargets
  const onScrollRef = useRef(onScroll)
  onScrollRef.current = onScroll
  const onBlockMenuRef = useRef(onBlockMenu)
  onBlockMenuRef.current = onBlockMenu
  const onEmptyMenuRef = useRef(onEmptyMenu)
  onEmptyMenuRef.current = onEmptyMenu

  useImperativeHandle(
    handleRef,
    () => ({
      toggleTaskAtLine(line, next) {
        const view = viewRef.current
        if (!view) return
        if (!Number.isInteger(line) || line < 0 || line >= view.state.doc.lines) return
        const l = view.state.doc.line(line + 1) // CodeMirror 的行号是 1 起
        // 复用共享的纯函数:把单行当「第 0 行」传进去
        const updated = toggleTaskLine(l.text, 0, next)
        if (updated === null) return
        // 定点替换:只动这一行 —— history 记得到,且不会清空撤销栈(整体替换文档会)
        view.dispatch({ changes: { from: l.from, to: l.to, insert: updated } })
      },

      wrapSelection(before, after) {
        const view = viewRef.current
        if (view !== null) applyWrap(view, before, after)
      },

      prefixLines(prefix) {
        const view = viewRef.current
        if (!view) return
        const { from, to } = view.state.selection.main
        const first = view.state.doc.lineAt(from).number
        const last = view.state.doc.lineAt(to).number
        const changes: { from: number; to: number; insert: string }[] = []
        for (let n = first; n <= last; n++) {
          const line = view.state.doc.line(n)
          // 已经有同样前缀 → 去掉。按钮因此是「切换」而不是「越点越多」
          if (line.text.startsWith(prefix)) {
            changes.push({ from: line.from, to: line.from + prefix.length, insert: '' })
          } else {
            changes.push({ from: line.from, to: line.from, insert: prefix })
          }
        }
        view.dispatch({ changes })
        view.focus()
      },

      insertBlock(text, caretOffset) {
        const view = viewRef.current
        if (!view) return
        const at = view.state.selection.main.from
        view.dispatch({
          changes: { from: at, insert: text },
          selection: { anchor: at + (caretOffset ?? text.length) }
        })
        view.focus()
      },

      insertAtLine(line, text, caretOffset) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const n = Math.min(Math.max(line, 0), doc.lines - 1)
        const at = doc.line(n + 1).from
        view.dispatch({
          changes: { from: at, insert: text },
          selection: { anchor: at + Math.min(caretOffset ?? text.length, text.length) }
        })
        view.focus()
      },

      insertBlockBefore(line, text, caretOffset) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        // 允许 doc.lines = 文末
        const n = Math.min(Math.max(Math.trunc(line), 0), doc.lines)
        const at = n >= doc.lines ? doc.length : doc.line(n + 1).from
        const before = view.state.sliceDoc(0, at)
        // 与 insertFence / insertRule 同一口径:前面没有空行就补一个,保证新块自成一块。
        const lead = at === 0 ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
        // 只放光标时插一个新空行,并把光标放在它上面。为什么光标用 `at` 而不是 `at+1`:
        // 插入的 `\n` 占 [at, at+1),下一行的起点正是 `at`。
        const insert = text === '' ? '\n' : `${lead}${text}\n`
        const caret = text === '' ? at : at + lead.length + Math.min(caretOffset ?? text.length, text.length)
        if (insert !== '') view.dispatch({ changes: { from: at, insert } })
        view.dispatch({ selection: { anchor: caret } })
        view.focus()
      },

      focusLine(line) {
        const view = viewRef.current
        if (!view) return
        const n = Math.min(Math.max(line, 0), view.state.doc.lines - 1)
        view.dispatch({ selection: { anchor: view.state.doc.line(n + 1).from } })
        view.focus()
      },

      selectLines(from, to) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const a = Math.min(Math.max(from, 0), doc.lines - 1)
        const b = Math.min(Math.max(to, a), doc.lines - 1)
        const anchor = doc.line(a + 1).from
        const head = doc.line(b + 1).to
        // 块菜单「先选中整块再套格式」走这里 —— 这条 dispatch 会造出非空选区，
        // 打上注解免得菜单一关就弹出一条选区浮条
        view.dispatch({ selection: { anchor, head }, annotations: suppressSelectionBubble.of(true) })
        view.focus()
      },

      deleteLines(from, to) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const a = Math.min(Math.max(from, 0), doc.lines - 1)
        const b = Math.min(Math.max(to, a), doc.lines - 1)
        const start = doc.line(a + 1).from
        const end = b < doc.lines - 1 ? doc.line(b + 2).from : doc.length
        view.dispatch({ changes: { from: start, to: end, insert: '' }, selection: { anchor: start } })
        view.focus()
      },

      duplicateLines(from, to) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const a = Math.min(Math.max(from, 0), doc.lines - 1)
        const b = Math.min(Math.max(to, a), doc.lines - 1)
        const start = doc.line(a + 1).from
        const end = doc.line(b + 1).to
        const source = doc.sliceString(start, end)
        view.dispatch({
          changes: { from: end, insert: `\n${source}` },
          selection: { anchor: end + source.length + 1 }
        })
        view.focus()
      },

      setHeadingLevel(line, level) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const n = Math.min(Math.max(line, 0), doc.lines - 1)
        const current = doc.line(n + 1)
        const next = headingLine(current.text, level)
        view.dispatch({ changes: { from: current.from, to: current.to, insert: next }, selection: { anchor: current.from + next.length } })
        view.focus()
      },

      setHeadingSelection(level) {
        const view = viewRef.current
        if (!view) return
        const { doc, selection } = view.state
        const first = doc.lineAt(selection.main.from).number
        const last = doc.lineAt(selection.main.to).number
        const changes: { from: number; to: number; insert: string }[] = []
        for (let n = first; n <= last; n += 1) {
          const line = doc.line(n)
          const next = headingLine(line.text, level)
          if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next })
        }
        if (changes.length > 0) view.dispatch({ changes })
        view.focus()
      },

      setQuoteStyle(line, kind) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const n = Math.min(Math.max(line, 0), doc.lines - 1)
        const cur = doc.line(n + 1)
        const m = /^(\s*)>\s?(.*)$/.exec(cur.text)
        if (m === null) return
        const indent = m[1]
        const cm = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i.exec(m[2])
        const hasCallout = cm !== null
        const rest = cm !== null ? cm[2] : m[2]
        // 提示块标记只认块首行,调用方传的就是 block.from
        if (kind === null) {
          if (!hasCallout) return
          if (rest.trim() === '') {
            // 标记独占一行 → 整行删掉(含换行),后面的 > 行自然成为新块首
            if (n + 1 >= doc.lines) {
              view.dispatch({ changes: { from: cur.from, to: cur.to, insert: `${indent}>`.trimEnd() || '>' } })
            } else {
              view.dispatch({ changes: { from: cur.from, to: doc.line(n + 2).from, insert: '' } })
            }
          } else {
            view.dispatch({ changes: { from: cur.from, to: cur.to, insert: `${indent}> ${rest}` } })
          }
        } else {
          const tag = `> [!${kind.toUpperCase()}]`
          if (hasCallout) {
            view.dispatch({ changes: { from: cur.from, to: cur.to, insert: `${indent}${tag}${rest === '' ? '' : ` ${rest}`}` } })
          } else if (rest.trim() === '') {
            view.dispatch({ changes: { from: cur.from, to: cur.to, insert: `${indent}${tag}` } })
          } else {
            // 普通引用升级:标记独占一行,原文本下移一行 —— 与示例笔记的写法一致
            view.dispatch({ changes: { from: cur.from, to: cur.to, insert: `${indent}${tag}\n${indent}> ${rest}` } })
          }
        }
        view.focus()
      },

      applyQuote(kind) {
        const view = viewRef.current
        if (!view) return
        const { state } = view
        const { from, to, empty } = state.selection.main
        const first = state.doc.lineAt(from).number
        const last = state.doc.lineAt(to).number
        if (kind === null) {
          // 普通引用就是「切换 `> ` 前缀」,与原来按钮的行为完全一致
          this.prefixLines('> ')
          return
        }
        // 先把选中的各行加成引用块。**只加不切换**:这里的语义是「升级成提示块」,
        // 不是在普通引用和提示块之间摇摆 —— 已是引用的行原样保留
        const changes: { from: number; to: number; insert: string }[] = []
        for (let n = first; n <= last; n++) {
          const line = state.doc.line(n)
          if (!line.text.startsWith('> ')) {
            changes.push({ from: line.from, to: line.from, insert: '> ' })
          }
        }
        if (changes.length > 0) view.dispatch({ changes })
        // 再对块首行套提示块标记 —— 标记独占一行、原文本下移,与块菜单同一条路径
        const hadSelection = !empty
        this.setQuoteStyle(first - 1, kind)
        if (hadSelection) {
          // 恢复选区:标记插入会把首行加长,按标记后的行数夹一下再放回去
          const doc = view.state.doc
          const a = doc.line(Math.min(first, doc.lines)).from
          const b = doc.line(Math.min(last + 1, doc.lines)).to
          view.dispatch({ selection: { anchor: a, head: b }, annotations: suppressSelectionBubble.of(true) })
        }
        view.focus()
      },

      setListMarker(line, marker) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const n = Math.min(Math.max(line, 0), doc.lines - 1)
        const cur = doc.line(n + 1)
        const syntax = parseListLine(cur.text)
        if (syntax === null) {
          // 普通行:保留前导空白,把标记插在正文前
          const indent = /^[ \t]*/.exec(cur.text)?.[0] ?? ''
          const rest = cur.text.slice(indent.length)
          view.dispatch({ changes: { from: cur.from, to: cur.to, insert: `${indent}${marker}${rest}` } })
          view.focus()
          return
        }
        const head = `${syntax.quote}${syntax.indent}`
        const content = cur.text.slice(syntax.contentStart)
        const insert =
          listMarkerOf(cur.text) === marker ? `${head}${content}` : `${head}${marker}${content}`
        view.dispatch({ changes: { from: cur.from, to: cur.to, insert } })
        view.focus()
      },

      setListStyle(marker) {
        const view = viewRef.current
        if (!view) return
        const { from, to } = view.state.selection.main
        const first = view.state.doc.lineAt(from).number
        const last = view.state.doc.lineAt(to).number
        const lines: { from: number; to: number; text: string }[] = []
        for (let n = first; n <= last; n++) {
          const line = view.state.doc.line(n)
          // 空行不套列表标记:否则会在段落之间留下一堆看不见的空列表项
          if (line.text.trim() === '') continue
          lines.push({ from: line.from, to: line.to, text: line.text })
        }
        if (lines.length === 0) return
        // 全都已经是这一种 → 统一取消;否则统一设成这一种(不同列表类型直接替换)
        const toggleOff = lines.every((line) => listMarkerOf(line.text) === marker)
        const changes: { from: number; to: number; insert: string }[] = []
        for (const line of lines) {
          const syntax = parseListLine(line.text)
          let next: string
          if (syntax === null) {
            const indent = /^[ \t]*/.exec(line.text)?.[0] ?? ''
            const content = line.text.slice(indent.length)
            next = toggleOff ? line.text : `${indent}${marker}${content}`
          } else {
            const head = `${syntax.quote}${syntax.indent}`
            const content = line.text.slice(syntax.contentStart)
            next = toggleOff ? `${head}${content}` : `${head}${marker}${content}`
          }
          if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next })
        }
        if (changes.length === 0) return
        // 一次 dispatch:撤销只记一步,选区自动跟着位移
        view.dispatch({ changes })
        view.focus()
      },

      indentLine(line, dir) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const n = Math.min(Math.max(line, 0), doc.lines - 1)
        applyIndent(view, [n + 1], dir)
        view.focus()
      },

      indentBlock(dir) {
        const view = viewRef.current
        if (!view) return
        const { from, to } = view.state.selection.main
        const first = view.state.doc.lineAt(from).number
        const last = view.state.doc.lineAt(to).number
        const lineNumbers: number[] = []
        for (let n = first; n <= last; n++) lineNumbers.push(n)
        // 一次 dispatch 改所有行:撤销栈只记一步,选区由 CodeMirror 自动跟着位移
        applyIndent(view, lineNumbers, dir)
        view.focus()
      },

      insertFence(lang, body) {
        const view = viewRef.current
        if (!view) return
        const at = view.state.selection.main.from
        // 前后空行:Markdown 里围栏必须自成一块,否则会粘进上一段变成行内代码。
        // 已经在段首/文首就不重复补。
        const before = view.state.sliceDoc(0, at)
        const lead = before === '' ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
        const block = `${lead}\`\`\`${lang}\n${body.trim()}\n\`\`\`\n`
        view.dispatch({
          changes: { from: at, insert: block },
          selection: { anchor: at + block.length }
        })
        view.focus()
      },

      insertRule() {
        const view = viewRef.current
        if (view !== null) insertRuleAtPos(view, view.state.selection.main.from)
      },

      insertRuleAt(line) {
        const view = viewRef.current
        if (view === null) return
        const doc = view.state.doc
        // 允许传 doc.lines = 文末(块菜单的「在下方插入分隔线」会这么用)
        const n = Math.min(Math.max(Math.trunc(line), 0), doc.lines)
        insertRuleAtPos(view, n >= doc.lines ? doc.length : doc.line(n + 1).from)
      },

      replaceLines(from, to, text) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const a = Math.min(Math.max(from, 0), doc.lines - 1)
        const b = Math.min(Math.max(to, a), doc.lines - 1)
        const start = doc.line(a + 1).from
        const end = doc.line(b + 1).to
        view.dispatch({
          changes: { from: start, to: end, insert: text },
          selection: { anchor: start + text.length }
        })
        view.focus()
      },

      alignBlock(dir) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const { from, to } = view.state.selection.main
        const next = setBlockAlign(doc.toString(), doc.lineAt(from).number - 1, doc.lineAt(to).number - 1, dir)
        if (next === null) return
        // 整篇替换:CodeMirror 的 history 照常记得到,一次 Cmd+Z 就能整体撤销
        view.dispatch({ changes: { from: 0, to: doc.length, insert: next }, selection: { anchor: 0 } })
        view.focus()
      },

      setTableOptions(anchor, opts) {
        const view = viewRef.current
        if (!view) return
        const body = view.state.doc.toString()
        const meta = readTableMeta(body, anchor)
        if (meta === null) return
        const next = setTableOptionsInBody(
          body,
          { line: meta.line, to: meta.to, fenced: meta.fenced },
          opts
        )
        // 不 focus:菜单还开着,连续调边框/颜色/宽度时焦点不该被抢回编辑器
        if (next !== null) applyDocText(view, next)
      },

      setTableAlign(anchor, align) {
        const view = viewRef.current
        if (!view) return
        const body = view.state.doc.toString()
        const meta = readTableMeta(body, anchor)
        if (meta === null) return
        const next = setTableAlignInBody(body, meta.line, align)
        if (next !== null) applyDocText(view, next)
      },

      editTable(anchor, edit, row) {
        const view = viewRef.current
        if (!view) return
        const body = view.state.doc.toString()
        const meta = readTableMeta(body, anchor)
        if (meta === null) return
        // 点的是收尾围栏/表外行时夹到末行 —— 不要因为菜单开在块尾就什么都不做
        const r = Math.max(0, Math.min(row, meta.rows))
        let next: string | null = null
        if (edit === 'row-above') next = r > 0 ? addTableRow(body, meta.line, r - 1) : null
        else if (edit === 'row-below') next = addTableRow(body, meta.line, r)
        else if (edit === 'row-delete') next = r > 0 ? removeTableRow(body, meta.line, r) : null
        else if (edit === 'col-append') next = addTableColumn(body, meta.line, meta.cols - 1)
        else next = removeTableColumn(body, meta.line, meta.cols - 1)
        if (next !== null) applyDocText(view, next)
      },

      resetFolds() {
        const view = viewRef.current
        if (!view) return
        unfoldAll(view)
      },

      topLine() {
        const view = viewRef.current
        if (!view) return 0
        const box = view.scrollDOM.getBoundingClientRect()
        // 取视口顶端稍下一点的位置:正好在边界上时 posAtCoords 会返回 null
        const pos = view.posAtCoords({ x: box.left + 12, y: box.top + 2 })
        if (pos === null) return 0
        return view.state.doc.lineAt(pos).number - 1
      },

      scrollToLine(line) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const whole = Math.floor(line)
        const n = Math.min(Math.max(whole, 0), doc.lines - 1)
        const block = view.lineBlockAt(doc.line(n + 1).from)
        view.scrollDOM.scrollTop = block.top + (line - whole) * block.height
      },

      scrollMetrics() {
        const el = viewRef.current?.scrollDOM
        if (!el) return { top: 0, max: 0 }
        return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight }
      },

      selectionText() {
        const view = viewRef.current
        if (!view) return ''
        const { from, to } = view.state.selection.main
        // 光标(空选区)不算选中:那会让「引用整篇」变成「引用 0 个字」
        return from === to ? '' : view.state.sliceDoc(from, to)
      },

      selectionOffset() {
        return viewRef.current?.state.selection.main.from ?? 0
      },

      setFindHighlights(matches, active) {
        viewRef.current?.dispatch({
          effects: setFindHighlightsEffect.of({ matches, active })
        })
      },

      revealFindMatch(from, to) {
        const view = viewRef.current
        if (!view) return
        view.dispatch({
          selection: { anchor: from, head: to },
          effects: EditorView.scrollIntoView(from, { y: 'center' }),
          annotations: suppressSelectionBubble.of(true)
        })
      },

      clearFindMatches() {
        viewRef.current?.dispatch({
          effects: setFindHighlightsEffect.of({ matches: [], active: -1 })
        })
      },

      replaceFindMatch(from, to, insert, next) {
        const view = viewRef.current
        if (!view) return
        view.dispatch({
          changes: { from, to, insert },
          selection: next === undefined ? undefined : { anchor: next.from, head: next.to },
          effects: next === undefined ? undefined : EditorView.scrollIntoView(next.from, { y: 'center' }),
          annotations: next === undefined ? undefined : suppressSelectionBubble.of(true)
        })
      },

      replaceFindAll(changes) {
        const view = viewRef.current
        if (!view || changes.length === 0) return
        view.dispatch({ changes: changes.map((change) => ({ ...change })) })
      },

      moveBlock(source, target) {
        const view = viewRef.current
        if (!view) return 'invalid'
        const status = moveBlockByLocator(view, source, target)
        // 选择器关闭后焦点回到正文:否则后续键盘输入会落到 body。
        // invalid 时面板还开着,不能把焦点从搜索框抢走。
        if (status !== 'invalid') view.focus()
        return status
      },

      focus() {
        viewRef.current?.focus()
      }
    }),
    []
  )

  useEffect(() => {
    if (!hostRef.current) return

    /** 粘贴/拖入的图片 → 落盘到 assets/,在光标处插入相对路径引用 */
    async function insertImages(view: EditorView, files: File[]): Promise<void> {
      for (const f of files) {
        try {
          const data = await f.arrayBuffer()
          const { relPath } = await dataSource().notes.saveAsset({
            fileName: f.name !== '' ? f.name : 'pasted.png',
            data
          })
          const at = view.state.selection.main.from
          // 编码后再写:CommonMark 的链接地址不允许裸空格,而附件名是
          // `Pasted image 20261009150211.png`。编码一次 Obsidian 与 GitHub 都能开,
          // 解析侧两种写法都收,所以用户手写的旧引用照样渲染。
          const snippet = `![](${encodeNoteAssetPath(relPath)})`
          view.dispatch({
            changes: { from: at, insert: snippet },
            selection: { anchor: at + snippet.length }
          })
        } catch (err) {
          showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
        }
      }
    }

    const imagesOf = (dt: DataTransfer | null): File[] =>
      dt === null ? [] : [...dt.files].filter((f) => f.type.startsWith('image/'))

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          MD_EXTENSIONS,
          // 块手柄是一个**浮动浮层**（不是 gutter）：整区只有一个，鼠标换行时它会滑过去
          markdownBlockHandles({
            onBlockMenu: (block, anchor, line) => onBlockMenuRef.current?.(block, anchor, line),
            onEmptyMenu: (line, anchor) => onEmptyMenuRef.current?.(line, anchor)
          }),
          markdownBlockFolding(),
          // 选中文字时浮出的小工具条（有选区时块手柄自己让位）
          markdownSelectionBubble(),
          // 查找匹配的底色（面板派发 effect 才出现，平时是空集）
          findHighlights,
          // 输入 `> ` 提示五种提示块;`[[` 提示笔记。
          // 候选从 ref 读 —— 编辑器只挂载一次,笔记库刷新后闭包仍拿得到新数组
          autocompletion({
            override: [
              calloutCompletion((kind) => t()(`notes.callout.${kind}`)),
              wikilinkCompletion(() => wikiTargetsRef.current)
            ]
          }),
          indentUnit.of('  '),
          historyComp.of(history()),
          drawSelection(),
          highlightActiveLine(),
          keymap.of(defaultKeymap),
          keymap.of(historyKeymap),
          // 排版快捷键:与底部工具条按钮的 tooltip 一一对应。
          // 只挑三个不会与系统/CodeMirror 默认键位打架的(Mod-e 是 macOS 的「用所选内容查找」,不碰)
          keymap.of([
            { key: 'Mod-b', run: (v) => { applyWrap(v, '**'); return true } },
            { key: 'Mod-i', run: (v) => { applyWrap(v, '*'); return true } },
            { key: 'Mod-k', run: (v) => { applyWrap(v, '[', '](https://)'); return true } }
          ]),
          // 块级移动覆盖 CodeMirror 默认的「按行上移/复制」—— 按行移动会把表格、
          // 围栏和列表拆坏。是可拖动块就消费按键,到边界也不退回按行移动。
          Prec.high(
            keymap.of([
              { key: 'Alt-ArrowUp', run: (v) => moveBlockAtCaret(v, 'up', 'sibling') },
              { key: 'Alt-ArrowDown', run: (v) => moveBlockAtCaret(v, 'down', 'sibling') },
              { key: 'Shift-Alt-ArrowUp', run: (v) => moveBlockAtCaret(v, 'up', 'cross-section') },
              { key: 'Shift-Alt-ArrowDown', run: (v) => moveBlockAtCaret(v, 'down', 'cross-section') }
            ])
          ),
          // 最高优先级:只接管上游不认的宽松任务回车、批量缩进、同列光标;
          // 其余情况返回 false,原样落回 CodeMirror 的默认键位。
          Prec.highest(
            keymap.of([
              { key: 'Enter', run: continueMarkdownMarkup },
              {
                key: 'Tab',
                run: (v) => handleTab(v, 'in'),
                shift: (v) => handleTab(v, 'out')
              },
              { key: 'Mod-Alt-c', run: addColumnCursors }
            ])
          ),
          EditorView.domEventHandlers({
            paste: (e, v) => {
              const files = imagesOf(e.clipboardData)
              if (files.length === 0) return false // 普通文本粘贴照旧交给 CodeMirror
              e.preventDefault()
              void insertImages(v, files)
              return true
            },
            drop: (e, v) => {
              const files = imagesOf(e.dataTransfer)
              if (files.length === 0) return false
              e.preventDefault()
              void insertImages(v, files)
              return true
            }
          }),
          MD_THEME,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            const next = u.state.doc.toString()
            // 与已知的外部值相同 = 这是值同步 effect 的整篇回灌,不是用户输入。
            // 不挡住的话,光是打开一篇笔记就会把它标脏、900ms 后回写一次。
            if (next === externalValue.current) return
            externalValue.current = next
            onChangeRef.current(next)
          }),
          EditorView.domEventHandlers({
            scroll: () => {
              onScrollRef.current?.()
              return false
            }
          }),
          placeholder !== undefined && placeholder !== '' ? placeholderExt(placeholder) : []
        ].flat()
      })
    })
    viewRef.current = view

    // Escape 会让 CodeMirror 进入 2 秒「Tab 交给浏览器」的无障碍模式;它在 keymap
    // **之前**就 return,于是列表里的 Tab 不缩进、焦点反而跑到工具栏。
    // 在祖先节点(不是 contentDOM)的 capture 阶段退出该模式,让最高优先级的
    // Tab keymap 拿到同一个事件;输入法组合中与补全弹窗打开时不干预。
    const onTabKeyDownCapture = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
      if (view.composing || completionStatus(view.state) === 'active') return
      view.setTabFocusMode(false)
    }
    view.dom.addEventListener('keydown', onTabKeyDownCapture, true)

    return () => {
      view.dom.removeEventListener('keydown', onTabKeyDownCapture, true)
      view.destroy()
      viewRef.current = null
    }
    // 仅挂载一次;value/onChange 经 ref 桥接
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const switched = lastSession.current !== docSession
    lastSession.current = docSession

    if (switched) {
      /*
       * 换了一篇:整篇换成新文档,同时**复位光标、滚动与撤销栈**。
       * 不这么做的话,新笔记会停在上一篇的滚动位置,`Cmd+Z` 还能把上一篇的内容带回来。
       * 用 docSession 而不是 note id 判:改名也会让 id 变,但那还是同一篇文档。
       */
      externalValue.current = value
      if (value !== view.state.doc.toString()) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
          selection: { anchor: 0 },
          // 整篇替换不算一次「编辑」,不进撤销栈
          annotations: Transaction.addToHistory.of(false),
          effects: historyComp.reconfigure([])
        })
      } else {
        view.dispatch({
          selection: { anchor: 0 },
          effects: historyComp.reconfigure([])
        })
      }
      // 摘掉再挂回 history:它的状态字段被丢弃,新文档从空栈开始
      view.dispatch({ effects: historyComp.reconfigure(history()) })
      view.scrollDOM.scrollTop = 0
      return
    }

    if (value !== externalValue.current) {
      externalValue.current = value
      /*
       * ⚠ 整篇替换会把**光标与滚动位置一起挤到开头** —— 然后滚动联动把预览也拖到顶部。
       * 触发路径很日常:在预览里拖完表格列宽 → 回写换掉正文 → 这里整篇替换 → 编辑区跳到顶部
       * → `onEditorScroll` → 预览跟着跳。用户报过:「编辑+预览模式下拖完表格,页面回到最上面」。
       * 所以替换前后把这两样按原样放回去(长度变了就夹一下)。
       */
      const prevTop = view.scrollDOM.scrollTop
      const sel = view.state.selection.main
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
      const len = view.state.doc.length
      view.dispatch({
        selection: { anchor: Math.min(sel.anchor, len), head: Math.min(sel.head, len) }
      })
      view.scrollDOM.scrollTop = prevTop
    }
  }, [value, docSession, historyComp])

  // 块菜单开着 → 手柄钉在那一行（菜单不关，它就不收）
  useEffect(() => {
    const view = viewRef.current
    if (view !== null) setPinnedLine(view, pinnedLine ?? null)
  }, [pinnedLine])

  return <div className="note-editor-host" ref={hostRef} />
}
