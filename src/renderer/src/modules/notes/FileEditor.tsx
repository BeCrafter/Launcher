// 文件编辑器(CodeMirror):给文本 / 代码 / HTML / CSS / CSV 这类原文件用。
//
// 刻意**不挂**笔记编辑器那一套:没有 Markdown 块手柄、没有工具栏、没有粘贴图片、
// 没有自动补全 —— 这里编辑的是用户自己的源文件,不是应用托管的笔记。
// 只有三件事:语法高亮、行号、撤销;其余交给浏览器与 CodeMirror 默认键位。

import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from '@codemirror/view'
import { indentUnit, syntaxHighlighting } from '@codemirror/language'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { TOKEN_STYLE } from '../../lib/code-tokens'
import { languageForFile } from '../../lib/code-langs'

const FILE_THEME = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--text)',
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Noto Sans SC', monospace",
    fontSize: '13px',
    height: '100%',
    width: '100%'
  },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: 'inherit' },
  '.cm-content': { padding: '14px 0 120px', lineHeight: '1.6', caretColor: 'var(--accent2)' },
  '.cm-line': { padding: '0 18px 0 8px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent2)', borderLeftWidth: '2px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': {
    display: 'flex',
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--dim)'
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px', minWidth: '36px' },
  '.cm-activeLine': { backgroundColor: 'var(--wash-accent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--muted)' },
  '.cm-selectionLayer .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
    { backgroundColor: 'var(--wash-accent)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--wash-accent)' }
})

export function FileEditor({
  value,
  onChange,
  ext,
  name,
  wrap,
  readOnly = false
}: {
  value: string
  onChange: (v: string) => void
  ext: string
  name: string
  wrap: boolean
  readOnly?: boolean
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 外部回灌(重新加载 / 保存回写)才替换文档;用户输入不回灌,避免光标跳动
  const externalValue = useRef(value)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!hostRef.current) return
    const lang = languageForFile(ext, name)
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          keymap.of(defaultKeymap),
          keymap.of(historyKeymap),
          indentUnit.of('  '),
          EditorState.tabSize.of(4),
          syntaxHighlighting(TOKEN_STYLE),
          ...(lang !== null ? [lang] : []),
          ...(readOnly ? [EditorState.readOnly.of(true)] : []),
          ...(wrap ? [EditorView.lineWrapping] : []),
          FILE_THEME,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            externalValue.current = u.state.doc.toString()
            onChangeRef.current(externalValue.current)
          })
        ]
      })
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 语言/换行由父组件 key 触发重建;这里只挂载一次
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
    <div className="file-editor">
      <div ref={hostRef} className="file-editor-host" />
    </div>
  )
}
