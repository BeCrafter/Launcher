// 编辑器的**着色装饰**与提示块自动补全。
//
// ⚠ 这里只允许 `Decoration.mark`(给一段文字换个颜色/字重),**绝不允许 `Decoration.line`**。
//   行装饰会改变行高,而编辑区的定义性约束是「每一行严格等高、只有源码没有排版」——
//   见 NoteEditor.tsx 顶部那段说明与 styles.contract.test.ts 的契约。
//
// 为什么要自己加装饰:`@lezer/markdown` 只把一部分节点映射到了高亮 tag,
// 表格分隔符(`|---|`)、任务项的 `[ ]`、提示块的 `[!WARNING]` 都不在其列 ——
// 它们在源码里是一堆完全没上色的字符,和普通文字混在一起。

import {
  Decoration,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate
} from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { inCodeBlock } from '../../lib/editor-code-block'
import { scanWikilinksInLine } from '@shared/wikilinks'
import { parseListLine } from '../../lib/md-list-syntax'
import { CALLOUT_KINDS, type CalloutKind } from '../../lib/markdown'

/** 按语法树节点名给一段文字上色。值必须是在 notes.css 里有定义的 class */
const NODE_CLASS: Record<string, string> = {
  // 表格的分隔行(`|---|---|`)与单元格之间的竖线
  TableDelimiter: 'tk-meta',
  // 表头整行:加粗(字形,不改行高)
  TableHeader: 'tk-th',
  // 任务项的 `[ ]` / `[x]` —— 扫一眼就知道哪些还没做
  TaskMarker: 'tk-task'
}

function buildMarks(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const cls = NODE_CLASS[node.name]
        if (cls === undefined) return undefined
        // 语法树是按位置前序遍历的,所以 from 天然递增 —— RangeSetBuilder 要的就是这个
        builder.add(node.from, node.to, Decoration.mark({ class: cls }))
        return undefined
      }
    })
  }
  return builder.finish()
}

/** 表格分隔符 / 表头 / 任务标记的着色 */
export const syntaxMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildMarks(view)
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) this.decorations = buildMarks(u.view)
    }
  },
  { decorations: (v) => v.decorations }
)

/**
 * 宽松任务标记的着色:`- []` / `- [x]文字` / 有序任务。
 *
 * Lezer 只认 `[ ]` 后面还带空白的 TaskMarker,这几种写法在源码里没有颜色。
 * 补一层正则判据,range 与 `md-list-syntax` 的 taskFrom/taskTo 完全一致。
 */
function buildLenientTaskMarks(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const last = view.state.doc.lineAt(view.viewport.to).number
  let line = view.state.doc.lineAt(view.viewport.from)
  for (;;) {
    const syntax = parseListLine(line.text)
    if (syntax !== null && syntax.task && !syntax.canonical && !inCodeBlock(view, line.from)) {
      builder.add(
        line.from + syntax.taskFrom,
        line.from + syntax.taskTo,
        Decoration.mark({ class: 'tk-task' })
      )
    }
    if (line.number >= last) break
    line = view.state.doc.line(line.number + 1)
  }
  return builder.finish()
}

export const lenientTaskMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildLenientTaskMarks(view)
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) this.decorations = buildLenientTaskMarks(u.view)
    }
  },
  { decorations: (v) => v.decorations }
)

/**
 * 七级及以上标题(`####### ` … `########## `)的着色。
 *
 * CommonMark 只到 H6,Lezer 把 7 个 `#` 解析成段落 —— 语法树上没有 heading tag,
 * 而本项目自己的块模型与预览认到 H10。这里补一层正则,用与 H4–H6 相同的字形
 * (只改字重,不改行高)。
 */
const EXTRA_HEADING_RE = /^ {0,3}#{7,10}(?:[ \t]|$)/

function buildExtraHeadingMarks(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const last = view.state.doc.lineAt(view.viewport.to).number
  let line = view.state.doc.lineAt(view.viewport.from)
  for (;;) {
    if (EXTRA_HEADING_RE.test(line.text) && !inCodeBlock(view, line.from)) {
      builder.add(line.from, line.to, Decoration.mark({ class: 'tk-h4' }))
    }
    if (line.number >= last) break
    line = view.state.doc.line(line.number + 1)
  }
  return builder.finish()
}

export const extraHeadingMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildExtraHeadingMarks(view)
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) this.decorations = buildExtraHeadingMarks(u.view)
    }
  },
  { decorations: (v) => v.decorations }
)

