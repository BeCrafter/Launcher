// 白板上的一块嵌入内容。笔记按预览样式渲染,库内文件按类型走现有查看器。
//
// 外层由 Excalidraw 按元素宽高定位并缩放,这里只负责填满它给的盒子。
// 卡片默认不接指针:第一次点击要能选中、拖动和删除元素。双击(Excalidraw
// 把它标成 active)之后才把指针交给内容,这样视频才能播放、笔记才能滚动。

import { useEffect, useRef, useState } from 'react'
import type { ExcalidrawEmbeddableElement } from '@excalidraw/excalidraw/element/types'
import type { AppState } from '@excalidraw/excalidraw/types'
import {
  ARCHIVE_MAX_BYTES,
  IMAGE_MAX_BYTES,
  MAX_TEXT_FILE_BYTES,
  MODEL_MAX_BYTES,
  OFFICE_MAX_BYTES,
  noteFileKind,
  type NoteFileKind
} from '@shared/notes'
import {
  readCanvasExternal,
  resolveCanvasExternalRead,
  type CanvasExternalEmbed,
  type CanvasExternalRead
} from '@shared/canvas-external'
import { decodeTextBytes } from '@shared/text-file'
import { dataSource } from '../../../data'
import { useT } from '../../../hooks/useT'
import { highlightCodeNodes } from '../../../lib/code-highlight'
import { renderMarkdown, type CalloutKind, type DiagramBlock } from '../../../lib/markdown'
import { resolvePreviewSrc } from '../../../lib/note-asset'
import { noteFileIcon } from '../../../lib/note-file'
import { noteExternalUrl, noteFileUrl } from '../../../lib/note-file-url'
import { openExternal } from '../../../lib/utils'
import { MermaidBlock } from '../MermaidBlock'
import { canvasEmbedTarget } from './canvas-embed'
import { ArchiveView } from './ArchiveView'
import { BytesLoader } from './BytesLoader'
import { CsvView } from './CsvView'
import { DecodedImageViewer } from './DecodedImageViewer'
import { FilePlaceholder } from './FilePlaceholder'
import { HtmlViewer } from './HtmlViewer'
import { ImageViewer } from './ImageViewer'
import { MediaViewer } from './MediaViewer'
import { ModelView } from './ModelView'
import { OfficeView } from './OfficeView'
import { PdfViewer } from './PdfViewer'

export function CanvasEmbed({
  element,
  appState
}: {
  element: ExcalidrawEmbeddableElement
  appState: AppState
}): React.JSX.Element {
  const external = readCanvasExternal(element.customData)
  const target = canvasEmbedTarget(element.link)
  const activeEmbed = appState.activeEmbeddable
  const active = activeEmbed?.element.id === element.id && activeEmbed.state === 'active'
  return (
    <div className="canvas-embed" data-embed-active={active ? 'true' : 'false'}>
      {external !== null ? (
        <CanvasExternalCard embed={external} />
      ) : target === null ? (
        <CanvasEmbedMissing />
      ) : target.kind === 'note' ? (
        <CanvasNoteEmbed id={target.id} />
      ) : target.kind === 'file' ? (
        <CanvasFileEmbed path={target.path} />
      ) : (
        <CanvasWebEmbed url={target.url} />
      )}
    </div>
  )
}

/** 库外文件。原文件还在这台电脑上就读它,否则读打包进项目的那份。 */
function CanvasExternalCard({ embed }: { embed: CanvasExternalEmbed }): React.JSX.Element {
  const t = useT()
  const [read, setRead] = useState<CanvasExternalRead | null>(null)
  // readCanvasExternal 每次渲染都给一个新对象。Excalidraw 在光标移动时也会重渲染,
  // 依赖整个对象会把卡片打回「正在加载」,视频和 PDF 就一直闪。只跟这三串字走。
  const source = embed.source
  const project = embed.project
  const host = embed.host
  const embedRef = useRef(embed)
  embedRef.current = embed

  useEffect(() => {
    let cancelled = false
    setRead(null)
    void dataSource()
      .notes.probeExternal({ source, host })
      .then((probe) => {
        if (cancelled) return
        setRead(
          resolveCanvasExternalRead(embedRef.current, {
            sourcePresent: probe.present
          })
        )
      })
      .catch(() => {
        if (!cancelled) setRead({ kind: 'missing' })
      })
    return () => {
      cancelled = true
    }
  }, [source, project, host])

  if (read === null) {
    return (
      <div className="canvas-embed-state">
        <span>{t('notes.canvas.embed.loading')}</span>
      </div>
    )
  }
  if (read.kind === 'missing') return <CanvasEmbedGone />
  if (read.kind === 'project') return <CanvasFileEmbed path={read.path} />
  return <CanvasFileEmbed path={read.path} url={noteExternalUrl(read.path)} />
}

