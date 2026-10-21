// 笔记底部工具条:左边是排版按钮,右边是字数或使用提示。
//
// 为什么放在底部而不是顶部:顶部两行已经是「我在哪(路径)+ 这篇挂着什么(关联/标签)」,
// 再往上堆排版按钮会把它挤乱。底部这条更像状态栏 —— 常驻、不抢注意力,需要时才低头看。
//
// **纯预览时整条不渲染**(由调用方决定):排版按钮只对编辑有意义,而留一条只剩字数的空条更怪。
//
// 两个带浮层的按钮(表格 / 网页嵌入)不用 handle:它们要先问用户「多大的表」「嵌哪个地址」,
// 插入时机在用户点确认之后。

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useT } from '../../hooks/useT'
import { Icon } from '../../components/ui/Icon'
import type { IconName } from '../../lib/icon-paths'
import { tableSkeleton } from '../../lib/note-table'
import { CALLOUT_ICON_NAMES } from '../../lib/block-icons'
import { CALLOUT_KINDS, type CalloutKind } from '../../lib/markdown'
import type { NoteEditorHandle } from './NoteEditor'

interface FormatAction {
  id: string
  icon: IconName
  labelKey: string
  /** 显示在 tooltip 里的快捷键;没有就不显示 */
  shortcut?: string
  run: (h: NoteEditorHandle) => void
  /** true = 与前一个之间画一道分隔 */
  groupStart?: boolean
}

const FORMATS: FormatAction[] = [
  { id: 'bold', icon: 'bold', labelKey: 'notes.fmt.bold', shortcut: '⌘B', run: (h) => h.wrapSelection('**') },
  { id: 'italic', icon: 'italic', labelKey: 'notes.fmt.italic', shortcut: '⌘I', run: (h) => h.wrapSelection('*') },
  { id: 'code', icon: 'code', labelKey: 'notes.fmt.code', run: (h) => h.wrapSelection('`') },
  { id: 'link', icon: 'link', labelKey: 'notes.fmt.link', shortcut: '⌘K', run: (h) => h.wrapSelection('[', '](https://)') },
  { id: 'heading', icon: 'heading', labelKey: 'notes.fmt.heading', groupStart: true, run: (h) => h.prefixLines('## ') },
  { id: 'list', icon: 'list', labelKey: 'notes.fmt.list', run: (h) => h.prefixLines('- ') },
  { id: 'task', icon: 'square-check-big', labelKey: 'notes.fmt.task', run: (h) => h.prefixLines('- [ ] ') },
  { id: 'indent', icon: 'indent-increase', labelKey: 'notes.fmt.indent', run: (h) => h.indentBlock('in') },
  { id: 'outdent', icon: 'indent-decrease', labelKey: 'notes.fmt.outdent', run: (h) => h.indentBlock('out') },
  { id: 'codeBlock', icon: 'square-code', labelKey: 'notes.fmt.codeBlock', groupStart: true, run: (h) => h.insertBlock('```\n\n```', 4) },
  { id: 'image', icon: 'image', labelKey: 'notes.fmt.image', run: (h) => h.wrapSelection('![', '](assets/)') },
  { id: 'rule', icon: 'minus', labelKey: 'notes.fmt.rule', run: (h) => h.insertRule() },
  {
    id: 'details',
    icon: 'square-chevron-down',
    labelKey: 'notes.fmt.details',
    groupStart: true,
    run: (h) => h.insertBlock('<details>\n<summary>标题</summary>\n\n内容\n\n</details>', 18)
  },
  { id: 'sub', icon: 'subscript', labelKey: 'notes.fmt.sub', groupStart: true, run: (h) => h.wrapSelection('~') },
  { id: 'sup', icon: 'superscript', labelKey: 'notes.fmt.sup', run: (h) => h.wrapSelection('^') }
]