/**
 * `[[wikilink]]` 的着色。
 *
 * 它不在 Lezer 的语法树里(Obsidian 扩展语法),与 `==高亮==` 一样只能自己扫。
 * 扫描规则复用共享模块 —— 编辑器上色的范围必须与预览渲染一致,
 * 否则同一个 `[[链接]]` 会「这里算、那里不算」。
 */
function buildNoteInlineMarks(view: EditorView): DecorationSet {
  const ranges: { from: number; to: number; cls: string }[] = []
  const last = view.state.doc.lineAt(view.viewport.to).number
  let line = view.state.doc.lineAt(view.viewport.from)
  for (;;) {
    if (!inCodeBlock(view, line.from)) {
      for (const link of scanWikilinksInLine(line.text)) {
        ranges.push({ from: line.from + link.from, to: line.from + link.to, cls: 'tk-wikilink' })
      }
    }
    if (line.number >= last) break
    line = view.state.doc.line(line.number + 1)
  }
  // 逐行扫描本身按位置递增,RangeSetBuilder 只收有序区间
  const builder = new RangeSetBuilder<Decoration>()
  for (const r of ranges) builder.add(r.from, r.to, Decoration.mark({ class: r.cls }))
  return builder.finish()
}

export const noteInlineMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildNoteInlineMarks(view)
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) this.decorations = buildNoteInlineMarks(u.view)
    }
  },
  { decorations: (v) => v.decorations }
)

/**
 * `==高亮==` 的着色(Obsidian 语法)。Lezer 不认,只能自己扫。
 * 只给**两个等号之间**的内容上底色 —— 定界符保持普通文字,与 `*粗体*` 的观感一致。
 */
const HIGHLIGHT_RE = /==(?!\s)([^=\n]+?)(?<!\s)==/g

function buildHighlightMarks(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const last = view.state.doc.lineAt(view.viewport.to).number
  let line = view.state.doc.lineAt(view.viewport.from)
  for (;;) {
    if (!inCodeBlock(view, line.from)) {
      for (const m of line.text.matchAll(HIGHLIGHT_RE)) {
        if (m.index === undefined) continue
        builder.add(
          line.from + m.index + 2,
          line.from + m.index + m[0].length - 2,
          Decoration.mark({ class: 'tk-hl' })
        )
      }
    }
    if (line.number >= last) break
    line = view.state.doc.line(line.number + 1)
  }
  return builder.finish()
}

export const highlightMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildHighlightMarks(view)
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) this.decorations = buildHighlightMarks(u.view)
    }
  },
  { decorations: (v) => v.decorations }
)

/**
 * 提示块标记 `[!WARNING]` 按类型上色。
 *
 * 用正则而不是语法树:markdown 语法把它解析成块引用里的一段**普通文字**,
 * 树上根本认不出这是什么。正则反而是这里唯一稳的判据。
 */
const calloutMatcher = new MatchDecorator({
  regexp: /\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/gi,
  decoration: (m) => Decoration.mark({ class: `tk-callout tk-callout-${m[1].toLowerCase()}` })
})

export const calloutMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = calloutMatcher.createDeco(view)
    }
    update(u: ViewUpdate): void {
      this.decorations = calloutMatcher.updateDeco(u, this.decorations)
    }
  },
  { decorations: (v) => v.decorations }
)

/**
 * 输入 `> ` 之后自动提示五种提示块。
 *
 * 触发条件是**当前行以 `>` 开头**且后面只有 `[!` 与字母 —— 这样普通引用、
 * 以及正文里出现的 `[!` 都不会误触发。
 */
export function calloutCompletion(label: (kind: CalloutKind) => string): (ctx: CompletionContext) => CompletionResult | null {
  return (ctx) => {
    const line = ctx.state.doc.lineAt(ctx.pos)
    const before = ctx.state.sliceDoc(line.from, ctx.pos)
    const m = /^(\s*>\s*)\[?!?[A-Za-z]*$/.exec(before)
    if (m === null) return null

    const options: Completion[] = CALLOUT_KINDS.map((kind) => {
      const marker = `[!${kind.toUpperCase()}]`
      return {
        label: marker,
        type: 'keyword',
        detail: label(kind),
        // 补完整段骨架:标记 + 换行 + 继续引用,用户接着打字就是正文
        apply: `${marker}\n> `
      }
    })
    return { from: line.from + m[1].length, options, validFor: /^\[?!?[A-Za-z]*$/ }
  }
}
