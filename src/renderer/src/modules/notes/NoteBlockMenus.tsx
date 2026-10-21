import { useEffect, useRef, useState, type RefObject } from 'react'
import { useT } from '../../hooks/useT'
import { tableSkeleton } from '../../lib/note-table'
import { showToast } from '../../lib/utils'
import type { MarkdownBlock } from '../../lib/markdown-blocks'
import { CALLOUT_KINDS, parseCallout, type CalloutKind } from '../../lib/markdown'
import { Icon } from '../../components/ui/Icon'
import { blockIconName, CALLOUT_ICON_NAMES } from '../../lib/block-icons'
import type { IconName } from '../../lib/icon-paths'
import type { NoteEditorHandle } from './NoteEditor'
import {
  clampTableWidth,
  TABLE_BORDERS,
  type TableBorder,
  type TableOptions
} from '@shared/note-table-style'
import { findTableMetaAtLine, readTableMeta, type TableAlign, type TableEdit } from '../../lib/note-table-edit'

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
  icon: IconName
  labelKey: string
  run: (h: NoteEditorHandle) => void
}

/** 与底部工具栏同源的排版动作 —— 点击时先选中块内容再套用 */
const BLOCK_FORMATS: FormatAction[] = [
  { id: 'bold', icon: 'bold', labelKey: 'notes.fmt.bold', run: (h) => h.wrapSelection('**') },
  { id: 'italic', icon: 'italic', labelKey: 'notes.fmt.italic', run: (h) => h.wrapSelection('*') },
  { id: 'code', icon: 'code', labelKey: 'notes.fmt.code', run: (h) => h.wrapSelection('`') },
  { id: 'link', icon: 'link', labelKey: 'notes.fmt.link', run: (h) => h.wrapSelection('[', '](https://)') },
  { id: 'heading', icon: 'heading', labelKey: 'notes.fmt.heading', run: (h) => h.prefixLines('## ') },
  { id: 'list', icon: 'list', labelKey: 'notes.fmt.list', run: (h) => h.prefixLines('- ') },
  { id: 'task', icon: 'square-check-big', labelKey: 'notes.fmt.task', run: (h) => h.prefixLines('- [ ] ') },
  { id: 'quote', icon: 'text-quote', labelKey: 'notes.fmt.quote', run: (h) => h.prefixLines('> ') }
]

/** 表格取色板的预设色:只求「一眼能选」;任意值仍可在右侧输入框里写 */
const TABLE_COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#64748b'] as const

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

const ALIGN_LABEL: Record<'left' | 'center' | 'right', string> = {
  left: 'notes.tableMenu.alignLeft',
  center: 'notes.tableMenu.alignCenter',
  right: 'notes.tableMenu.alignRight'
}

/** 表格的一行「颜色」设置:跟随主题 / 预设色板 / 自定义十六进制 */
function TableColorRow({
  label,
  value,
  onChange
}: {
  label: string
  value: string | null
  onChange: (value: string | null) => void
}): React.JSX.Element {
  const t = useT()
  const [draft, setDraft] = useState(value ?? '')

  // 外部(点色板/切换设置)改了值 → 输入框跟着走;正在输入时不会触发,因为 value 没变
  useEffect(() => setDraft(value ?? ''), [value])

  const commit = (): void => {
    const v = draft.trim()
    if (v === '') {
      if (value !== null) onChange(null)
      return
    }
    if (HEX_RE.test(v)) {
      // 统一小写:同一个颜色在源码里只应该有一种写法
      const next = v.toLowerCase()
      if (next !== value) onChange(next)
      return
    }
    // 认不出就恢复当前值,不要把一个写坏的颜色塞进正文
    setDraft(value ?? '')
  }

  return (
    <div className="notes-table-setting">
      <span className="notes-table-setting-label">{label}</span>
      <div className="notes-table-setting-controls">
        <button
          type="button"
          className={'notes-table-chip' + (value === null ? ' active' : '')}
          title={t('notes.tableMenu.colorFollow')}
          onClick={() => onChange(null)}
        >
          {t('notes.tableMenu.follow')}
        </button>
        {TABLE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={'notes-table-swatch' + (value?.toLowerCase() === c ? ' active' : '')}
            style={{ background: c }}
            title={c}
            aria-label={c}
            onClick={() => onChange(c)}
          />
        ))}
        <input
          className="notes-table-hex"
          value={draft}
          placeholder="#hex"
          spellCheck={false}
          title={t('notes.tableMenu.colorCustom')}
          aria-label={t('notes.tableMenu.colorCustom')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              setDraft(value ?? '')
              e.currentTarget.blur()
            }
          }}
        />
      </div>
    </div>
  )
}

