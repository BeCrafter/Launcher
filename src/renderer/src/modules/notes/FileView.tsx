// 文件视图的头部与主体分发。文档状态在 files-store,这里只负责呈现。

import { useCallback } from 'react'
import {
  ARCHIVE_MAX_BYTES,
  IMAGE_MAX_BYTES,
  MODEL_MAX_BYTES,
  OFFICE_MAX_BYTES,
  parentOf,
  type NoteFileKind
} from '@shared/notes'
import { useT } from '../../hooks/useT'
import { formatBytes } from '../../lib/format-bytes'
import { noteFileIcon } from '../../lib/note-file'
import { noteFileUrl } from '../../lib/note-file-url'
import { showToast } from '../../lib/utils'
import { useFilesStore, type FileDoc, type FileViewMode } from '../../state/files-store'
import { useNotesStore } from '../../state/notes-store'
import { CsvView } from './file-views/CsvView'
import { FileEditor } from './FileEditor'
import { FilePlaceholder } from './file-views/FilePlaceholder'
import { HtmlViewer } from './file-views/HtmlViewer'
import { ImageViewer } from './file-views/ImageViewer'
import { MediaViewer } from './file-views/MediaViewer'
import { PdfViewer } from './file-views/PdfViewer'
import { OfficeView } from './file-views/OfficeView'
import { ArchiveView } from './file-views/ArchiveView'
import { ModelView } from './file-views/ModelView'
import { DecodedImageViewer } from './file-views/DecodedImageViewer'
import { CanvasView } from './file-views/CanvasView'
import { BytesLoader } from './file-views/BytesLoader'
import { Skeleton } from '../../components/ui/Skeleton'

/** 这些类型会写盘,头部显示保存状态 */
function isTextKind(kind: NoteFileKind): boolean {
  return kind === 'text' || kind === 'code' || kind === 'markdown' || kind === 'html' || kind === 'csv'
}

function wrapFor(f: FileDoc): boolean {
  if (f.kind === 'text' || f.kind === 'markdown' || f.kind === 'html' || f.kind === 'csv') return true
  return f.ext === 'css' || f.ext === 'scss' || f.ext === 'sass' || f.ext === 'less'
}

