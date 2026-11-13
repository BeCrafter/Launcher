// Excalidraw 白板。库内新建是 .excal,已经在库里的 .excalidraw 也按白板打开。
// 正文是它自己的场景 JSON。打开、保存走现有的文件读写,不走它自己的系统对话框。
// 导出仍是它菜单里的「保存到磁盘」,文件名写死 .excalidraw。
// 笔记、库内文件和 http(s) 网页嵌成 embeddable 元素。

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import {
  CaptureUpdateAction,
  Excalidraw,
  newElementWith,
  restore,
  restoreElements,
  serializeAsJSON,
  viewportCoordsToSceneCoords,
  THEME
} from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI
} from '@excalidraw/excalidraw/types'
import type { ImportedDataState } from '@excalidraw/excalidraw/data/types'
import '@excalidraw/excalidraw/index.css'
import { parseCanvas } from '@shared/canvas'
import { canvasExternalData } from '@shared/canvas-external'
import { useEffectiveTheme } from '../../../hooks/useEffectiveTheme'
import { useT } from '../../../hooks/useT'
import { getCurrentLang } from '../../../i18n'
import { useFilesStore } from '../../../state/files-store'
import { openExternal } from '../../../lib/utils'
import { openFileDoc, openNoteDoc } from '../doc-actions'
import { canvasEmbedAllowed, canvasEmbedTarget } from './canvas-embed'
import { CanvasEmbed } from './CanvasEmbed'
// 模块一加载就改掉白板容器上的滚轮监听,必须赶在 Excalidraw 挂监听之前。
import './canvas-wheel'
import { CanvasEmbedMenu } from './CanvasEmbedMenu'
import type { CanvasEmbedPick } from './CanvasEmbedPicker'
import { CanvasDropGuard } from './CanvasDropGuard'
import { CanvasLibraryLoad } from './CanvasLibraryLoad'
import { CanvasMinimap } from './CanvasMinimap'

const ASSET_PATH = new URL('excalidraw-assets/', window.location.href).toString()
window.EXCALIDRAW_ASSET_PATH = ASSET_PATH

const UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: { saveFileToDisk: true },
    saveAsImage: true,
    clearCanvas: true,
    changeViewBackgroundColor: true
  }
}

const EMBED_WIDTH = 360
const EMBED_HEIGHT = 240

interface WebEmbedWatch {
  /** 点「网页」时已经在场上的元素。之后新出现的那块才是这次拖出来的。 */
  known: Set<string>
  id: string | null
  /** 地址框真正打开过。拖的过程中还没有框,不能当成取消。 */
  sawEditor: boolean
}

/**
 * 地址框从打开变成关掉,且这块还不是合法网页时,返回要删的 id。
 * 拖动途中、框还开着、已经填进合法地址,都返回 null。
 */
function takeUnlinkedWebEmbed(
  watch: MutableRefObject<WebEmbedWatch | null>,
  elements: readonly ExcalidrawElement[],
  appState: AppState
): string | null {
  const pending = watch.current
  if (pending === null) return null
  if (pending.id === null) {
    const created = elements.find(
      (element) => element.type === 'embeddable' && !element.isDeleted && !pending.known.has(element.id)
    )
    if (created !== undefined) pending.id = created.id
  }
  if (appState.showHyperlinkPopup === 'editor') pending.sawEditor = true
  if (pending.id === null) {
    if (appState.activeTool.type !== 'embeddable' && appState.showHyperlinkPopup !== 'editor') {
      watch.current = null
    }
    return null
  }
  const element = elements.find((item) => item.id === pending.id)
  if (element === undefined || element.isDeleted) {
    watch.current = null
    return null
  }
  if (canvasEmbedTarget(element.link ?? null)?.kind === 'web') {
    watch.current = null
    return null
  }
  if (!pending.sawEditor || appState.showHyperlinkPopup === 'editor') return null
  watch.current = null
  return element.id
}

/** 下一帧再看一次。地址是在框卸载时才写上的,同一轮还读不到。 */
function discardUnlinkedEmbed(api: ExcalidrawImperativeAPI, id: string): void {
  const elements = api.getSceneElementsIncludingDeleted()
  const target = elements.find((element) => element.id === id)
  if (target === undefined || target.isDeleted) return
  if (canvasEmbedTarget(target.link ?? null)?.kind === 'web') return
  api.updateScene({
    elements: elements.map((element) =>
      element.id === id ? newElementWith(element, { isDeleted: true }) : element
    ),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY
  })
}

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string
  }
}

function blankScene(): string {
  return serializeAsJSON([], {} as AppState, {} as BinaryFiles, 'local')
}

export function CanvasView({ text }: { text: string }): React.JSX.Element {
  const parsed = useMemo(() => parseCanvas(text), [text])
  if (!parsed.ok) return <CanvasError />
  return <CanvasBoard text={text} blank={parsed.blank} />
}

