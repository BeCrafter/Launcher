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