export function FileView(): React.JSX.Element {
  const t = useT()
  const railCollapsed = useNotesStore((s) => s.railCollapsed)
  const setRailCollapsed = useNotesStore((s) => s.setRailCollapsed)
  const file = useFilesStore((s) => s.file)
  const openingPath = useFilesStore((s) => s.openingPath)
  const dirty = useFilesStore((s) => s.dirty)
  const saving = useFilesStore((s) => s.saving)
  const conflict = useFilesStore((s) => s.conflict)
  const saveNonce = useFilesStore((s) => s.saveNonce)
  const docSession = useFilesStore((s) => s.docSession)
  const modes = useFilesStore((s) => s.viewModes)
  const setText = useFilesStore((s) => s.setText)
  const flush = useFilesStore((s) => s.flush)
  const reload = useFilesStore((s) => s.reload)
  const resolveConflict = useFilesStore((s) => s.resolveConflict)
  const setViewMode = useFilesStore((s) => s.setViewMode)

  const changeMode = useCallback(
    (kind: 'html' | 'csv', next: FileViewMode) => {
      void (async () => {
        // 切到预览前先把缓冲落盘:预览读的是磁盘,去抖窗口里的改动它会看不见
        if (next !== 'source' && useFilesStore.getState().dirty) await flush()
        setViewMode(kind, next)
      })()
    },
    [flush, setViewMode]
  )

  // 换文件时编辑器由 key 重建,滚动位置自然回到顶部
  if (file === null) {
    return (
      <div className="notes-main notes-main-empty">
        <button
          type="button"
          className="notes-rail-toggle floating"
          title={railCollapsed ? t('notes.rail.expand') : t('notes.rail.collapse')}
          onClick={() => setRailCollapsed(!railCollapsed)}
        >
          <i className={railCollapsed ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left'} />
        </button>
        {openingPath !== null ? (
          <Skeleton rows={8} />
        ) : (
          <div className="notes-firstrun">
            <div className="notes-firstrun-icon">
              <i className="fa-solid fa-file" />
            </div>
            <div className="notes-firstrun-title">{t('notes.pick.title')}</div>
            <p className="notes-firstrun-hint">{t('notes.pick.hint')}</p>
          </div>
        )}
      </div>
    )
  }

  const mode = file.kind === 'html' || file.kind === 'csv' ? modes[file.kind] : null
  const dirPart = parentOf(file.path)
  const editable = file.editable

  return (
    <div className="notes-main file-main">
      <div className="notes-hd file-hd">
        <button
          type="button"
          className="notes-rail-toggle"
          title={railCollapsed ? t('notes.rail.expand') : t('notes.rail.collapse')}
          onClick={() => setRailCollapsed(!railCollapsed)}
        >
          <i className={railCollapsed ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left'} />
        </button>
        <div className="notes-path file-path">
          <i
            className={`fa-solid ${noteFileIcon(file.ext, file.name)} notes-file-icon`}
            data-kind={file.kind}
            aria-hidden="true"
          />
          {dirPart !== '' && <span className="notes-path-dir">{dirPart}/</span>}
          <span className="notes-title-wrap">
            <span className="file-name">{file.name}</span>
          </span>
          <span className="file-meta">{formatBytes(file.size)}</span>
        </div>
        <div className="notes-hd-actions">
          {(isTextKind(file.kind) || file.kind === 'canvas') &&
            (saving ? (
              <span className="notes-save-state">{t('notes.save.saving')}</span>
            ) : dirty ? (
              <span className="notes-save-state dirty">{t('notes.save.dirty')}</span>
            ) : (
              <span className="notes-save-state">{t('notes.save.saved')}</span>
            ))}
          {!editable && <span className="file-badge">{t('notes.file.readonly')}</span>}
          {mode !== null && (
            <div className="notes-modes" role="group" aria-label={t('notes.file.preview')}>
              {(['source', 'preview', 'split'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={'notes-mode-btn' + (mode === m ? ' active' : '')}
                  title={t(`notes.file.${m}`)}
                  aria-label={t(`notes.file.${m}`)}
                  aria-pressed={mode === m}
                  onClick={() => changeMode(file.kind === 'html' ? 'html' : 'csv', m)}
                >
                  <i
                    className={
                      m === 'split'
                        ? 'fa-solid fa-table-columns'
                        : m === 'source'
                          ? 'fa-solid fa-code'
                          : 'fa-solid fa-eye'
                    }
                  />
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="notes-act"
            title={t('notes.file.reload')}
            onClick={() => {
              if (dirty) {
                showToast(t('notes.save.dirty'), '#fbbf24', 'fa-triangle-exclamation')
                return
              }
              void reload()
            }}
          >
            <i className="fa-solid fa-rotate" />
          </button>
          <button
            type="button"
            className="notes-act"
            title={t('notes.file.openExternal')}
            onClick={() => void useNotesStore.getState().openFile(file.path)}
          >
            <i className="fa-solid fa-arrow-up-right-from-square" />
          </button>
          <button
            type="button"
            className="notes-act"
            title={t('notes.file.reveal')}
            onClick={() => void window.launcher.notes.reveal(file.path)}
          >
            <i className="fa-solid fa-folder-open" />
          </button>
        </div>
      </div>

      {conflict !== null && (
        <div className="notes-banner conflict">
          <i className="fa-solid fa-code-merge" />
          <span>{t('notes.conflict.banner')}</span>
          <div className="notes-banner-actions">
            <button type="button" className="d-btn" onClick={() => void resolveConflict('disk')}>
              <span>{t('notes.conflict.useDisk')}</span>
            </button>
            <button type="button" className="d-btn accent" onClick={() => void resolveConflict('mine')}>
              <span>{t('notes.conflict.useMine')}</span>
            </button>
          </div>
        </div>
      )}

      <div className="file-body">
        {file.binaryReason !== null ? (
          <FilePlaceholder
            path={file.path}
            icon={noteFileIcon(file.ext, file.name)}
            title={
              file.binaryReason === 'too-large'
                ? t('notes.file.tooLarge')
                : file.binaryReason === 'unsupported-encoding'
                  ? t('notes.file.unsupportedEncoding')
                  : t('notes.file.binary')
            }
            hint={
              file.binaryReason === 'too-large'
                ? t('notes.file.tooLargeHint')
                : t('notes.file.binaryHint')
            }
          />
        ) : file.kind === 'html' || file.kind === 'csv' ? (
          <FileToggleBody
            key={docSession}
            file={file}
            mode={mode ?? 'preview'}
            saveNonce={saveNonce}
            onText={setText}
          />
        ) : file.kind === 'canvas' ? (
          <CanvasView key={docSession} text={file.text} />
        ) : isTextKind(file.kind) ? (
          <FileEditor
            key={docSession}
            value={file.text}
            onChange={setText}
            ext={file.ext}
            name={file.name}
            wrap={wrapFor(file)}
          />
        ) : (
          <BinaryBody file={file} saveNonce={saveNonce} />
        )}
      </div>
    </div>
  )
}

/** HTML / CSV 的源码 / 预览 / 分栏 */
function FileToggleBody({
  file,
  mode,
  saveNonce,
  onText
}: {
  file: FileDoc
  mode: FileViewMode
  saveNonce: number
  onText: (v: string) => void
}): React.JSX.Element {
  const editor = (
    <FileEditor
      value={file.text}
      onChange={onText}
      ext={file.ext}
      name={file.name}
      wrap={wrapFor(file)}
    />
  )
  const preview =
    file.kind === 'html' ? (
      <HtmlViewer src={noteFileUrl(file.path, saveNonce)} />
    ) : (
      <CsvView text={file.text} tsv={file.ext === 'tsv' || file.ext === 'tab'} />
    )
  if (mode === 'source') return editor
  if (mode === 'preview') return preview
  return (
    <div className="file-split">
      <div className="file-split-pane">{editor}</div>
      <div className="file-split-pane">{preview}</div>
    </div>
  )
}

/** 只读二进制类型 → 对应 viewer;不支持的类型给占位 */
function BinaryBody({ file, saveNonce }: { file: FileDoc; saveNonce: number }): React.JSX.Element {
  const t = useT()
  const url = noteFileUrl(file.path, file.mtimeMs)
  const kind = file.kind
  switch (kind) {
    case 'image':
      return <ImageViewer src={url} alt={file.name} />
    case 'psd':
    case 'tiff':
    case 'heic':
      return (
        <BytesLoader path={file.path} maxBytes={IMAGE_MAX_BYTES}>
          {(data) => (
            <DecodedImageViewer kind={kind} name={file.name} path={file.path} data={data} />
          )}
        </BytesLoader>
      )
    case 'pdf':
      return <PdfViewer src={noteFileUrl(file.path, saveNonce)} />
    case 'video':
    case 'audio':
      return <MediaViewer src={url} kind={kind} />
    case 'docx':
    case 'xlsx':
    case 'pptx':
      return (
        <BytesLoader path={file.path} maxBytes={OFFICE_MAX_BYTES}>
          {(data) => (
            <OfficeView kind={kind} name={file.name} path={file.path} data={data} />
          )}
        </BytesLoader>
      )
    case 'archive':
      return (
        <BytesLoader path={file.path} maxBytes={ARCHIVE_MAX_BYTES}>
          {(data) => <ArchiveView name={file.name} data={data} />}
        </BytesLoader>
      )
    case 'model':
      if (file.ext === 'gltf') {
        return <ModelView name={file.name} url={noteFileUrl(file.path, file.mtimeMs)} />
      }
      return (
        <BytesLoader path={file.path} maxBytes={MODEL_MAX_BYTES}>
          {(data) => <ModelView name={file.name} data={data} />}
        </BytesLoader>
      )
    case 'archive-unsupported':
      return (
        <FilePlaceholder
          path={file.path}
          icon="fa-file-zipper"
          title={t('notes.file.noPreview')}
          hint={t('notes.file.binaryHint')}
        />
      )
    case 'legacy-office':
      return (
        <FilePlaceholder
          path={file.path}
          icon="fa-file"
          title={t('notes.file.binary')}
          hint={t('notes.file.binaryHint')}
        />
      )
    default:
      return (
        <FilePlaceholder
          path={file.path}
          icon={noteFileIcon(file.ext, file.name)}
          title={t('notes.file.binary')}
          hint={t('notes.file.binaryHint')}
        />
      )
  }
}
