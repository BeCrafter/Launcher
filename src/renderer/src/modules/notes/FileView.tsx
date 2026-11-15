// 文件视图的头部与主体分发。文档状态在 files-store,这里只负责呈现。

import { useCallback, useRef } from 'react'
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
import { DrawioView } from './file-views/DrawioView'
import type { DrawioFrameHandle } from './file-views/DrawioFrame'
import { effectiveDrawioMode, useDrawioStore } from '../../state/drawio-store'
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

  // draw.io:模式按钮在文件头,iframe 的 ref 用来在切换前导出一份最新 XML
  const drawioRef = useRef<DrawioFrameHandle>(null)
  const drawioPref = useDrawioStore((s) => s.mode)
  const drawioStatus = useDrawioStore((s) => s.status)
  const drawioPhase = useDrawioStore((s) => s.phase)
  const drawioProgress = useDrawioStore((s) => s.progress)
  const drawioError = useDrawioStore((s) => s.error)
  const drawioRequestOffline = useDrawioStore((s) => s.requestOffline)
  const drawioSwitchOnline = useDrawioStore((s) => s.switchOnline)
  const drawioDownload = useDrawioStore((s) => s.download)
  const drawioCancel = useDrawioStore((s) => s.cancel)
  const drawioImportWar = useDrawioStore((s) => s.importWar)
  const drawioDismiss = useDrawioStore((s) => s.dismissConfirm)
  const drawioMode = effectiveDrawioMode(drawioPref, drawioStatus)

  const switchDrawioMode = useCallback(async () => {
    // 切模式会重建 iframe:先把 draw.io 里还没 autosave 的那一拍导出来并落盘
    const latest = await drawioRef.current?.exportXml()
    if (latest != null && latest !== useFilesStore.getState().file?.text) {
      setText(latest)
    }
    if (useFilesStore.getState().dirty) await flush()
    if (drawioMode === 'offline') drawioSwitchOnline()
    else await drawioRequestOffline()
  }, [drawioMode, drawioRequestOffline, drawioSwitchOnline, flush, setText])

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
  const drawioPercent =
    drawioProgress !== null && drawioProgress.total > 0
      ? Math.min(100, Math.round((drawioProgress.received / drawioProgress.total) * 100))
      : null
  const drawioPhaseLabel =
    drawioProgress?.phase === 'verify'
      ? t('notes.drawio.verifying')
      : drawioProgress?.phase === 'extract'
        ? t('notes.drawio.extracting')
        : t('notes.drawio.downloading')

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
          {(isTextKind(file.kind) || file.kind === 'canvas' || file.kind === 'drawio') &&
            (saving ? (
              <span className="notes-save-state">{t('notes.save.saving')}</span>
            ) : dirty ? (
              <span className="notes-save-state dirty">{t('notes.save.dirty')}</span>
            ) : (
              <span className="notes-save-state">{t('notes.save.saved')}</span>
            ))}
          {!editable && file.kind !== 'drawio' && <span className="file-badge">{t('notes.file.readonly')}</span>}
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
          {file.kind === 'drawio' && (
            <button
              type="button"
              className="notes-act drawio-mode"
              data-drawio-mode={drawioMode}
              title={
                drawioMode === 'offline'
                  ? t('notes.drawio.switchOnline')
                  : t('notes.drawio.switchOffline')
              }
              aria-label={
                drawioMode === 'offline'
                  ? t('notes.drawio.switchOnline')
                  : t('notes.drawio.switchOffline')
              }
              onClick={() => void switchDrawioMode()}
            >
              <i className={drawioMode === 'offline' ? 'fa-solid fa-hard-drive' : 'fa-solid fa-cloud'} />
              <span>{drawioMode === 'offline' ? t('notes.drawio.offline') : t('notes.drawio.online')}</span>
            </button>
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

      {file.kind === 'drawio' && drawioPhase !== 'idle' && (
        <div className="notes-banner drawio-pack" data-drawio-phase={drawioPhase}>
          <i
            className={
              drawioPhase === 'downloading'
                ? 'fa-solid fa-circle-notch fa-spin'
                : drawioPhase === 'error'
                  ? 'fa-solid fa-triangle-exclamation'
                  : 'fa-solid fa-cloud-arrow-down'
            }
            aria-hidden="true"
          />
          <div className="drawio-pack-text">
            {drawioPhase === 'confirm' && <span>{t('notes.drawio.confirm')}</span>}
            {drawioPhase === 'downloading' && (
              <>
                <span>{drawioPhaseLabel}</span>
                {drawioPercent !== null && (
                  <span className="drawio-pack-pct">{drawioPercent}%</span>
                )}
                <div className="drawio-pack-bar" aria-hidden="true">
                  <span
                    className={drawioPercent === null ? 'indeterminate' : undefined}
                    style={drawioPercent === null ? undefined : { width: `${drawioPercent}%` }}
                  />
                </div>
              </>
            )}
            {drawioPhase === 'error' && (
              <span>{drawioError ?? t('notes.drawio.failed')}</span>
            )}
          </div>
          <div className="notes-banner-actions">
            {drawioPhase === 'confirm' && (
              <>
                <button type="button" className="d-btn accent" onClick={() => void drawioDownload()}>
                  <span>{t('notes.drawio.downloadAndSwitch')}</span>
                </button>
                <button
                  type="button"
                  className="d-btn"
                  onClick={() => void drawioImportWar(t('notes.drawio.pickWar'))}
                >
                  <span>{t('notes.drawio.pickWarShort')}</span>
                </button>
                <button type="button" className="d-btn" onClick={() => drawioDismiss()}>
                  <span>{t('common.cancel')}</span>
                </button>
              </>
            )}
            {drawioPhase === 'downloading' && (
              <button type="button" className="d-btn" onClick={() => void drawioCancel()}>
                <span>{t('common.cancel')}</span>
              </button>
            )}
            {drawioPhase === 'error' && (
              <>
                <button type="button" className="d-btn accent" onClick={() => void drawioDownload()}>
                  <span>{t('notes.drawio.retry')}</span>
                </button>
                <button
                  type="button"
                  className="d-btn"
                  onClick={() => void drawioImportWar(t('notes.drawio.pickWar'))}
                >
                  <span>{t('notes.drawio.pickWarShort')}</span>
                </button>
                <button type="button" className="d-btn" onClick={() => drawioDismiss()}>
                  <span>{t('common.cancel')}</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

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
        ) : file.kind === 'drawio' ? (
          <DrawioView
            key={docSession}
            text={file.text}
            frameRef={drawioRef}
            onAutosave={setText}
            onSave={(xml) => {
              setText(xml)
              void flush()
            }}
            onReplace={(xml) => {
              setText(xml)
              void flush()
            }}
            onOpenLink={(href) => void window.launcher.openExternal(href)}
          />
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