function CanvasEmbedGone(): React.JSX.Element {
  const t = useT()
  return (
    <div className="canvas-embed-state">
      <i className="fa-solid fa-file-circle-xmark" />
      <span>{t('notes.canvas.embed.missing')}</span>
    </div>
  )
}

function CanvasEmbedMissing(): React.JSX.Element {
  const t = useT()
  return (
    <div className="canvas-embed-state">
      <i className="fa-solid fa-link-slash" />
      <span>{t('notes.canvas.embed.unavailable')}</span>
    </div>
  )
}

/**
 * 网页预览。沙箱跟笔记预览的网页嵌入同一套,不加 allow-downloads 和
 * allow-popups-to-escape-sandbox。地址跟应用同源时不放 iframe:
 * allow-same-origin 会让它变成同源,能碰到渲染进程。
 */
function CanvasWebEmbed({ url }: { url: string }): React.JSX.Element {
  const t = useT()
  const sameOrigin = isSameOrigin(url)
  return (
    <div className="canvas-embed-web">
      <div className="md-embed-bar">
        <i className="fa-solid fa-globe" />
        <span className="md-embed-url" title={url}>
          {url}
        </span>
        <button
          type="button"
          className="md-embed-open"
          title={t('notes.canvas.embed.open')}
          onClick={() => openExternal(url)}
        >
          <i className="fa-solid fa-arrow-up-right-from-square" />
        </button>
      </div>
      {sameOrigin ? (
        <CanvasEmbedMissing />
      ) : (
        <iframe
          className="md-embed-frame"
          src={url}
          title={url}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  )
}

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === window.location.origin
  } catch {
    return true
  }
}