/** 整表宽度:铺满 / 常用档 / 自定义 px */
function TableWidthRow({
  label,
  value,
  onChange
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
}): React.JSX.Element {
  const t = useT()
  const [draft, setDraft] = useState(value === null ? '' : String(value))

  useEffect(() => setDraft(value === null ? '' : String(value)), [value])

  const commit = (): void => {
    const v = draft.trim()
    if (v === '') {
      if (value !== null) onChange(null)
      return
    }
    const n = Number(v)
    if (!Number.isFinite(n)) {
      setDraft(value === null ? '' : String(value))
      return
    }
    const next = clampTableWidth(n)
    setDraft(String(next))
    if (next !== value) onChange(next)
  }

  return (
    <div className="notes-table-setting">
      <span className="notes-table-setting-label">{label}</span>
      <div className="notes-table-setting-controls">
        <button
          type="button"
          className={'notes-table-chip' + (value === null ? ' active' : '')}
          onClick={() => onChange(null)}
        >
          {t('notes.tableMenu.widthFill')}
        </button>
        {[480, 720, 960].map((n) => (
          <button
            key={n}
            type="button"
            className={'notes-table-chip num' + (value === n ? ' active' : '')}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
        <input
          className="notes-table-px"
          value={draft}
          placeholder="px"
          inputMode="numeric"
          title={t('notes.tableMenu.widthCustom')}
          aria-label={t('notes.tableMenu.widthCustom')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              setDraft(value === null ? '' : String(value))
              e.currentTarget.blur()
            }
          }}
        />
      </div>
    </div>
  )
}

/** 列对齐:菜单只提供「整表」一档;按列的编辑在预览里的表格工具上做 */
function TableAlignRow({
  aligns,
  onChange
}: {
  aligns: TableAlign[]
  onChange: (align: TableAlign) => void
}): React.JSX.Element {
  const t = useT()
  const first = aligns[0] ?? null
  // undefined = 各列不一致(源码里手写过);此时三档都不高亮
  const current = aligns.every((a) => a === first) ? first : undefined

  return (
    <div className="notes-table-setting">
      <span className="notes-table-setting-label">{t('notes.tableMenu.align')}</span>
      <div className="notes-table-setting-controls">
        <button
          type="button"
          className={'notes-table-chip' + (current === null ? ' active' : '')}
          onClick={() => onChange(null)}
        >
          {t('notes.tableMenu.alignFollow')}
        </button>
        {(['left', 'center', 'right'] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={'notes-table-chip icon' + (current === a ? ' active' : '')}
            title={t(ALIGN_LABEL[a])}
            aria-label={t(ALIGN_LABEL[a])}
            onClick={() => onChange(a)}
          >
            <Icon name={`align-${a}`} />
          </button>
        ))}
        <span className="notes-table-hint">{t('notes.tableMenu.alignAll')}</span>
      </div>
    </div>
  )
}

