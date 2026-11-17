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
  baseNameOf,
  isNoteFileEditable,
  noteFileKind,
  splitFileExt,
  type NoteFileKind
} from '@shared/notes'
import {
  resolveCanvasExternalRead,
  type CanvasExternalEmbed,
  type CanvasExternalRead
} from '@shared/canvas-external'
import {
  canvasDisplayPath,
  canvasEmbedRef,
  canvasRefBadge,
  isCanvasPath,
  type CanvasEmbedBadge,
  type CanvasInternalRef
} from '@shared/canvas-ref'
import { decodeTextBytes } from '@shared/text-file'
import { dataSource } from '../../../data'
import { useT } from '../../../hooks/useT'
import { useEffectiveTheme } from '../../../hooks/useEffectiveTheme'
import { useFilesStore } from '../../../state/files-store'
import { effectiveDrawioMode, useDrawioStore } from '../../../state/drawio-store'
import { boardOrigin, openFileDoc, openNoteDoc, type DocOrigin } from '../doc-actions'
import { isDrawioText } from '@shared/drawio'
import { highlightCodeNodes } from '../../../lib/code-highlight'
import { renderMarkdown, type CalloutKind, type DiagramBlock } from '../../../lib/markdown'
import { resolvePreviewSrc } from '../../../lib/note-asset'
import { noteFileIcon } from '../../../lib/note-file'
import { noteExternalUrl, noteFileUrl } from '../../../lib/note-file-url'
import { openExternal } from '../../../lib/utils'
import { MermaidBlock } from '../MermaidBlock'
import { ArchiveView } from './ArchiveView'
import { BytesLoader } from './BytesLoader'
import { CanvasBoardEmbed } from './CanvasBoardEmbed'
import { CsvView } from './CsvView'
import { DecodedImageViewer } from './DecodedImageViewer'
import { FilePlaceholder } from './FilePlaceholder'
import { HtmlViewer } from './HtmlViewer'
import { ImageViewer } from './ImageViewer'
import { MediaViewer } from './MediaViewer'
import { ModelView } from './ModelView'
import { OfficeView } from './OfficeView'
import { PdfViewer } from './PdfViewer'
import { DrawioFrame } from './DrawioFrame'

export function CanvasEmbed({
  element,
  appState,
  boardPath,
  depth = 0
}: {
  element: ExcalidrawEmbeddableElement
  appState: AppState
  /** 当前打开的白板路径。卡片指向它自己时显示「不能嵌入自己」。 */
  boardPath?: string | null
  /** 嵌套层数。0 = 这块白板自己,1 = 卡片里那块只读白板里的卡片。 */
  depth?: number
}): React.JSX.Element {
  const t = useT()
  const ref = canvasEmbedRef(element.customData, element.link ?? null)
  const external = ref !== null && ref.kind === 'external' ? ref : null
  const target = ref !== null && ref.kind !== 'external' && ref.kind !== 'web' ? ref : null
  const web = ref !== null && ref.kind === 'web' ? ref : null
  const activeEmbed = appState.activeEmbeddable
  const active = activeEmbed?.element.id === element.id && activeEmbed.state === 'active'
  const selected =
    appState.selectedElementIds?.[element.id] === true ||
    element.groupIds?.some((id) => appState.selectedElementIds?.[id] === true) === true
  const label = external !== null ? fileNameOf(external.source || external.project) : element.link ?? ''
  const path = ref === null ? null : canvasDisplayPath(ref)
  const kind: CanvasEmbedBadge | 'none' = ref === null ? 'none' : canvasRefBadge(ref)
  const badge =
    kind === 'note' || kind === 'vault' || kind === 'external' || kind === 'canvas'
      ? t(`notes.canvas.embed.badge.${kind}`)
      : null
  const rootRef = useRef<HTMLDivElement | null>(null)
  // 角标要长在 Excalidraw 的链接气泡上,可那个气泡是它自己渲染的,没有插槽。
  // 选中这张卡片时把文案写到根上的自定义属性,气泡链接前的伪元素读它;
  // 取消选中(或换成别的元素)就撤掉,别的元素的链接不会带上角标。
  useEffect(() => {
    if (!selected || badge === null) return
    const root = document.documentElement
    root.style.setProperty('--canvas-embed-badge', JSON.stringify(badge))
    return () => {
      root.style.removeProperty('--canvas-embed-badge')
    }
  }, [selected, badge])
  // 卡片进入交互后,用户可能正在框选正文。Excalidraw 在 document 上听 copy/cut,
  // 又把 Cmd+X / Delete 绑成「剪切 / 删除画布元素」。选区在卡片里时先把这些事件截住,
  // 但不 preventDefault —— 浏览器仍照原生选区把文字写进剪贴板。
  useEffect(() => {
    const node = rootRef.current
    if (!active || depth !== 0 || node === null) return
    const onClipboard = (event: ClipboardEvent): void => {
      if (selectionInside(node)) event.stopPropagation()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!selectionInside(node)) return
      const modifier = event.metaKey || event.ctrlKey
      if (modifier) {
        const key = event.key.toLowerCase()
        if (key === 'c' || key === 'x') event.stopPropagation()
        return
      }
      if (!event.altKey && (event.key === 'Backspace' || event.key === 'Delete')) {
        event.stopPropagation()
      }
    }
    window.addEventListener('copy', onClipboard, true)
    window.addEventListener('cut', onClipboard, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('copy', onClipboard, true)
      window.removeEventListener('cut', onClipboard, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [active, depth])
  // 跳过去以后文档页头部要能回来:来源就是这块正在看的外层白板。
  const docAction = canvasDocAction(target, depth, t, boardOrigin(boardPath))
  return (
    <div
      className="canvas-embed"
      ref={rootRef}
      data-embed-active={active ? 'true' : 'false'}
      data-embed-selected={selected ? 'true' : 'false'}
      data-embed-kind={kind}
      data-embed-depth={depth}
      data-embed-label={label}
      data-embed-path={path ?? ''}
      data-embed-action={docAction?.kind}
    >
      {docAction !== null && (
        <button
          type="button"
          className="canvas-embed-doc-open"
          data-embed-open=""
          title={docAction.label}
          aria-label={docAction.label}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            // 先让外层白板把未落盘的正文交出去;切文档时 leave() 也会再 flush 一次。
            void useFilesStore.getState().flush()
            docAction.run()
          }}
        >
          <i className={`fa-solid ${docAction.icon}`} />
        </button>
      )}
      {external !== null ? (
        <CanvasExternalCard embed={external} />
      ) : target === null ? (
        web !== null ? (
          <CanvasWebEmbed url={web.url} />
        ) : (
          <CanvasEmbedMissing />
        )
      ) : target.kind === 'note' ? (
        <CanvasNoteEmbed id={target.id} />
      ) : (
        <CanvasFileEmbed path={target.path} boardPath={boardPath} depth={depth} />
      )}
    </div>
  )
}

