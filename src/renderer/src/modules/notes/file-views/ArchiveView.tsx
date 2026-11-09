// 压缩包:左侧条目树 + 右侧预览。条目是**字节源**,复用与磁盘文件相同的查看器;
// 嵌套压缩包递归渲染,深度上限 3。压缩包内 HTML 用 srcdoc + data URL 内联同包资源。

import { useEffect, useMemo, useState } from 'react'
import {
  ARCHIVE_DEPTH_MAX,
  ARCHIVE_HTML_MAX,
  noteFileMime,
  type NoteFileKind
} from '@shared/notes'
import { decodeTextBytes } from '@shared/text-file'
import { useT } from '../../../hooks/useT'
import { openArchive, archiveHtmlSrcdoc, extOf, type ArchiveEntry, type ArchiveSource } from '../../../lib/archive'
import { formatBytes } from '../../../lib/format-bytes'
import { fileKind, noteFileIcon } from '../../../lib/note-file'
import { FileEditor } from '../FileEditor'
import { CsvView } from './CsvView'
import { DecodedImageViewer } from './DecodedImageViewer'
import { FilePlaceholder } from './FilePlaceholder'
import { ImageViewer } from './ImageViewer'
import { MediaViewer } from './MediaViewer'
import { ModelView } from './ModelView'
import { OfficeView } from './OfficeView'

interface TreeRow {
  entry: ArchiveEntry
  depth: number
}

/** 目录优先、同级按名字排序;目录本身也占一行(缩进靠 path 的层数) */
function treeRows(entries: ArchiveEntry[]): TreeRow[] {
  const sorted = [...entries].sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1
    return a.path.localeCompare(b.path)
  })
  return sorted.map((entry) => ({ entry, depth: entry.path.split('/').length - 1 }))
}