function CanvasNoteEmbed({ id }: { id: string }): React.JSX.Element {
  const t = useT()
  const [body, setBody] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    setBody(null)
    setMissing(false)
    void dataSource()
      .notes.read(id)
      .then((note) => {
        if (cancelled) return
        if (note === null) {
          setMissing(true)
          return
        }
        setBody(note.body)
      })
      .catch(() => {
        if (!cancelled) setMissing(true)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (missing) return <CanvasEmbedMissing />
  if (body === null) {
    return (
      <div className="canvas-embed-state">
        <span>{t('notes.canvas.embed.loading')}</span>
      </div>
    )
  }
  return (
    <div className="canvas-embed-note notes-preview-body">
      {renderMarkdown(body, `canvas-${id}`, {
        extended: true,
        anchors: true,
        resolveImage: resolvePreviewSrc,
        resolveEmbed: resolvePreviewSrc,
        highlight: highlightCodeNodes,
        calloutLabel: (kind: CalloutKind) => t(`notes.callout.${kind}`),
        renderDiagram: (block: DiagramBlock) => (
          <MermaidBlock key={block.key} code={block.code} />
        )
      })}
    </div>
  )
}

function CanvasFileEmbed({ path, url: externalUrl }: { path: string; url?: string }): React.JSX.Element {
  const t = useT()
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const name = slash < 0 ? path : path.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
  const kind = noteFileKind(ext, name)
  const url = externalUrl ?? noteFileUrl(path)
  const bytes = externalUrl === undefined ? undefined : externalUrl

  switch (kind) {
    case 'image':
      return <ImageViewer src={url} alt={name} />
    case 'psd':
    case 'tiff':
    case 'heic':
      return (
        <BytesLoader path={path} url={bytes} maxBytes={IMAGE_MAX_BYTES}>
          {(data) => <DecodedImageViewer kind={kind} name={name} path={path} data={data} />}
        </BytesLoader>
      )
    case 'pdf':
      return <PdfViewer src={url} />
    case 'video':
    case 'audio':
      return <MediaViewer src={url} kind={kind} />
    case 'docx':
    case 'xlsx':
    case 'pptx':
      return (
        <BytesLoader path={path} url={bytes} maxBytes={OFFICE_MAX_BYTES}>
          {(data) => <OfficeView kind={kind} name={name} path={path} data={data} />}
        </BytesLoader>
      )
    case 'archive':
      return (
        <BytesLoader path={path} url={bytes} maxBytes={ARCHIVE_MAX_BYTES}>
          {(data) => <ArchiveView name={name} data={data} />}
        </BytesLoader>
      )
    case 'model':
      return ext === 'gltf' ? (
        <ModelView name={name} url={url} />
      ) : (
        <BytesLoader path={path} url={bytes} maxBytes={MODEL_MAX_BYTES}>
          {(data) => <ModelView name={name} data={data} />}
        </BytesLoader>
      )
    case 'html':
      return <HtmlViewer src={url} />
    case 'csv':
      return (
        <CanvasTextPreview
          path={path}
          url={bytes}
          render={(text) => <CsvView text={text} tsv={ext === 'tsv' || ext === 'tab'} />}
        />
      )
    case 'markdown':
      return (
        <CanvasTextPreview
          path={path}
          url={bytes}
          render={(text) => (
            <div className="canvas-embed-note notes-preview-body">
              {renderMarkdown(text, `canvas-file-${path}`, {
                extended: true,
                resolveImage: resolvePreviewSrc,
                highlight: highlightCodeNodes,
                calloutLabel: (callout: CalloutKind) => t(`notes.callout.${callout}`),
                renderDiagram: (block: DiagramBlock) => (
                  <MermaidBlock key={block.key} code={block.code} />
                )
              })}
            </div>
          )}
        />
      )
    case 'text':
    case 'code':
      return (
        <CanvasTextPreview
          path={path}
          url={bytes}
          render={(text) => (
            <pre className="canvas-embed-code md-code">
              <code>{text}</code>
            </pre>
          )}
        />
      )
    default:
      return (
        <FilePlaceholder
          path={path}
          icon={placeholderIcon(kind, ext, name)}
          title={t('notes.file.binary')}
          hint={t('notes.file.binaryHint')}
        />
      )
  }
}

function placeholderIcon(kind: NoteFileKind, ext: string, name: string): string {
  if (kind === 'archive-unsupported') return 'fa-file-zipper'
  if (kind === 'legacy-office') return 'fa-file'
  return noteFileIcon(ext, name)
}

/** 文本类文件要先读正文才能渲染。失败显示同一块「无法嵌入」。 */
function CanvasTextPreview({
  path,
  url,
  render
}: {
  path: string
  url?: string
  render: (text: string) => React.JSX.Element
}): React.JSX.Element {
  const t = useT()
  const [text, setText] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    setText(null)
    setMissing(false)
    const load =
      url === undefined
        ? dataSource()
            .notes.readFile(path)
            .then((out) => (out.ok && out.doc.editable ? out.doc.text : null))
        : fetch(url).then(async (response) => {
            if (!response.ok) return null
            const bytes = new Uint8Array(await response.arrayBuffer())
            if (bytes.byteLength > MAX_TEXT_FILE_BYTES) return null
            const decoded = decodeTextBytes(bytes)
            return decoded.ok ? decoded.decoded.text : null
          })
    void load
      .then((next) => {
        if (cancelled) return
        if (next === null) {
          setMissing(true)
          return
        }
        setText(next)
      })
      .catch(() => {
        if (!cancelled) setMissing(true)
      })
    return () => {
      cancelled = true
    }
  }, [path, url])

  if (missing) return <CanvasEmbedMissing />
  if (text === null) {
    return (
      <div className="canvas-embed-state">
        <span>{t('notes.canvas.embed.loading')}</span>
      </div>
    )
  }
  return render(text)
}
