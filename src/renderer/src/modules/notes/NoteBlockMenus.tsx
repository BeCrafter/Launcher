import { useEffect, useRef, type RefObject } from 'react'
import { useT } from '../../hooks/useT'
import { tableSkeleton } from '../../lib/note-table'
import { showToast } from '../../lib/utils'
import type { MarkdownBlock } from '../../lib/markdown-blocks'
import { CALLOUT_ICON, CALLOUT_KINDS, parseCallout, type CalloutKind } from '../../lib/markdown'
import type { NoteEditorHandle } from './NoteEditor'

interface MenuAnchor {
  left: number
  top: number
  right: number
  bottom: number
}

function menuStyle(anchor: MenuAnchor, width: number, height: number): React.CSSProperties {
  return {
    left: Math.max(8, Math.min(anchor.right + 8, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(anchor.top, window.innerHeight - height - 8))
  }
}

function iconOf(block: MarkdownBlock): { icon?: string; text?: string } {
  if (block.kind === 'heading') return { text: `H${block.level}` }
  switch (block.kind) {
    case 'fence': return { icon: 'fa-code' }
    case 'table': return { icon: 'fa-table' }
    case 'list': return { icon: 'fa-list-ul' }
    case 'quote': return { icon: 'fa-quote-left' }
    case 'callout': return { icon: 'fa-comment-dots' }
    case 'details': return { icon: 'fa-caret-square-down' }
    case 'thematicBreak': return { icon: 'fa-minus' }
    case 'paragraph': return { icon: 'fa-paragraph' }
    default: return { icon: 'fa-align-left' }
  }
}

function useDismiss(onClose: () => void, ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onPointer = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, ref])
}

interface FormatAction {
  id: string
  icon: string
  labelKey: string
  run: (h: NoteEditorHandle) => void
}

/** 与底部工具栏同源的排版动作 —— 点击时先选中块内容再套用 */
const BLOCK_FORMATS: FormatAction[] = [
  { id: 'bold', icon: 'fa-bold', labelKey: 'notes.fmt.bold', run: (h) => h.wrapSelection('**') },
  { id: 'italic', icon: 'fa-italic', labelKey: 'notes.fmt.italic', run: (h) => h.wrapSelection('*') },
  { id: 'code', icon: 'fa-code', labelKey: 'notes.fmt.code', run: (h) => h.wrapSelection('`') },
  { id: 'link', icon: 'fa-link', labelKey: 'notes.fmt.link', run: (h) => h.wrapSelection('[', '](https://)') },
  { id: 'heading', icon: 'fa-heading', labelKey: 'notes.fmt.heading', run: (h) => h.prefixLines('## ') },
  { id: 'list', icon: 'fa-list-ul', labelKey: 'notes.fmt.list', run: (h) => h.prefixLines('- ') },
  { id: 'task', icon: 'fa-square-check', labelKey: 'notes.fmt.task', run: (h) => h.prefixLines('- [ ] ') },
  { id: 'quote', icon: 'fa-quote-left', labelKey: 'notes.fmt.quote', run: (h) => h.prefixLines('> ') }
]