/** 表格样式区:菜单开在表格上时渲染在最上方(独立表格或引用里的表格都可以) */
function TableSettings({
  meta,
  row,
  onOptions,
  onAlign,
  onEdit
}: {
  meta: NonNullable<ReturnType<typeof readTableMeta>>
  row: number
  onOptions: (opts: ReadonlyArray<readonly [string, string | null]>) => void
  onAlign: (align: TableAlign) => void
  onEdit: (edit: TableEdit) => void
}): React.JSX.Element {
  const t = useT()
  const options: TableOptions = meta.options

  return (
    <div className="notes-table-settings">
      <div className="notes-table-setting">
        <span className="notes-table-setting-label">{t('notes.tableMenu.border')}</span>
        <div className="notes-table-setting-controls">
          <button
            type="button"
            className={'notes-table-chip' + (options.border === null ? ' active' : '')}
            onClick={() => onOptions([['border', null]])}
          >
            {t('notes.tableMenu.follow')}
          </button>
          {TABLE_BORDERS.map((b: TableBorder) => (
            <button
              key={b}
              type="button"
              className={'notes-table-chip' + (options.border === b ? ' active' : '')}
              onClick={() => onOptions([['border', b]])}
            >
              {t(`settings.notes.table.border.${b}`)}
            </button>
          ))}
        </div>
      </div>

      <TableColorRow
        label={t('notes.tableMenu.borderColor')}
        value={options.color}
        onChange={(v) => onOptions([['color', v]])}
      />
      <TableColorRow
        label={t('notes.tableMenu.headBg')}
        value={options.head}
        onChange={(v) => onOptions([['head', v]])}
      />
      <TableColorRow
        label={t('notes.tableMenu.fillBg')}
        value={options.fill}
        onChange={(v) => onOptions([['fill', v]])}
      />
      <TableWidthRow
        label={t('notes.tableMenu.width')}
        value={options.width}
        onChange={(w) => onOptions([['width', w === null ? null : String(w)]])}
      />
      <TableAlignRow aligns={meta.aligns} onChange={onAlign} />

      <div className="notes-table-layout">
        <button
          type="button"
          role="switch"
          aria-checked={options.layout}
          className={'notes-table-switch' + (options.layout ? ' on' : '')}
          onClick={() => onOptions([['layout', options.layout ? null : '']])}
        >
          <span className="notes-table-switch-track"><span /></span>
          <span>{t('notes.tableMenu.layout')}</span>
        </button>
        <span className="notes-table-hint">{t('notes.tableMenu.layoutHint')}</span>
      </div>

      <div className="notes-table-rowcols" title={t('notes.tableMenu.rowCol')}>
        <button
          type="button"
          disabled={row === 0}
          onClick={() => onEdit('row-above')}
        >
          {t('notes.tableMenu.rowAbove')}
        </button>
        <button type="button" onClick={() => onEdit('row-below')}>
          {t('notes.tableMenu.rowBelow')}
        </button>
        <button
          type="button"
          className="danger"
          disabled={row === 0}
          onClick={() => onEdit('row-delete')}
        >
          {t('notes.tableMenu.rowDelete')}
        </button>
        <button type="button" onClick={() => onEdit('col-append')}>
          {t('notes.tableMenu.colAppend')}
        </button>
        <button
          type="button"
          className="danger"
          disabled={meta.cols <= 1}
          onClick={() => onEdit('col-delete-last')}
        >
          {t('notes.tableMenu.colDelete')}
        </button>
      </div>
    </div>
  )
}

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
  /**
   * 表格元信息。
   * 独立表格用块起始行定位;引用 / 提示块里的表格是外层块的一部分,
   * 按用户点中的那一行反查 —— 这样在引用里的表格上开菜单也能看到表格设置。
   */
  const table = block.kind === 'table' ? readTableMeta(body, block.from) : findTableMetaAtLine(body, line)
  /**
   * 点开菜单时落在表的第几行(0 = 表头)。
   * **只在挂载时算一次**:给普通表加样式会就地插两行围栏、行号整体下移,
   * 每次渲染重算就会把「我点的是第几行」算漂;而表格内容本身没有变,行号是稳定的。
   * 外层用 key 按块重挂,所以换一个表格打开菜单时会重新取。
   */
  const [tableRow, setTableRow] = useState(() => {
    if (table === null) return 0
    if (line <= table.line) return 0
    // 表头下面还有一行分隔行(`|---|`) —— 正文行的序号要把它减掉
    return Math.max(0, Math.min(line - table.line - 1, table.rows))
  })
  const tableMenu = table !== null
  const tableAnchor = table?.anchor ?? block.from
  const setTableOptions = (opts: ReadonlyArray<readonly [string, string | null]>): void => {
    handleRef.current?.setTableOptions(tableAnchor, opts)
  }
  const editTable = (edit: TableEdit): void => {
    handleRef.current?.editTable(tableAnchor, edit, tableRow)
    // 在上方插行后,原来那一行下移了一行 —— 后续「删除此行」仍应指向它
    if (edit === 'row-above') setTableRow((r) => r + 1)
  }
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
    // 只取**自有正文**（bodyTo 不含子块）：标题选自己那一行，列表项选它自己的几行，
    // 不会顺手把子项一起改掉
    handle.selectLines(block.from, block.bodyTo - 1)
    run(handle)
    onClose()
  }

  // 列表项的三种形态在手柄和菜单标题里用同一套区分
  const typeLabel =
    block.kind === 'align'
      ? t(`notes.align.${block.align ?? 'left'}`)
      : block.kind === 'listItem'
        ? t(
            block.task === true
              ? 'notes.blockMenu.type.taskItem'
              : block.ordered === true
                ? 'notes.blockMenu.type.orderedItem'
                : 'notes.blockMenu.type.listItem'
          )
        : t(`notes.blockMenu.type.${block.kind}`)

  return (
    <div
      ref={ref}
      className={'notes-block-menu' + (tableMenu ? ' notes-block-menu-table' : '')}
      style={menuStyle(anchor, tableMenu ? 312 : 250, tableMenu ? 760 : 520)}
      role="menu"
    >
      <div className="notes-block-menu-head">
        <span className="notes-block-menu-type">
          {block.kind === 'heading' ? `H${block.level}` : <Icon name={blockIconName(block)} />}
        </span>
        <span>{typeLabel}</span>
      </div>
      {table !== null && (
        <>
          <div className="notes-block-menu-sep" />
          <TableSettings
            meta={table}
            row={tableRow}
            onOptions={setTableOptions}
            onAlign={(a) => handleRef.current?.setTableAlign(table.anchor, a)}
            onEdit={editTable}
          />
        </>
      )}
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
                  className={currentCallout === kind ? 'active' : ''}
                  onClick={() => action(() => handleRef.current?.setQuoteStyle(block.from, kind))}
                >
                  <Icon name={CALLOUT_ICON_NAMES[kind]} />
                </button>
              )
            })}
          </div>
        </>
      )}
      {block.kind === 'listItem' && (
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
              <Icon name="list" />
            </button>
            <button
              type="button"
              title={t('notes.blockMenu.orderedList')}
              aria-label={t('notes.blockMenu.orderedList')}
              className={currentMarker === '1. ' ? 'active' : ''}
              onClick={() => action(() => handleRef.current?.setListMarker(line, '1. '))}
            >
              <Icon name="list-ordered" />
            </button>
            <button
              type="button"
              title={t('notes.fmt.task')}
              aria-label={t('notes.fmt.task')}
              className={currentMarker === '- [ ] ' ? 'active' : ''}
              onClick={() => action(() => handleRef.current?.setListMarker(line, '- [ ] '))}
            >
              <Icon name="square-check-big" />
            </button>
          </div>
        </>
      )}
      {/* 对所有块都成立的行操作:按工具栏同一套规则缩进(空行跳过、每次 2 空格)。
          列表项不再单独放一份,避免同一个动作出现两遍。 */}
      <div className="notes-block-menu-sep" />
      <div
        className="notes-block-menu-grid notes-block-fmt-grid notes-block-indent"
        title={t('notes.blockMenu.indent')}
      >
        <button
          type="button"
          title={t('notes.fmt.indent')}
          aria-label={t('notes.fmt.indent')}
          onClick={() => applyFormat((h) => h.indentBlock('in'))}
        >
          <Icon name="indent-increase" />
        </button>
        <button
          type="button"
          title={t('notes.fmt.outdent')}
          aria-label={t('notes.fmt.outdent')}
          onClick={() => applyFormat((h) => h.indentBlock('out'))}
        >
          <Icon name="indent-decrease" />
        </button>
      </div>
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
            <Icon name={a.icon} />
          </button>
        ))}
      </div>
      <div className="notes-block-menu-sep" />
      <button type="button" className="notes-block-menu-item" onClick={() => action(() => onInsertBelow(block.to))}>
        <Icon name="plus" />
        <span>{t('notes.blockMenu.insertBelow')}</span>
      </button>
      <button type="button" className="notes-block-menu-item" onClick={() => action(() => handleRef.current?.insertRuleAt(block.to))}>
        <Icon name="minus" />
        <span>{t('notes.fmt.rule')}</span>
      </button>
      <button type="button" className="notes-block-menu-item" onClick={() => action(() => handleRef.current?.duplicateLines(block.from, block.to - 1))}>
        <Icon name="copy-plus" />
        <span>{t('notes.blockMenu.duplicate')}</span>
      </button>
      <button type="button" className="notes-block-menu-item" onClick={copy}>
        <Icon name="copy" />
        <span>{t('common.copy')}</span>
      </button>
      <button type="button" className="notes-block-menu-item danger" onClick={() => action(() => handleRef.current?.deleteLines(block.from, block.to - 1))}>
        <Icon name="trash-2" />
        <span>{t('common.delete')}</span>
      </button>
      <div className="notes-block-menu-sep" />
      <button type="button" className="notes-block-menu-item" onClick={() => action(() => onDiagram(block.to))}>
        <Icon name="workflow" />
        <span>{t('notes.blockMenu.diagram')}</span>
      </button>
      <button type="button" className="notes-block-menu-item" onClick={() => action(() => onEmbed(block.to))}>
        <Icon name="globe" />
        <span>{t('notes.blockMenu.embed')}</span>
      </button>
    </div>
  )
}