interface CanvasDocAction {
  kind: 'edit' | 'open'
  icon: string
  label: string
  run: () => void
}

/**
 * 卡片右上角给哪个入口。白板自己渲染「编辑白板」(见 CanvasBoardEmbed),这里不再重复;
 * 嵌套预览里也不该再挂一遍;库外文件没有库内路径,应用内编辑器打不开,同样留空。
 */
function canvasDocAction(
  target: CanvasInternalRef | null,
  depth: number,
  t: (key: string) => string,
  origin: DocOrigin | null
): CanvasDocAction | null {
  if (target === null || depth !== 0) return null
  if (target.kind === 'note') {
    const id = target.id
    return {
      kind: 'edit',
      icon: 'fa-pen-to-square',
      label: t('notes.canvas.embed.editNote'),
      run: () => openNoteDoc(id, origin)
    }
  }
  if (isCanvasPath(target.path)) return null
  const path = target.path
  const name = baseNameOf(path)
  const fileKind = noteFileKind(splitFileExt(name).ext, name)
  const editable = isNoteFileEditable(fileKind) || fileKind === 'drawio'
  return {
    kind: editable ? 'edit' : 'open',
    icon: editable ? 'fa-pen-to-square' : 'fa-arrow-up-right-from-square',
    label: t(editable ? 'notes.canvas.embed.editFile' : 'notes.canvas.embed.openFile'),
    run: () => openFileDoc(path, origin)
  }
}

/** 选区是否落在这块卡片里。折叠选区是光标,不算要复制的内容。 */
function selectionInside(node: Node): boolean {
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return false
  try {
    // 选区从卡片里起、拖到卡片外时,共同祖先已经不在卡片里;
    // 只要与卡片相交就算「要复制卡片内容」。
    return selection.getRangeAt(0).intersectsNode(node)
  } catch {
    return false
  }
}

/** 库外文件。原文件还在这台电脑上就读它,否则读打包进项目的那份。 */
function CanvasExternalCard({ embed }: { embed: CanvasExternalEmbed }): React.JSX.Element {
  const t = useT()
  const [read, setRead] = useState<CanvasExternalRead | null>(null)
  // canvasEmbedRef 每次渲染都给一个新对象。Excalidraw 在光标移动时也会重渲染,
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

function fileNameOf(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash < 0 ? path : path.slice(slash + 1)
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

function CanvasFileEmbed({
  path,
  url: externalUrl,
  boardPath,
  depth = 0
}: {
  path: string
  url?: string
  boardPath?: string | null
  depth?: number
}): React.JSX.Element {
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
    case 'drawio':
      return (
        <CanvasTextPreview
          path={path}
          url={bytes}
          render={(text) => <CanvasDrawioScroll text={text} title={name} />}
        />
      )
    case 'canvas':
      return <CanvasBoardEmbed path={path} boardPath={boardPath} depth={depth} />
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

/** 白板卡片里的 draw.io:只读 lightbox,模式跟随全局偏好(没装离线包就回退在线)。 */
function CanvasDrawioScroll({ text, title }: { text: string; title: string }): React.JSX.Element {
  const t = useT()
  const theme = useEffectiveTheme()
  const pref = useDrawioStore((s) => s.mode)
  const status = useDrawioStore((s) => s.status)
  const ensureStatus = useDrawioStore((s) => s.ensureStatus)

  useEffect(() => {
    void ensureStatus().catch(() => {})
  }, [ensureStatus])

  const valid = isDrawioText(text)
  if (!valid || status === null) {
    return (
      <div className="canvas-embed-state">
        <i
          className={
            valid ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-triangle-exclamation'
          }
          aria-hidden="true"
        />
        <span>{valid ? t('notes.drawio.loading') : t('notes.drawio.invalid')}</span>
      </div>
    )
  }
  return (
    <DrawioFrame
      xml={text}
      mode={effectiveDrawioMode(pref, status)}
      lightbox
      dark={theme === 'dark'}
      lang={document.documentElement.lang.toLowerCase().startsWith('en') ? 'en' : 'zh'}
      title={title}
      onOpenLink={(href) => openExternal(href)}
    />
  )
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
