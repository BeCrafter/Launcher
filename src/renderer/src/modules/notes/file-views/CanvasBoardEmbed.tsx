// 白板卡片里再嵌一块库内白板。
//
// 最外层(depth 0)挂一个**只读的 Excalidraw**,把子白板原样渲染出来:子白板里嵌的
// 图片、网页、PDF 走我们自己的 renderEmbeddable,和打开它时看到的一样。导出的 SVG
// 画不了这些(只有一个占位路径),所以只留作更深一层的兜底。
// 内层完全不吃指针:外层画布仍能选中、拖动这张卡片,滚轮和拖拽不会两边打架;
// 要看里面的细节就点右上角「编辑白板」。
// 再往里(depth ≥ 1)退回静态 SVG:一层只读画布足够,再套会越挂越重,还能无限套。

import { useEffect, useRef, useState } from 'react'
import {
  Excalidraw,
  exportToSvg,
  getNonDeletedElements,
  restore,
  THEME
} from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { ImportedDataState } from '@excalidraw/excalidraw/data/types'
import { canvasEmbedAllowed } from '@shared/canvas-ref'
import { dataSource } from '../../../data'
import { useEffectiveTheme } from '../../../hooks/useEffectiveTheme'
import { useT } from '../../../hooks/useT'
import { getCurrentLang } from '../../../i18n'
import { useFilesStore } from '../../../state/files-store'
import { boardOrigin, openFileDoc } from '../doc-actions'
import { CanvasEmbed } from './CanvasEmbed'
import {
  BOARD_PREVIEW_MAX_BYTES,
  BOARD_PREVIEW_PADDING,
  boardPreviewMode,
  canvasBoardExportAppState,
  canvasBoardPreviewPlan,
  isSelfBoardEmbed
} from './canvas-board-preview'

type BoardView = 'loading' | 'missing' | 'unavailable' | 'blank' | 'invalid' | 'too-large' | 'self' | 'ready'

const STATE_ICON: Record<Exclude<BoardView, 'ready'>, string> = {
  loading: 'fa-circle-notch fa-spin',
  missing: 'fa-file-circle-xmark',
  unavailable: 'fa-link-slash',
  blank: 'fa-chalkboard',
  invalid: 'fa-triangle-exclamation',
  'too-large': 'fa-file-circle-exclamation',
  self: 'fa-link-slash'
}

const STATE_TEXT: Record<Exclude<BoardView, 'ready'>, string> = {
  loading: 'notes.canvas.embed.loading',
  missing: 'notes.canvas.embed.missing',
  unavailable: 'notes.canvas.embed.unavailable',
  blank: 'notes.canvas.embed.board.blank',
  invalid: 'notes.canvas.embed.board.invalid',
  'too-large': 'notes.canvas.embed.board.tooLarge',
  self: 'notes.canvas.embed.board.self'
}

/** 只读预览里不需要任何编辑入口。侧栏也不许挤窄它(和主白板同一条规矩)。 */
const PREVIEW_UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false as const,
    saveAsImage: false,
    clearCanvas: false,
    changeViewBackgroundColor: false,
    toggleTheme: false
  },
  dockedSidebarBreakpoint: Number.MAX_SAFE_INTEGER
}

interface LiveBoard {
  elements: readonly ExcalidrawElement[]
  files: BinaryFiles
  background: string
}