interface InsertAction {
  id: string
  icon: IconName
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
    { id: 'text', icon: 'pilcrow', label: t('notes.insert.text'), run: (h, n) => h.focusLine(n) },
    { id: 'h1', icon: 'heading', label: t('notes.insert.heading1'), run: (h, n) => h.insertAtLine(n, '# ', 2) },
    { id: 'h2', icon: 'heading', label: t('notes.insert.heading2'), run: (h, n) => h.insertAtLine(n, '## ', 3) },
    { id: 'h3', icon: 'heading', label: t('notes.insert.heading3'), run: (h, n) => h.insertAtLine(n, '### ', 4) },
    { id: 'list', icon: 'list', label: t('notes.fmt.list'), run: (h, n) => h.insertAtLine(n, '- ', 2) },
    { id: 'task', icon: 'square-check-big', label: t('notes.fmt.task'), run: (h, n) => h.insertAtLine(n, '- [ ] ', 6) },
    { id: 'quote', icon: 'text-quote', label: t('notes.fmt.quote'), run: (h, n) => h.insertAtLine(n, '> ', 2) },
    { id: 'code', icon: 'square-code', label: t('notes.fmt.codeBlock'), run: (h, n) => h.insertAtLine(n, '```\n\n```', 4) },
    { id: 'table', icon: 'table', label: t('notes.insert.table'), run: (h, n) => h.insertAtLine(n, tableSkeleton(3, 3, (i) => t('notes.table.col').replace('{N}', String(i)))) },
    { id: 'image', icon: 'image', label: t('notes.fmt.image'), run: (h, n) => h.insertAtLine(n, '![]()', 3) },
    { id: 'rule', icon: 'minus', label: t('notes.fmt.rule'), run: (h, n) => h.insertRuleAt(n) },
    { id: 'details', icon: 'square-chevron-down', label: t('notes.insert.details'), run: (h, n) => h.insertAtLine(n, '<details>\n<summary>标题</summary>\n\n内容\n\n</details>', 18) }
  ]
  const run = (action: InsertAction): void => {
    const handle = handleRef.current
    if (handle !== null) action.run(handle, line)
    onClose()
  }

  return (
    <div ref={ref} className="notes-insert-menu" style={menuStyle(anchor, 290, 300)} role="menu">
      <div className="notes-block-menu-head">
        <span className="notes-block-menu-type"><Icon name="plus" /></span>
        <span>{t('notes.insert.title')}</span>
      </div>
      <div className="notes-insert-grid">
        {actions.map((action) => (
          <button key={action.id} type="button" onClick={() => run(action)} title={action.label}>
            <Icon name={action.icon} />
            <span>{action.label}</span>
          </button>
        ))}
        <button type="button" onClick={() => { onDiagram(line); onClose() }}>
          <Icon name="workflow" />
          <span>{t('notes.insert.diagram')}</span>
        </button>
        <button type="button" onClick={() => { onEmbed(line); onClose() }}>
          <Icon name="globe" />
          <span>{t('notes.blockMenu.embed')}</span>
        </button>
      </div>
    </div>
  )
}
