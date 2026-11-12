// 往白板上嵌一块内容的选择器。第一级是类型:点一行就打开这一类的文件框。
// 「笔记和文件」再进第二级,搜索左侧目录已经加载好的笔记和文件,不另开一次扫描。
// 「网页」不在这里填地址,交给画布拖出一块再填。
// 选中后由画布把它放成一块 embeddable 元素。

import { useMemo, useState } from 'react'
import { CANVAS_EMBED_KINDS, canvasPreviewExtensions, type CanvasExternalEmbed } from '@shared/canvas-external'
import { useT } from '../../../hooks/useT'
import { noteFileIcon } from '../../../lib/note-file'
import { useNotesStore } from '../../../state/notes-store'
import { canvasNoteLink } from './canvas-embed'
import { noteFileUrl } from '../../../lib/note-file-url'

export interface CanvasEmbedPick {
  link: string
  /** 元素左上角显示的名字 */
  label: string
  /** 库外文件。平时跟 source,打包后才填 project。 */
  external?: CanvasExternalEmbed
}

export type CanvasEmbedPage = 'kinds' | 'library'

const KIND_ICONS: Record<string, string> = {
  video: 'fa-file-video',
  slides: 'fa-file-powerpoint',
  document: 'fa-file-word',
  spreadsheet: 'fa-file-excel',
  pdf: 'fa-file-pdf',
  model: 'fa-cube',
  audio: 'fa-file-audio',
  image: 'fa-file-image'
}

export function CanvasEmbedPicker({
  page,
  onPage,
  onPick,
  onOpenFiles,
  onWeb,
  style
}: {
  page: CanvasEmbedPage
  onPage: (page: CanvasEmbedPage) => void
  onPick: (pick: CanvasEmbedPick) => void
  onOpenFiles: (accept: readonly string[]) => void
  onWeb: () => void
  style?: React.CSSProperties
}): React.JSX.Element {
  const t = useT()
  return (
    <div
      className="canvas-embed-picker"
      role="dialog"
      aria-label={t('notes.canvas.embed.title')}
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {page === 'library' ? (
        <CanvasEmbedLibrary onPage={onPage} onPick={onPick} />
      ) : (
        <div className="canvas-embed-picker-list">
          <button
            type="button"
            className="canvas-embed-picker-row"
            data-embed-page="library"
            onClick={() => onPage('library')}
          >
            <i className="fa-solid fa-folder-tree" />
            <span className="canvas-embed-picker-name">{t('notes.canvas.embed.library')}</span>
            <i className="fa-solid fa-chevron-right canvas-embed-picker-chevron" />
          </button>
          {CANVAS_EMBED_KINDS.map((kind) => (
            <KindRow
              key={kind.id}
              id={kind.id}
              icon={KIND_ICONS[kind.id] ?? 'fa-file'}
              label={t(`notes.canvas.embed.kind.${kind.id}`)}
              onClick={() => onOpenFiles(kind.extensions)}
            />
          ))}
          <KindRow
            id="computer"
            icon="fa-folder-open"
            label={t('notes.canvas.embed.kind.computer')}
            onClick={() => onOpenFiles(canvasPreviewExtensions())}
          />
          <button type="button" className="canvas-embed-picker-row" data-embed-web="" onClick={onWeb}>
            <i className="fa-solid fa-globe" />
            <span className="canvas-embed-picker-name">{t('notes.canvas.embed.web')}</span>
          </button>
        </div>
      )}
    </div>
  )
}

function KindRow({
  id,
  icon,
  label,
  onClick
}: {
  id: string
  icon: string
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button type="button" className="canvas-embed-picker-row" data-embed-kind={id} onClick={onClick}>
      <i className={`fa-solid ${icon}`} />
      <span className="canvas-embed-picker-name">{label}</span>
    </button>
  )
}

function CanvasEmbedLibrary({
  onPage,
  onPick
}: {
  onPage: (page: CanvasEmbedPage) => void
  onPick: (pick: CanvasEmbedPick) => void
}): React.JSX.Element {
  const t = useT()
  const notes = useNotesStore((s) => s.notes)
  const files = useNotesStore((s) => s.files)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const noteRows = useMemo(
    () => filterBy(notes, needle, (note) => `${note.title} ${note.id}`),
    [notes, needle]
  )
  const fileRows = useMemo(
    () => filterBy(files, needle, (file) => `${file.name} ${file.path}`),
    [files, needle]
  )

  return (
    <>
      <button
        type="button"
        className="canvas-embed-picker-back"
        data-embed-back=""
        onClick={() => onPage('kinds')}
      >
        <i className="fa-solid fa-chevron-left" />
        <span>{t('notes.canvas.embed.back')}</span>
      </button>
      <div className="canvas-embed-picker-bar">
        <input
          className="canvas-embed-picker-query"
          autoFocus
          placeholder={t('notes.canvas.embed.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="canvas-embed-picker-list">
        {noteRows.length > 0 && (
          <PickerGroup label={t('notes.canvas.embed.notes')}>
            {noteRows.map((note) => (
              <PickerRow
                key={note.id}
                icon="fa-file-lines"
                name={note.title}
                path={note.id}
                onClick={() => onPick({ link: canvasNoteLink(note.id), label: note.title })}
              />
            ))}
          </PickerGroup>
        )}
        {fileRows.length > 0 && (
          <PickerGroup label={t('notes.canvas.embed.files')}>
            {fileRows.map((file) => (
              <PickerRow
                key={file.path}
                icon={noteFileIcon(file.ext, file.name)}
                name={file.name}
                path={file.path}
                onClick={() => onPick({ link: noteFileUrl(file.path), label: file.name })}
              />
            ))}
          </PickerGroup>
        )}
        {noteRows.length === 0 && fileRows.length === 0 && (
          <div className="canvas-embed-picker-empty">{t('notes.canvas.embed.empty')}</div>
        )}
      </div>
    </>
  )
}

function filterBy<T>(rows: T[], needle: string, text: (row: T) => string): T[] {
  if (needle === '') return rows
  return rows.filter((row) => text(row).toLowerCase().includes(needle))
}

function PickerGroup({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="canvas-embed-picker-group">
      <div className="canvas-embed-picker-label">{label}</div>
      {children}
    </div>
  )
}

function PickerRow({
  icon,
  name,
  path,
  onClick
}: {
  icon: string
  name: string
  path: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="canvas-embed-picker-row"
      data-embed-path={path}
      title={path}
      onClick={onClick}
    >
      <i className={`fa-solid ${icon}`} />
      <span className="canvas-embed-picker-name">{name}</span>
    </button>
  )
}