export function CanvasBoardEmbed({
  path,
  boardPath,
  depth = 0
}: {
  path: string
  /** 当前打开的白板。和 path 相同就是白板嵌了自己。 */
  boardPath?: string | null
  /** 嵌套层数。0 = 直接摆在主白板上,再往里就不挂画布了。 */
  depth?: number
}): React.JSX.Element {
  const t = useT()
  const theme = useEffectiveTheme()
  const host = useRef<HTMLDivElement | null>(null)
  const self = isSelfBoardEmbed(path, boardPath)
  const live = boardPreviewMode(depth) === 'live'
  const [view, setView] = useState<BoardView>(self ? 'self' : 'loading')
  const [scene, setScene] = useState<LiveBoard | null>(null)

  useEffect(() => {
    const node = host.current
    node?.replaceChildren()
    setScene(null)
    if (self) {
      setView('self')
      return
    }
    let cancelled = false
    setView('loading')
    void (async () => {
      const loaded = await loadBoard(path)
      if (cancelled) return
      if (!loaded.ok) {
        setView(loaded.reason)
        return
      }
      const plan = canvasBoardPreviewPlan(loaded)
      if (plan.kind !== 'ready') {
        setView(plan.kind)
        return
      }
      try {
        // restore 一次拿场景自己的背景色和二进制文件;元素数在上面按上限拦过。
        const restored = restore(plan.data as ImportedDataState, null, null)
        const elements = getNonDeletedElements(restored.elements)
        if (elements.length === 0) {
          if (!cancelled) setView('blank')
          return
        }
        if (live) {
          if (cancelled) return
          setScene({
            elements,
            files: restored.files,
            background: canvasBoardExportAppState(restored.appState, theme).viewBackgroundColor
          })
          setView('ready')
          return
        }
        const svg = await exportToSvg({
          elements,
          appState: canvasBoardExportAppState(restored.appState, theme),
          files: restored.files,
          exportPadding: BOARD_PREVIEW_PADDING,
          renderEmbeddables: false
        })
        if (cancelled) return
        const target = host.current
        if (target === null) return
        target.replaceChildren(svg)
        setView('ready')
      } catch {
        if (!cancelled) setView('invalid')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path, self, theme, live])

  // 嵌套只读预览不再挂重复入口:点不着第二层卡片上的按钮,真正要编辑的是外层那张卡片。
  const canOpen = view !== 'missing' && view !== 'self' && depth === 0

  return (
    <>
      {live ? (
        <div className="canvas-embed-board" data-board-preview={view}>
          {scene !== null && view === 'ready' && (
            <LiveBoard
              elements={scene.elements}
              files={scene.files}
              background={scene.background}
              theme={theme}
              boardPath={path}
              depth={depth}
            />
          )}
        </div>
      ) : (
        <div className="canvas-embed-board" ref={host} data-board-preview={view} />
      )}
      {view !== 'ready' && (
        <div className="canvas-embed-state">
          <i
            className={`fa-solid ${STATE_ICON[view]}`}
            aria-hidden="true"
          />
          <span>{t(STATE_TEXT[view])}</span>
        </div>
      )}
      {canOpen && (
        <button
          type="button"
          className="md-embed-open canvas-embed-doc-open"
          data-embed-open=""
          title={t('notes.canvas.embed.editBoard')}
          aria-label={t('notes.canvas.embed.editBoard')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            // 先让外层白板把未落盘的正文交出去;flush 同步捕获待写内容,再切文档不会丢。
            void useFilesStore.getState().flush()
            // 来源是**外层**这块白板,不是被打开的子白板:文档页里按返回要回到这里。
            openFileDoc(path, boardOrigin(boardPath))
          }}
        >
          <i className="fa-solid fa-pen-to-square" />
        </button>
      )}
    </>
  )
}

/**
 * 卡片里的那块只读白板。画布、元素和嵌入都由 Excalidraw 自己排;
 * 我们只负责两件事:换主题时它自己重画,尺寸一变把内容重新装进卡片。
 */
function LiveBoard({
  elements,
  files,
  background,
  theme,
  boardPath,
  depth
}: {
  elements: readonly ExcalidrawElement[]
  files: BinaryFiles
  background: string
  theme: 'light' | 'dark'
  boardPath: string
  depth: number
}): React.JSX.Element {
  const frame = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)

  // 卡片可能被拖大拖小。每次尺寸变化都按内容重排一次,和打开子白板时看到的构图一致。
  useEffect(() => {
    const node = frame.current
    if (node === null) return
    let raf = 0
    const fit = (): void => {
      const api = apiRef.current
      if (api === null) return
      api.scrollToContent([...elements], { fitToContent: true, animate: false })
    }
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(fit)
    })
    observer.observe(node)
    fit()
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [elements])

  return (
    <div className="canvas-embed-board-live" ref={frame}>
      <Excalidraw
        viewModeEnabled
        theme={theme === 'light' ? THEME.LIGHT : THEME.DARK}
        langCode={getCurrentLang() === 'zh-CN' ? 'zh-CN' : 'en'}
        handleKeyboardGlobally={false}
        initialData={{
          elements: [...elements],
          appState: { viewBackgroundColor: background, scrollX: 0, scrollY: 0 },
          files
        }}
        UIOptions={PREVIEW_UI_OPTIONS}
        validateEmbeddable={canvasEmbedAllowed}
        renderEmbeddable={(element, appState) => (
          <CanvasEmbed
            element={element}
            appState={appState}
            boardPath={boardPath}
            depth={depth + 1}
          />
        )}
        onLinkOpen={(_element, event) => event.preventDefault()}
        excalidrawAPI={(api) => {
          apiRef.current = api
          api.scrollToContent([...elements], { fitToContent: true, animate: false })
        }}
      />
    </div>
  )
}

type BoardLoad =
  | { ok: true; text: string; size: number }
  | { ok: false; reason: 'missing' | 'unavailable' | 'too-large' }

/** 先 stat 拦大小,再读正文。8 MiB 之外的白板不为了看一眼预览去搬整份文本。 */
async function loadBoard(path: string): Promise<BoardLoad> {
  try {
    const stat = await dataSource().notes.statFile(path)
    if (stat === null) return { ok: false, reason: 'missing' }
    if (stat.size > BOARD_PREVIEW_MAX_BYTES) return { ok: false, reason: 'too-large' }
    const out = await dataSource().notes.readFile(path)
    if (!out.ok) {
      return { ok: false, reason: out.kind === 'not-found' ? 'missing' : 'unavailable' }
    }
    if (!out.doc.editable) {
      return { ok: false, reason: out.doc.tooLarge ? 'too-large' : 'unavailable' }
    }
    return { ok: true, text: out.doc.text, size: out.doc.size }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}