export function NoteBlockMenu({
  block,
  line,
  body,
  anchor,
  handleRef,
  onClose,
  onInsertBelow,
  onDiagram,
  onEmbed
}: {
  block: MarkdownBlock
  /** 打开菜单的那一行(块内每行都有按钮) —— 行级操作作用于它 */
  line: number
  body: string
  anchor: MenuAnchor
  handleRef: RefObject<NoteEditorHandle | null>
  onClose: () => void
  onInsertBelow: (line: number) => void
  onDiagram: (line: number) => void
  onEmbed: (line: number) => void
}): React.JSX.Element {
  const t = useT()
  const ref = useRef<HTMLDivElement | null>(null)
  useDismiss(onClose, ref)
  const icon = iconOf(block)
  const lines = body.split('\n')
  // 当前引用样式:块首行剥掉 `> ` 后认提示块标记;认不出就是普通引用
  const quoteFirst = (lines[block.from] ?? '').replace(/^\s*>\s?/, '')
  const currentCallout = block.kind === 'quote' || block.kind === 'callout' ? parseCallout(quoteFirst)?.kind ?? null : null
  // 当前行的列表标记(缩进保留,只看标记段)
  const lineText = lines[line] ?? ''
  const markerMatch = /^(\s*)(?:[-+*] |\d+[.)] |[-+*] \[[ xX]\] )?/.exec(lineText)
  const currentMarker = (markerMatch?.[0].slice(markerMatch[1].length) ?? '') as '- ' | '1. ' | '- [ ] ' | ''
  const copy = (): void => {
    const text = lines.slice(block.from, block.contentTo).join('\n')
    void navigator.clipboard?.writeText(text)
    showToast(t('notes.blockMenu.copied'), '#4ade80', 'fa-copy')
    onClose()
  }
  const action = (run: () => void): void => {
    run()
    onClose()
  }
  /** 先选中块内容，再套用排版 —— 让工具栏动作作用于这个块 */
  const applyFormat = (run: (h: NoteEditorHandle) => void): void => {
    const handle = handleRef.current
    if (handle === null) return
    // 标题块的 contentTo 覆盖整棵子树,只取标题行本身;列表按「当前行」——用户针对某一行改样式
    const end = block.kind === 'heading' ? block.from : block.kind === 'list' ? line : block.contentTo - 1
    handle.selectLines(block.kind === 'list' ? line : block.from, end)
    run(handle)
    onClose()
  }

  return (
    <div ref={ref} className="notes-block-menu" style={menuStyle(anchor, 250, 520)} role="menu">
      <div className="notes-block-menu-head">
        <span className="notes-block-menu-type">
          {icon.text !== undefined ? icon.text : <i className={`fa-solid ${icon.icon}`} />}
        </span>
        <span>{t(`notes.blockMenu.type.${block.kind}`)}</span>
      </div>
      <div className="notes-block-menu-grid">
        {block.kind === 'heading' && ([1, 2, 3] as const).map((level) => (
          <button
            key={level}
            type="button"
            className={block.level === level ? 'active' : ''}
            onClick={() => action(() => handleRef.current?.setHeadingLevel(block.from, level))}
          >
            H{level}
          </button>
        ))}
      </div>
      {(block.kind === 'quote' || block.kind === 'callout') && (
        <>
          <div className="notes-block-menu-sep" />
          <div className="notes-block-menu-grid notes-block-fmt-grid notes-block-quote-styles" title={t('notes.blockMenu.quoteStyle')}>
            <button
              type="button"
              title={t('notes.fmt.quote')}
              aria-label={t('notes.fmt.quote')}
              className={currentCallout === null ? 'active' : ''}
              onClick={() => action(() => handleRef.current?.setQuoteStyle(block.from, null))}
            >
              <i className="fa-solid fa-quote-left" />
            </button>
            {CALLOUT_KINDS.map((kind) => {
              const label = t(`notes.callout.${kind}`)
              return (
                <button
                  key={kind}
                  type="button"
                  title={label}
                  aria-label={label}
                  className={currentCallout === kind ? 'active' : ''}
                  onClick={() => action(() => handleRef.current?.setQuoteStyle(block.from, kind))}
                >
                  <i className={`fa-solid ${CALLOUT_ICON[kind]}`} />
                </button>
              )
            })}
          </div>
        </>
      )}
      {block.kind === 'list' && (
        <>
          <div className="notes-block-menu-sep" />
          <div className="notes-block-menu-grid notes-block-fmt-grid notes-block-list-styles" title={t('notes.blockMenu.listStyle')}>
            <button
              type="button"
              title={t('notes.fmt.list')}
              aria-label={t('notes.fmt.list')}
              className={currentMarker === '- ' ? 'active' : ''}
              onClick={() => action(() => handleRef.current?.setListMarker(line, '- '))}
            >
              <i className="fa-solid fa-list-ul" />
            </button>
            <button
              type="button"
              title={t('notes.blockMenu.orderedList')}
              aria-label={t('notes.blockMenu.orderedList')}
              className={currentMarker === '1. ' ? 'active' : ''}
              onClick={() => action(() => handleRef.current?.setListMarker(line, '1. '))}
            >
              <i className="fa-solid fa-list-ol" />
            </button>
            <button
              type="button"
              title={t('notes.fmt.task')}
              aria-label={t('notes.fmt.task')}
              className={currentMarker === '- [ ] ' ? 'active' : ''}
              onClick={() => action(() => handleRef.current?.setListMarker(line, '- [ ] '))}
            >
              <i className="fa-solid fa-square-check" />
            </button>
          </div>
          <div className="notes-block-menu-grid">
            <button type="button" title={t('notes.blockMenu.indent')} aria-label={t('notes.blockMenu.indent')} onClick={() => action(() => handleRef.current?.indentLine(line, 'in'))}>
              <i className="fa-solid fa-indent" />
            </button>
            <button type="button" title={t('notes.blockMenu.outdent')} aria-label={t('notes.blockMenu.outdent')} onClick={() => action(() => handleRef.current?.indentLine(line, 'out'))}>
              <i className="fa-solid fa-outdent" />
            </button>
          </div>
        </>
      )}
      <div className="notes-block-menu-sep" />
      <div className="notes-block-menu-grid notes-block-fmt-grid">
        {BLOCK_FORMATS.map((a) => (
          <button
            key={a.id}
            type="button"
            title={t(a.labelKey)}
            aria-label={t(a.labelKey)}
            onClick={() => applyFormat(a.run)}
          >
            <i className={`fa-solid ${a.icon}`} />
          </button>
        ))}
      </div>
      <div className="notes-block-menu-sep" />
      <button type="button" className="notes-block-menu-item" onClick={() => action(() => onInsertBelow(block.to))}>
        <i className="fa-solid fa-plus" />
        <span>{t('notes.blockMenu.insertBelow')}</span>
      </button>
      <button type="button" className="notes-block-menu-item" onClick={() => action(() => handleRef.current?.duplicateLines(block.from, block.to - 1))}>
        <i className="fa-regular fa-clone" />
        <span>{t('notes.blockMenu.duplicate')}</span>
      </button>
      <button type="button" className="notes-block-menu-item" onClick={copy}>
        <i className="fa-regular fa-copy" />
        <span>{t('common.copy')}</span>
      </button>
      <button type="button" className="notes-block-menu-item danger" onClick={() => action(() => handleRef.current?.deleteLines(block.from, block.to - 1))}>
        <i className="fa-regular fa-trash-can" />
        <span>{t('common.delete')}</span>
      </button>
      <div className="notes-block-menu-sep" />
      <button type="button" className="notes-block-menu-item" onClick={() => action(() => onDiagram(block.to))}>
        <i className="fa-solid fa-diagram-project" />
        <span>{t('notes.blockMenu.diagram')}</span>
      </button>
      <button type="button" className="notes-block-menu-item" onClick={() => action(() => onEmbed(block.to))}>
        <i className="fa-solid fa-globe" />
        <span>{t('notes.blockMenu.embed')}</span>
      </button>
    </div>
  )
}