/**
 * 对齐按钮。**只对表格列生效** —— Markdown 里段落对齐没有标准语法
 * (Obsidian/GitHub 都只能写 HTML,而本项目的渲染器刻意不解析 HTML),
 * 唯一标准且可移植的对齐就是表格分隔行里的 `:--` / `:-:` / `--:`。
 */
const ALIGNS: { id: 'left' | 'center' | 'right'; icon: IconName; labelKey: string }[] = [
  { id: 'left', icon: 'align-left', labelKey: 'notes.fmt.alignLeft' },
  { id: 'center', icon: 'align-center', labelKey: 'notes.fmt.alignCenter' },
  { id: 'right', icon: 'align-right', labelKey: 'notes.fmt.alignRight' }
]

const TABLE_MAX = 8

/** 表格尺寸选择器:拖选行列。比「填两个数字」快,也比「先插一个 3×3 再删」省事 */
function TablePicker({
  onPick,
  onClose
}: {
  onPick: (rows: number, cols: number) => void
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [size, setSize] = useState({ r: 0, c: 0 })
  const boxRef = useRef<HTMLDivElement | null>(null)

  // 点到别处就收起来。用 pointerdown 而不是 click:后者要等鼠标抬起,
  // 期间工具栏上的其它按钮会被这一层挡住一次
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [onClose])

  return (
    <div className="notes-table-picker" ref={boxRef} role="dialog" aria-label={t('notes.fmt.table')}>
      <div className="notes-table-grid" onMouseLeave={() => setSize({ r: 0, c: 0 })}>
        {Array.from({ length: TABLE_MAX }, (_, r) => (
          <div key={r} className="notes-table-grid-row">
            {Array.from({ length: TABLE_MAX }, (_, c) => (
              <button
                key={c}
                type="button"
                tabIndex={-1}
                className={'notes-table-cell' + (r < size.r && c < size.c ? ' on' : '')}
                onMouseEnter={() => setSize({ r: r + 1, c: c + 1 })}
                onFocus={() => setSize({ r: r + 1, c: c + 1 })}
                onClick={() => onPick(r + 1, c + 1)}
                aria-label={`${r + 1} × ${c + 1}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="notes-table-size">
        {size.r > 0
          ? t('notes.table.size').replace('{R}', String(size.r)).replace('{C}', String(size.c))
          : t('notes.table.pick')}
      </div>
    </div>
  )
}

/**
 * 引用样式选择器:普通引用 + 五种提示块,与块菜单里那排引用样式**同源**
 * (图标都出自 `CALLOUT_ICON_NAMES`)。往上开 —— 工具条贴着窗口底边,往下开会被切掉。
 */
function QuotePicker({
  onPick,
  onClose
}: {
  onPick: (kind: CalloutKind | null) => void
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const boxRef = useRef<HTMLDivElement | null>(null)

  // 与 TablePicker 同一套关法:pointerdown 比 click 早一层,别处按下立即收起
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [onClose])

  const plain = t('notes.fmt.quote')
  return (
    <div className="notes-quote-picker" ref={boxRef} role="dialog" aria-label={t('notes.blockMenu.quoteStyle')}>
      <button type="button" title={plain} aria-label={plain} onClick={() => onPick(null)}>
        <Icon name="text-quote" />
      </button>
      {CALLOUT_KINDS.map((kind) => {
        const label = t(`notes.callout.${kind}`)
        return (
          <button
            key={kind}
            type="button"
            title={label}
            aria-label={label}
            onClick={() => onPick(kind)}
          >
            <Icon name={CALLOUT_ICON_NAMES[kind]} />
          </button>
        )
      })}
    </div>
  )
}

/** 生成 GFM 表格骨架。表头给占位名,空表头在预览里是一片看不出边界的格子 */
export function NoteToolbar({
  handleRef,
  body,
  onDiagram,
  onEmbed
}: {
  handleRef: RefObject<NoteEditorHandle | null>
  body: string
  /** 图表不走 handle:它要开对话框,插入时机在用户点「插入」之后 */
  onDiagram: () => void
  onEmbed: () => void
}): React.JSX.Element {
  const t = useT()
  const empty = body.trim() === ''
  const [tableOpen, setTableOpen] = useState(false)
  const [quoteOpen, setQuoteOpen] = useState(false)

  const applyQuote = (kind: CalloutKind | null): void => {
    setQuoteOpen(false)
    handleRef.current?.applyQuote(kind)
  }

  const run = (a: FormatAction): void => {
    const handle = handleRef.current
    if (handle === null) return
    a.run(handle)
  }

  const insertTable = (rows: number, cols: number): void => {
    setTableOpen(false)
    handleRef.current?.insertBlock(tableSkeleton(rows, cols, (i) => t('notes.table.col').replace('{N}', String(i))))
  }

  return (
    <div className="notes-toolbar">
      <div className="notes-toolbar-fmt">
        {FORMATS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={'notes-fmt-btn' + (a.groupStart === true ? ' group-start' : '')}
            title={a.shortcut !== undefined ? `${t(a.labelKey)} · ${a.shortcut}` : t(a.labelKey)}
            aria-label={t(a.labelKey)}
            onClick={() => run(a)}
          >
            <Icon name={a.icon} />
          </button>
        ))}
        {ALIGNS.map((a, i) => (
          <button
            key={a.id}
            type="button"
            className={'notes-fmt-btn' + (i === 0 ? ' group-start' : '')}
            title={t(a.labelKey)}
            aria-label={t(a.labelKey)}
            onClick={() => run({ id: a.id, icon: a.icon, labelKey: a.labelKey, run: (h) => h.alignBlock(a.id) })}
          >
            <Icon name={a.icon} />
          </button>
        ))}
        {/* 引用样式:与表格按钮同构 —— 带浮层,点开选普通引用或提示块 */}
        <div className="notes-fmt-group group-start">
          <button
            type="button"
            className={'notes-fmt-btn' + (quoteOpen ? ' active' : '')}
            title={t('notes.fmt.quote')}
            aria-label={t('notes.fmt.quote')}
            aria-expanded={quoteOpen}
            onClick={() => setQuoteOpen((v) => !v)}
          >
            <Icon name="text-quote" />
          </button>
          {quoteOpen && <QuotePicker onPick={applyQuote} onClose={() => setQuoteOpen(false)} />}
        </div>
        <div className="notes-fmt-group group-start">
          <button
            type="button"
            className={'notes-fmt-btn' + (tableOpen ? ' active' : '')}
            title={t('notes.fmt.table')}
            aria-label={t('notes.fmt.table')}
            aria-expanded={tableOpen}
            onClick={() => setTableOpen((v) => !v)}
          >
            <Icon name="table" />
          </button>
          {tableOpen && <TablePicker onPick={insertTable} onClose={() => setTableOpen(false)} />}
        </div>
        <div className="notes-fmt-group">
          <button
            type="button"
            className="notes-fmt-btn"
            title={t('notes.fmt.embed')}
            aria-label={t('notes.fmt.embed')}
            onClick={onEmbed}
          >
            <Icon name="globe" />
          </button>
          <button
            type="button"
            className="notes-fmt-btn"
            title={t('notes.fmt.diagram')}
            aria-label={t('notes.fmt.diagram')}
            onClick={onDiagram}
          >
            <Icon name="workflow" />
          </button>
        </div>
      </div>
      <span className="notes-toolbar-spacer" />
      {empty ? (
        // 空笔记时字数没有意义,不如换成一句「这里能做什么」
        <span className="notes-toolbar-hint">{t('notes.fmt.hint')}</span>
      ) : (
        <span className="notes-toolbar-count">{t('notes.fmt.chars').replace('{N}', String(body.length))}</span>
      )}
    </div>
  )
}