function CanvasError(): React.JSX.Element {
  const t = useT()
  return (
    <div className="canvas-error">
      <i className="fa-solid fa-triangle-exclamation" />
      <div className="canvas-error-title">{t('notes.canvas.error.title')}</div>
      <button
        type="button"
        className="d-btn accent"
        onClick={() => useFilesStore.getState().setText(blankScene())}
      >
        <span>{t('notes.canvas.error.replace')}</span>
      </button>
    </div>
  )
}

function CanvasBoard({ text, blank }: { text: string; blank: boolean }): React.JSX.Element {
  const theme = useEffectiveTheme()
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  // 空文件打开不算改过。第一次出现元素才开始写,之后即使删到零也照写。
  const written = useRef(!blank)
  // 「网页」切到画布上拖。地址框关掉时还没有合法链接,就删掉这一块,不留空卡片。
  const webWatch = useRef<WebEmbedWatch | null>(null)
  const initialData = useMemo(() => {
    if (blank) return null
    const parsed = parseCanvas(text)
    if (!parsed.ok || parsed.blank) return null
    const restored = restore(parsed.data as ImportedDataState, null, null)
    return {
      elements: restored.elements,
      appState: { ...restored.appState, collaborators: new Map() },
      files: restored.files
    }
    // initialData 只在挂载时读一次。换文件会重挂(FileView 的 key),不跟着每次保存变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blank])

  useEffect(() => {
    if (api === null) return
    let frame = 0
    const stop = api.onChange((elements, appState, files) => {
      const dropId = takeUnlinkedWebEmbed(webWatch, elements, appState)
      if (dropId !== null) {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => discardUnlinkedEmbed(api, dropId))
      }
      const live = elements.some((element) => !element.isDeleted)
      if (!written.current) {
        if (!live) return
        written.current = true
      }
      useFilesStore.getState().setText(serializeAsJSON(elements, appState, files, 'local'))
    })
    return () => {
      cancelAnimationFrame(frame)
      webWatch.current = null
      stop()
    }
  }, [api])

  const beginWebEmbed = (): void => {
    if (api === null) return
    webWatch.current = {
      known: new Set(api.getSceneElementsIncludingDeleted().map((element) => element.id)),
      id: null,
      sawEditor: false
    }
    api.setActiveTool({ type: 'embeddable' })
  }

  const insertEmbed = (pick: CanvasEmbedPick): void => {
    if (api === null) return
    const appState = api.getAppState()
    const board = boardRef.current?.getBoundingClientRect()
    const center = viewportCoordsToSceneCoords(
      {
        clientX: (board?.left ?? 0) + (board?.width ?? appState.width) / 2,
        clientY: (board?.top ?? 0) + (board?.height ?? appState.height) / 2
      },
      appState
    )
    // 每块都放在视口中间,只在垂直方向错开。横向排会把早放的推到视口外,
    // Excalidraw 不挂视口外的嵌入,重开时就看不见。不改缩放。
    const placed = api
      .getSceneElements()
      .filter((el) => el.type === 'embeddable' && !el.isDeleted).length
    // restoreElements 运行时补齐 id、seed、版本这些字段,类型声明却要求完整元素。
    const [element] = restoreElements(
      [
        {
          type: 'embeddable',
          x: center.x - EMBED_WIDTH / 2,
          y: center.y - EMBED_HEIGHT / 2 + placed * 48,
          width: EMBED_WIDTH,
          height: EMBED_HEIGHT,
          link: pick.link,
          strokeColor: 'transparent',
          backgroundColor: 'transparent'
        } as ExcalidrawElement
      ],
      null
    )
    if (element === undefined) return
    // restoreElements 不保证留住 customData。外部文件的两条路径写在它后面。
    if (pick.external !== undefined) {
      Object.assign(element, { customData: canvasExternalData(pick.external) })
    }
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), element],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    })
  }

  return (
    <div className="canvas-board" ref={boardRef}>
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        theme={theme === 'light' ? THEME.LIGHT : THEME.DARK}
        langCode={getCurrentLang() === 'zh-CN' ? 'zh-CN' : 'en'}
        handleKeyboardGlobally={false}
        UIOptions={UI_OPTIONS}
        validateEmbeddable={canvasEmbedAllowed}
        renderEmbeddable={(element, appState) => (
          <CanvasEmbed element={element} appState={appState} />
        )}
        onLinkOpen={(element, event) => {
          const target = canvasEmbedTarget(element.link)
          if (target === null) return
          event.preventDefault()
          if (target.kind === 'note') openNoteDoc(target.id)
          else if (target.kind === 'file') openFileDoc(target.path)
          else openExternal(target.url)
        }}
      />
      {api !== null && boardRef.current !== null && (
        <>
          <CanvasEmbedMenu board={boardRef.current} onPick={insertEmbed} onWeb={beginWebEmbed} />
          <CanvasLibraryLoad api={api} board={boardRef.current} />
          <CanvasDropGuard api={api} board={boardRef.current} onEmbed={insertEmbed} />
          <CanvasMinimap api={api} />
        </>
      )}
    </div>
  )
}