export function ArchiveView({
  name,
  data,
  depth = 1,
  trail
}: {
  name: string
  data: Uint8Array
  depth?: number
  trail?: string[]
}): React.JSX.Element {
  const t = useT()
  const crumbs = trail ?? [name]
  const [source, setSource] = useState<ArchiveSource | null>(null)
  const [error, setError] = useState<'failed' | 'unpacked' | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const rows = useMemo(() => (source === null ? [] : treeRows(source.entries)), [source])

  useEffect(() => {
    let cancelled = false
    setSource(null)
    setError(null)
    setSelected(null)
    void (async () => {
      try {
        const out = await openArchive(name, data)
        if (cancelled) return
        setSource(out)
        const first = out.entries.find((e) => !e.dir)
        setSelected(first?.path ?? null)
      } catch (err) {
        if (cancelled) return
        const reason = (err as { reason?: string }).reason
        setError(reason === 'unpacked' ? 'unpacked' : 'failed')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [name, data])

  if (depth > ARCHIVE_DEPTH_MAX) {
    return (
      <FilePlaceholder
        path=""
        icon="fa-file-zipper"
        title={t('notes.file.archiveNestedTooDeep').replace('{DEPTH}', String(ARCHIVE_DEPTH_MAX))}
      />
    )
  }

  return (
    <div className="file-archive" data-archive-name={name}>
      <div className="file-archive-bar">
        <span className="file-archive-crumbs">
          <i className="fa-solid fa-file-zipper" />
          {crumbs.join(' / ')}
        </span>
        {source !== null && (
          <span className="file-archive-count">
            {source.entries.filter((e) => !e.dir).length}
            {source.truncatedEntries > 0 && ` (+${source.truncatedEntries})`}
          </span>
        )}
      </div>

      {error === 'failed' && (
        <FilePlaceholder path="" icon="fa-file-zipper" title={t('notes.file.archiveFailed')} />
      )}
      {error === 'unpacked' && (
        <FilePlaceholder
          path=""
          icon="fa-file-zipper"
          title={t('notes.file.archiveUnpackedTooLarge').replace('{SIZE}', formatBytes(256 * 1024 * 1024))}
        />
      )}

      {source !== null && (
        <div className="file-archive-body">
          <div className="file-archive-list" role="tree">
            {rows.length === 0 && <div className="file-archive-empty">{t('notes.file.archiveEmpty')}</div>}
            {rows.map(({ entry, depth: d }) => (
              <button
                key={`${entry.dir ? 'd' : 'f'}:${entry.path}`}
                type="button"
                role="treeitem"
                data-entry-path={entry.path}
                data-entry-dir={entry.dir ? '1' : undefined}
                className={
                  'file-archive-row' +
                  (entry.dir ? ' dir' : '') +
                  (!entry.dir && selected === entry.path ? ' active' : '')
                }
                style={{ paddingLeft: 8 + d * 14 }}
                onClick={() => {
                  if (!entry.dir) setSelected(entry.path)
                }}
              >
                <i
                  className={`fa-solid ${
                    entry.dir ? 'fa-folder' : noteFileIcon(extOf(entry.name), entry.name)
                  }`}
                />
                <span className="file-archive-name">{entry.name}</span>
                {!entry.dir && <span className="file-archive-size">{formatBytes(entry.size)}</span>}
              </button>
            ))}
          </div>
          <div className="file-archive-preview">
            {selected === null ? (
              <div className="file-placeholder">
                <i className="fa-solid fa-file-zipper" />
                <div>{t('notes.file.archiveEmpty')}</div>
              </div>
            ) : (
              <ArchiveEntryPreview
                source={source}
                path={selected}
                depth={depth}
                trail={crumbs}
              />
            )}
          </div>
        </div>
      )}

      {source === null && error === null && (
        <div className="file-placeholder" role="status">
          <i className="fa-solid fa-circle-notch fa-spin" />
          <div>{t('notes.file.loading')}</div>
        </div>
      )}
    </div>
  )
}

function archiveKind(path: string): NoteFileKind {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return fileKind(extOf(name), name)
}

function ArchiveEntryPreview({
  source,
  path,
  depth,
  trail
}: {
  source: ArchiveSource
  path: string
  depth: number
  trail: string[]
}): React.JSX.Element {
  const t = useT()
  const name = path.slice(path.lastIndexOf('/') + 1)
  const kind = archiveKind(path)
  const [data, setData] = useState<Uint8Array | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [srcdoc, setSrcdoc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    setData(null)
    setFailed(null)
    setObjectUrl(null)
    setSrcdoc(null)
    void (async () => {
      try {
        const bytes = await source.read(path)
        if (cancelled) return
        if (kind === 'html') {
          if (bytes.byteLength > ARCHIVE_HTML_MAX) {
            setFailed(t('notes.file.tooLarge'))
            return
          }
          const html = await archiveHtmlSrcdoc(path, bytes, source)
          if (!cancelled) setSrcdoc(html)
          return
        }
        if (kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'audio') {
          url = URL.createObjectURL(
            new Blob([new Uint8Array(bytes)], {
              type: kind === 'image' ? noteFileMime(extOf(name)) : kind === 'pdf' ? 'application/pdf' : ''
            })
          )
          setObjectUrl(url)
        }
        setData(bytes)
      } catch (err) {
        if (!cancelled) {
          const reason = (err as { reason?: string }).reason
          setFailed(
            reason === 'entry'
              ? t('notes.file.tooLarge')
              : reason === 'unpacked'
                ? t('notes.file.archiveUnpackedTooLarge').replace('{SIZE}', formatBytes(256 * 1024 * 1024))
                : t('notes.file.archiveFailed')
          )
        }
      }
    })()
    return () => {
      cancelled = true
      if (url !== null) URL.revokeObjectURL(url)
    }
  }, [source, path, kind, t])

  if (failed !== null) {
    return <FilePlaceholder path="" icon="fa-file-circle-xmark" title={failed} />
  }

  if (kind === 'html') {
    if (srcdoc === null) {
      return (
        <div className="file-placeholder" role="status">
          <i className="fa-solid fa-circle-notch fa-spin" />
          <div>{t('notes.file.loading')}</div>
        </div>
      )
    }
    return (
      <iframe
        className="file-preview-frame"
        data-file-frame="archive-html"
        title={name}
        sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
        srcDoc={srcdoc}
      />
    )
  }

  if (data === null) {
    return (
      <div className="file-placeholder" role="status">
        <i className="fa-solid fa-circle-notch fa-spin" />
        <div>{t('notes.file.loading')}</div>
      </div>
    )
  }

  const decoded = decodeTextBytes(data)
  switch (kind) {
    case 'text':
    case 'code':
    case 'markdown':
      return decoded.ok ? (
        <FileEditor
          value={decoded.decoded.text}
          onChange={() => undefined}
          ext={extOf(name)}
          name={name}
          wrap={kind !== 'code'}
          readOnly
        />
      ) : (
        <FilePlaceholder path="" icon="fa-file-lines" title={t('notes.file.binary')} />
      )
    case 'csv':
      return decoded.ok ? <CsvView text={decoded.decoded.text} tsv={extOf(name) === 'tsv'} /> : <FilePlaceholder path="" icon="fa-file-csv" title={t('notes.file.binary')} />
    case 'image':
      return objectUrl === null ? <></> : <ImageViewer src={objectUrl} alt={name} />
    case 'psd':
    case 'tiff':
    case 'heic':
      return <DecodedImageViewer kind={kind} name={name} path="" data={data} />
    case 'pdf':
      return objectUrl === null ? (
        <></>
      ) : (
        <iframe className="file-preview-frame" data-file-frame="pdf" title={name} src={objectUrl} />
      )
    case 'video':
    case 'audio':
      return objectUrl === null ? <></> : <MediaViewer src={objectUrl} kind={kind} />
    case 'docx':
    case 'xlsx':
    case 'pptx':
      return <OfficeView kind={kind} name={name} path="" data={data} />
    case 'model':
      return extOf(name) === 'gltf' ? (
        <FilePlaceholder path="" icon="fa-cube" title={t('notes.file.modelFailed')} />
      ) : (
        <ModelView name={name} data={data} />
      )
    case 'archive':
      return depth + 1 > ARCHIVE_DEPTH_MAX ? (
        <FilePlaceholder
          path=""
          icon="fa-file-zipper"
          title={t('notes.file.archiveNestedTooDeep').replace('{DEPTH}', String(ARCHIVE_DEPTH_MAX))}
        />
      ) : (
        <ArchiveView name={name} data={data} depth={depth + 1} trail={[...trail, name]} />
      )
    default:
      return (
        <FilePlaceholder
          path=""
          icon={noteFileIcon(extOf(name), name)}
          title={t('notes.file.binary')}
          hint={t('notes.file.binaryHint')}
        />
      )
  }
}
