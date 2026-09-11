// XML 编辑器(CodeMirror 6;refactor-plan 已确认决策⑥)
// 高亮 token 色对齐 demo 高亮层(标签青/声明紫/注释 dim,正文 muted);换行行为对齐 demo(textarea pre-wrap)
// 缩进随设置 xmlIndent(Compartment 动态重配,不必重建编辑器)
import { useEffect, useRef } from 'react'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, keymap } from '@codemirror/view'
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { xml } from '@codemirror/lang-xml'
import type { XmlIndent } from '@shared/settings'

// demo 配色(base.css .xml-hl-*):tag=--cyan、decl=--accent2、comment=--dim,正文=--muted
const DEMO_HIGHLIGHT = HighlightStyle.define([
  { tag: [tags.tagName, tags.angleBracket, tags.attributeName, tags.attributeValue], color: 'var(--cyan)' },
  { tag: tags.processingInstruction, color: 'var(--accent2)' },
  { tag: tags.comment, color: 'var(--dim)' }
])

const DEMO_THEME = EditorView.theme({
  '&': {
    // 背景透明对齐 demo textarea(容器底色透出);bordered 模态场景由 .xml-editor-wrap.bordered 的 var(--code-bg) 提供
    backgroundColor: 'transparent',
    color: 'var(--muted)',
    fontFamily: "'SF Mono', Menlo, monospace",
    fontSize: '11px',
    height: '100%',
    width: '100%'
  },
  '.cm-content': { padding: '14px 0', lineHeight: '1.7' },
  // drawSelection 接管光标渲染(原生 caret 被其 transparent !important 隐藏)→ 光标色由 .cm-cursor 描边决定
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--cyan)' },
  '.cm-line': { padding: '0 14px' },
  '.cm-scroller': { overflow: 'auto' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--wash-accent)' },
  // 选择器与 CM6 baseTheme 的 &light.cm-focused > … 同特异性(5 类),排在 baseTheme 之后生效
  '.cm-selectionLayer .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
    { backgroundColor: 'var(--wash-accent)' }
  // token 色全部由 DEMO_HIGHLIGHT 的 CSS 变量输出(--cyan/--accent2/--dim),不再写死深浅单主题色
})

function indentExtensions(indent: XmlIndent): Extension[] {
  return indent === 'tab'
    ? [indentUnit.of('\t'), EditorState.tabSize.of(4)]
    : [indentUnit.of(' '.repeat(Number(indent)))]
}

export function XmlEditor({
  value,
  onChange,
  placeholder,
  bordered,
  indent = '2'
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  bordered?: boolean
  indent?: XmlIndent
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const indentComp = useRef(new Compartment()).current
  const indentRef = useRef(indent)
  // 外部 value 变化(如导入预填)→ 替换文档;内部输入不回灌(避免光标跳动)
  const externalValue = useRef(value)

  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          xml(),
          syntaxHighlighting(DEMO_HIGHLIGHT),
          EditorView.lineWrapping, // demo textarea 默认 soft wrap
          drawSelection(), // 选区走 .cm-selectionBackground(主题 wash 变量),不用系统默认蓝
          highlightActiveLine(), // 当前行浅底(.cm-activeLine),深浅主题一致的行指示
          indentComp.of(indentExtensions(indentRef.current)),
          history(),
          keymap.of(defaultKeymap),
          keymap.of(historyKeymap),
          DEMO_THEME,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              externalValue.current = u.state.doc.toString()
              onChange(externalValue.current)
            }
          }),
          placeholder
            ? EditorView.contentAttributes.of({ 'data-placeholder': placeholder })
            : []
        ].flat()
      })
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 仅挂载一次;value/onChange 经 ref 桥接
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value !== externalValue.current) {
      externalValue.current = value
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    }
  }, [value])

  // 缩进设置变更 → 动态重配(不动文档,无光标丢失)
  useEffect(() => {
    if (indentRef.current === indent) return
    indentRef.current = indent
    viewRef.current?.dispatch({ effects: indentComp.reconfigure(indentExtensions(indent)) })
  }, [indent, indentComp])

  return (
    <div className={'xml-editor-wrap' + (bordered ? ' bordered' : '')}>
      <div ref={hostRef} style={{ flex: 1, minWidth: 0, height: '100%', position: 'relative' }} />
    </div>
  )
}
