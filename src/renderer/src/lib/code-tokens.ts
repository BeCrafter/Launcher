// 代码高亮的词表 —— 编辑器(CodeMirror)与预览(自渲染)共用同一套 class。
//
// 为什么必须共用:两边各写一套配色,同一个 `const` 在编辑器里是紫的、在预览里是蓝的,
// 用户一按模式切换就觉得「这俩不是一个东西」。共用词表后改配色只改 CSS 一处。
//
// 能共用是因为 CodeMirror 的两个接口刚好对得上:
//   · `HighlightStyle.define` 允许直接给 `class`(而不是内联样式);
//   · `highlightCode()` 接收任何实现了 Highlighter 接口的对象,而 HighlightStyle 本身就是。
// 于是同一个对象既装进编辑器,也驱动预览的 token 切分,不需要两套映射表。
//
// ⚠ 预览侧用的是 highlightCode(产**文本片段 + class**),不是 highlightTree(产 HTML 字符串)。
//   后者会逼出 dangerouslySetInnerHTML,把 markdown.tsx 的核心保证拆掉。

import { HighlightStyle } from '@codemirror/language'
import { tags, type Tag } from '@lezer/highlight'

export interface TokenStyle {
  tag: Tag | readonly Tag[]
  class: string
}

/**
 * 顺序有意义:`tagHighlighter` 里**越靠后**的规则优先级越高(后定义的覆盖先定义的)。
 * 所以先写宽泛的(punctuation/name),再写具体的(function(...) / definition(...))。
 */
export const TOKEN_STYLES: readonly TokenStyle[] = [
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], class: 'tk-comment' },
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword], class: 'tk-keyword' },
  { tag: [tags.string, tags.special(tags.string), tags.docString], class: 'tk-string' },
  { tag: [tags.number, tags.integer, tags.float], class: 'tk-number' },
  { tag: [tags.bool, tags.null, tags.atom, tags.unit], class: 'tk-atom' },
  { tag: [tags.regexp], class: 'tk-regexp' },
  { tag: [tags.escape], class: 'tk-escape' },
  { tag: [tags.color, tags.constant(tags.name)], class: 'tk-constant' },
  { tag: [tags.url], class: 'tk-url' },
  { tag: [tags.propertyName], class: 'tk-prop' },
  { tag: [tags.attributeName], class: 'tk-attr' },
  { tag: [tags.tagName], class: 'tk-tag' },
  { tag: [tags.typeName, tags.className, tags.namespace], class: 'tk-type' },
  { tag: [tags.labelName, tags.macroName], class: 'tk-label' },
  { tag: [tags.operator, tags.updateOperator, tags.definitionOperator], class: 'tk-op' },
  { tag: [tags.meta, tags.annotation, tags.processingInstruction], class: 'tk-meta' },
  { tag: [tags.invalid], class: 'tk-invalid' },
  { tag: [tags.heading, tags.heading1], class: 'tk-h1' },
  { tag: [tags.heading2], class: 'tk-h2' },
  { tag: [tags.heading3], class: 'tk-h3' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], class: 'tk-h4' },
  { tag: [tags.strong], class: 'tk-strong' },
  { tag: [tags.emphasis], class: 'tk-em' },
  { tag: [tags.strikethrough], class: 'tk-del' },
  { tag: [tags.link], class: 'tk-link' },
  { tag: [tags.monospace], class: 'tk-code' },
  { tag: [tags.quote], class: 'tk-quote' },
  { tag: [tags.list], class: 'tk-list' },
  { tag: [tags.contentSeparator], class: 'tk-hr' },
  // 具体函数/定义名放最后:它们是修饰 tag,应当压过上面的 variableName / name
  { tag: [tags.variableName, tags.name], class: 'tk-name' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.variableName)], class: 'tk-fn' },
  { tag: [tags.standard(tags.variableName), tags.standard(tags.propertyName)], class: 'tk-builtin' },
  { tag: [tags.local(tags.variableName)], class: 'tk-local' }
]

/**
 * 编辑器用。`class` 形式意味着这里不产任何内联样式 ——
 * 所有颜色都来自 styles/notes.css 里以 `--syn-*` 为源的那一组规则。
 */
export const TOKEN_STYLE: HighlightStyle = HighlightStyle.define(
  TOKEN_STYLES.map((s) => ({ tag: s.tag, class: s.class }))
)
