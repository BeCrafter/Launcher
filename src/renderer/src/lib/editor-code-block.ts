// 编辑器里「这个位置算不算代码块」的唯一判据。
//
// 回车续行、Tab 缩进、反引号自动成对、宽松任务着色都要问同一个问题:
// 光标是不是在围栏(` ``` ` / `~~~`)或缩进代码块里?在里面的内容不该被 Markdown
// 自动化改写 —— 那只是代码正文。判据以前抄了三份,漂一次就会一边着色、一边续行,
// 所以集中到这里。

import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

function nodeIn(state: EditorState, pos: number, names: readonly string[]): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1)
  for (; node !== null; node = node.parent) {
    if (names.includes(node.name)) return true
  }
  return false
}

/**
 * `EditorState` 版本:补全源只拿得到 state(没有 view),判据必须能脱离 view 使用。
 */
export function inCodeBlockState(state: EditorState, pos: number): boolean {
  return nodeIn(state, pos, ['FencedCode', 'CodeBlock'])
}

export function inInlineCodeState(state: EditorState, pos: number): boolean {
  return nodeIn(state, pos, ['InlineCode'])
}

/** 光标是否落在围栏 / 缩进代码块里 —— 这些位置的回车、Tab、反引号原样交给 CodeMirror。 */
export function inCodeBlock(view: EditorView, pos: number): boolean {
  return inCodeBlockState(view.state, pos)
}

/** 光标是否落在**行内代码**里(反引号内)。里面的字符是字面量,行内格式套不进去。 */
export function inInlineCode(view: EditorView, pos: number): boolean {
  return inInlineCodeState(view.state, pos)
}
