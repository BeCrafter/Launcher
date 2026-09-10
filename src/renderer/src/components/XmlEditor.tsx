// XML 编辑器(CodeMirror 6;refactor-plan 已确认决策⑥)
// 主题贴近 demo xml-editor-wrap 配色(--code-bg 暗底/mono/细边框);visual diff 记对照表
import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { xml } from '@codemirror/lang-xml'

// demo 配色取样:--code-bg 暗底、高亮层 token 色(青键名/紫字串/绿数值)
const DEMO_THEME = EditorView.theme({
  '&': {
    backgroundColor: 'rgba(0,0,0,0.25)',
    color: '#e2e2f0',
    fontFamily: "'SF Mono', Menlo, monospace",
    fontSize: '11px',
    height: '100%'
  },
  '.cm-content': { caretColor: '#a78bfa', padding: '8px 0' },
  '.cm-scroller': { overflow: 'auto', lineHeight: '1.7' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(124,106,244,0.06)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(124,106,244,0.25)'
  },
  '.cm-keyword, .cm-tag': { color: '#45cbe0' },
  '.cm-atom': { color: '#3ecf8e' },
  '.cm-string': { color: '#c3a6ff' },
  '.cm-comment': { color: '#4f4f6e' }
})

export function XmlEditor({
  value,
  onChange,
  placeholder,
  bordered
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  bordered?: boolean
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
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

  return (
    <div className={'xml-editor-wrap' + (bordered ? ' bordered' : '')}>
      <div ref={hostRef} style={{ height: '100%' }} />
    </div>
  )
}