interface InsertAction {
  id: string
  icon: string
  label: string
  run: (handle: NoteEditorHandle, line: number) => void
}

export function NoteInsertMenu({
  line,
  anchor,
  handleRef,
  onClose,
  onDiagram,
  onEmbed
}: {
  line: number
  anchor: MenuAnchor
  handleRef: RefObject<NoteEditorHandle | null>
  onClose: () => void
  onDiagram: (line: number) => void
  onEmbed: (line: number) => void
}): React.JSX.Element {
  const t = useT()
  const ref = useRef<HTMLDivElement | null>(null)
  useDismiss(onClose, ref)
  const actions: InsertAction[] = [
    { id: 'text', icon: 'fa-paragraph', label: t('notes.insert.text'), run: (h, n) => h.focusLine(n) },
    { id: 'h1', icon: 'fa-heading', label: t('notes.insert.heading1'), run: (h, n) => h.insertAtLine(n, '# ', 2) },
    { id: 'h2', icon: 'fa-heading', label: t('notes.insert.heading2'), run: (h, n) => h.insertAtLine(n, '## ', 3) },
    { id: 'h3', icon: 'fa-heading', label: t('notes.insert.heading3'), run: (h, n) => h.insertAtLine(n, '### ', 4) },
    { id: 'list', icon: 'fa-list-ul', label: t('notes.fmt.list'), run: (h, n) => h.insertAtLine(n, '- ', 2) },
    { id: 'task', icon: 'fa-square-check', label: t('notes.fmt.task'), run: (h, n) => h.insertAtLine(n, '- [ ] ', 6) },
    { id: 'quote', icon: 'fa-quote-left', label: t('notes.fmt.quote'), run: (h, n) => h.insertAtLine(n, '> ', 2) },
    { id: 'code', icon: 'fa-file-code', label: t('notes.fmt.codeBlock'), run: (h, n) => h.insertAtLine(n, '```\n\n```', 4) },
    { id: 'table', icon: 'fa-table', label: t('notes.fmt.table'), run: (h, n) => h.insertAtLine(n, tableSkeleton(3, 3, (i) => t('notes.table.col').replace('{N}', String(i)))) },
    { id: 'image', icon: 'fa-image', label: t('notes.fmt.image'), run: (h, n) => h.insertAtLine(n, '![]()', 3) },
    { id: 'details', icon: 'fa-caret-square-down', label: t('notes.fmt.details'), run: (h, n) => h.insertAtLine(n, '<details>\n<summary>标题</summary>\n\n内容\n\n</details>', 18) }
  ]
  const run = (action: InsertAction): void => {
    const handle = handleRef.current
    if (handle !== null) action.run(handle, line)
    onClose()
  }

  return (
    <div ref={ref} className="notes-insert-menu" style={menuStyle(anchor, 290, 300)} role="menu">
      <div className="notes-block-menu-head">
        <span className="notes-block-menu-type"><i className="fa-solid fa-plus" /></span>
        <span>{t('notes.insert.title')}</span>
      </div>
      <div className="notes-insert-grid">
        {actions.map((action) => (
          <button key={action.id} type="button" onClick={() => run(action)} title={action.label}>
            <i className={`fa-solid ${action.icon}`} />
            <span>{action.label}</span>
          </button>
        ))}
        <button type="button" onClick={() => { onDiagram(line); onClose() }}>
          <i className="fa-solid fa-diagram-project" />
          <span>{t('notes.blockMenu.diagram')}</span>
        </button>
        <button type="button" onClick={() => { onEmbed(line); onClose() }}>
          <i className="fa-solid fa-globe" />
          <span>{t('notes.blockMenu.embed')}</span>
        </button>
      </div>
    </div>
  )
}
