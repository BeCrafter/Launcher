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
import {
  canvasDisplayPath,
  canvasEmbedAllowed,
  canvasEmbedRef,
  canvasInternalData
} from '@shared/canvas-ref'
import { useEffectiveTheme } from '../../../hooks/useEffectiveTheme'
import { useT } from '../../../hooks/useT'
import { getCurrentLang } from '../../../i18n'
import { useFilesStore } from '../../../state/files-store'
import { openExternal } from '../../../lib/utils'
import { recallBoardViewport, rememberBoardViewport } from '../../../lib/board-viewport'
import { boardOrigin, openFileDoc, openNoteDoc } from '../doc-actions'
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
  // 右侧栏展开时 Excalidraw 会把 UI 层收窄 --right-sidebar-width(302px),靠右对齐的帮助
  // 按钮就离开白板右缘、跑到画布中间;而小地图开关锚在白板上不动,两个按钮会分开。
  // 把「画布放得下侧栏」的阈值顶到最大:侧栏一律浮在画布上方(窄画布本来就是这样),
  // 右下角两个按钮始终贴右缘。
  dockedSidebarBreakpoint: Number.MAX_SAFE_INTEGER,
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
  if (canvasEmbedRef(element.customData, element.link ?? null)?.kind === 'web') {
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
  if (canvasEmbedRef(target.customData, target.link ?? null)?.kind === 'web') return
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

/**
 * 打开白板时把旧格式的引用就地升成可读路径:
 * 链接气泡直接显示 link,旧协议地址里全是 `%E4%B8%AD`,看不出引用了什么。
 *
 * 只改内存里的元素,**不**因此标脏、不主动写盘 —— 打开文件不该改文件。
 * 下次真正编辑时才跟着场景一起落盘;磁盘上的改名改写会同时认旧链接。
 */
function migrateCanvasElement(element: ExcalidrawElement): ExcalidrawElement {
  if (element.type !== 'embeddable') return element
  const ref = canvasEmbedRef(element.customData, element.link ?? null)
  if (ref === null || ref.kind === 'web') return element
  const link = canvasDisplayPath(ref)
  if (link === null) return element
  const customData =
    ref.kind === 'external' ? element.customData : canvasInternalData(ref, element.customData)
  if (link === element.link && customData === element.customData) return element
  return { ...element, link, customData }
}

export function CanvasView({ text, path }: { text: string; path?: string }): React.JSX.Element {
  const parsed = useMemo(() => parseCanvas(text), [text])
  if (!parsed.ok) return <CanvasError />
  return <CanvasBoard text={text} blank={parsed.blank} boardPath={path ?? null} />
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

function CanvasBoard({
  text,
  blank,
  boardPath
}: {
  text: string
  blank: boolean
  boardPath: string | null
}): React.JSX.Element {
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
    const appState = { ...restored.appState, collaborators: new Map() }
    // 视口不进文件(Excalidraw 标了 export: false),会话里单独记。上次看过就接着看,
    // 否则用 restore() 的默认值。
    const view = boardPath === null ? null : recallBoardViewport(boardPath)
    if (view !== null) {
      appState.scrollX = view.scrollX
      appState.scrollY = view.scrollY
      appState.zoom = { value: view.zoom.value }
    }
    return {
      elements: restored.elements.map(migrateCanvasElement),
      appState,
      files: restored.files
    }
    // initialData 只在挂载时读一次。换文件会重挂(FileView 的 key),不跟着每次保存变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blank, boardPath])

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
    // restoreElements 不保证留住 customData。真实引用写在它后面:
    // 内部引用进 launcher,库外文件进 embed。链接只是给人看的路径。
    const customData =
      pick.external !== undefined
        ? canvasExternalData(pick.external)
        : pick.ref !== undefined
          ? canvasInternalData(pick.ref)
          : null
    if (customData !== null) {
      Object.assign(element, { customData })
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
          <CanvasEmbed
            element={element}
            appState={appState}
            boardPath={boardPath}
            depth={0}
          />
        )}
        onLinkOpen={(element, event) => {
          const ref = canvasEmbedRef(element.customData, element.link ?? null)
          if (ref === null) return
          event.preventDefault()
          // Excalidraw 自带的蓝色链接角标也是入口,和卡片按钮一样记住来源白板。
          const origin = boardOrigin(boardPath)
          if (ref.kind === 'note') openNoteDoc(ref.id, origin)
          else if (ref.kind === 'file') openFileDoc(ref.path, origin)
          else if (ref.kind === 'web') openExternal(ref.url)
          // 库外文件没有通用的安全打开方式;卡片自己已经能预览
        }}
        onScrollChange={(scrollX, scrollY, zoom) => {
          // 平移与缩放都会走到这里;离开后重开同一块白板时接着看原来的位置。
          if (boardPath !== null) rememberBoardViewport(boardPath, { scrollX, scrollY, zoom })
        }}
      />
      {api !== null && boardRef.current !== null && (
        <>
          <CanvasEmbedMenu board={boardRef.current} onPick={insertEmbed} onWeb={beginWebEmbed} />
          <CanvasLibraryLoad api={api} board={boardRef.current} />
          <CanvasDropGuard api={api} board={boardRef.current} onEmbed={insertEmbed} />
          <CanvasMinimap
            api={api}
            theme={theme}
            board={boardRef.current}
            boardPath={boardPath}
          />
        </>
      )}
    </div>
  )
}
