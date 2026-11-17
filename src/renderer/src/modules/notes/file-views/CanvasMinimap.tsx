// 白板右下角的一簇:左边小地图开关,右边帮助按钮,中间留 8px。
// 两个按钮都是我们自己的,锚在 `.canvas-board` 上 —— Excalidraw 的帮助按钮在它的
// UI 层里,右侧栏停靠时 UI 层会变窄,帮助按钮就跟着离开右缘,和地图开关分开。
// 帮助对话框还是 Excalidraw 的:点这个按钮转调它自己的动作。
// 小地图主体是整张白板的栅格缩略图(exportToCanvas),生成前/失败时退回色块。
// 点空白把视口中心移过去,拖框平移,滚轮缩放并让光标下的点留住。
// 默认收起,点开关才展开;开/关都记在浏览器里,所有白板共用,不写进 .excal。
// 视口变化也不进撤销。

import { useEffect, useRef, useState } from 'react'
import {
  CaptureUpdateAction,
  exportToCanvas,
  getCommonBounds,
  getNonDeletedElements,
  getSceneVersion
} from '@excalidraw/excalidraw'
import type {
  AppState,
  ExcalidrawImperativeAPI,
  NormalizedZoomValue
} from '@excalidraw/excalidraw/types'
import { useT } from '../../../hooks/useT'
import {
  MINIMAP_HEIGHT,
  MINIMAP_THUMB_MAX,
  MINIMAP_WIDTH,
  boundsOfBlocks,
  centerOnMapPoint,
  dragView,
  minimapBlocks,
  minimapFrame,
  minimapOpenFrom,
  pointInView,
  thumbnailRect,
  zoomAtMapPoint,
  type ContentBounds,
  type MinimapScene,
  type SceneBox,
  type SceneViewport
} from './canvas-minimap'
import { BOARD_PREVIEW_MAX_ELEMENTS, canvasBoardExportAppState } from './canvas-board-preview'
import {
  embedCards,
  pickContentCards,
  type EmbedCard
} from './canvas-embed-cards'
import {
  createMinimapContentLoader
} from './canvas-embed-content-impl'
import type { CardContent, CardContentLoader } from './canvas-embed-content'
import { compositeEmbedCards } from './canvas-embed-draw'

const STORAGE_KEY = 'launcher.notes.canvas.minimap'
const VIEW_STROKE = '#6965db'
/** 元素改动后等这么久再重出缩略图,避免画笔拖动时每帧都导出。 */
const THUMB_DEBOUNCE_MS = 200
/** 与 Excalidraw 深色画布/导出用的滤镜一致。 */
const DARK_FILTER = 'invert(93%) hue-rotate(180deg)'

interface CachedThumb {
  canvas: HTMLCanvasElement
  bounds: ContentBounds
  /** 卡片合成状态:没有嵌入 / 只有类型卡 / 已加载真实内容。 */
  embeds: 'none' | 'base' | 'refined'
  /** 只算一次,E2E 每次 paint 都读它。 */
  embedsAttr: string
}

export function CanvasMinimap({
  api,
  theme,
  board,
  boardPath
}: {
  api: ExcalidrawImperativeAPI
  theme: 'light' | 'dark'
  /** 白板容器。帮助按钮借它找到 Excalidraw 自己的帮助入口。 */
  board: HTMLElement | null
  /** 当前白板路径。嵌自己的卡片不递归导出。 */
  boardPath?: string | null
}): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(readOpen)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<MinimapPaint | null>(null)
  const thumbRef = useRef<CachedThumb | null>(null)
  /** 缩略图是异步生成的;回来的结果不是最新一次请求就直接丢掉。 */
  const generationRef = useRef(0)
  const versionRef = useRef(-1)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const loaderRef = useRef<CardContentLoader | null>(null)
  if (loaderRef.current === null) loaderRef.current = createMinimapContentLoader()

  useEffect(() => {
    if (!open) return
    // 换白板 / 换主题时上一张缩略图已经不对了,先清掉,别让旧画面闪一下。
    thumbRef.current = null

    const paint = (): void => {
      const canvas = canvasRef.current
      if (canvas === null) return
      const context = canvas.getContext('2d')
      if (context === null) return

      // backing store 跟屏幕像素比走,逻辑坐标仍是 180×120;E2E 按 rect 换算不受影响。
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
      const width = Math.round(MINIMAP_WIDTH * dpr)
      const height = Math.round(MINIMAP_HEIGHT * dpr)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      const state = api.getAppState()
      const blocks = minimapBlocks(api.getSceneElements())
      const bounds = boundsOfBlocks(blocks)
      const viewport = sceneViewport(state)
      const frame = minimapFrame(bounds, viewport, MINIMAP_WIDTH, MINIMAP_HEIGHT)
      sceneRef.current = { blocks, viewport, frame }
      const thumb = blocks.length === 0 ? null : thumbRef.current

      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)

      // 底色和回退色块按 Excalidraw 深色的同一套滤镜处理。
      context.save()
      if (theme === 'dark') context.filter = DARK_FILTER
      context.fillStyle = boardBackground(state)
      context.fillRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT)
      if (thumb === null) {
        // 缩略图还没好(或元素太多/导出失败):先按外接框画色块,地图始终可用。
        for (const block of blocks) {
          context.fillStyle = block.color
          context.fillRect(
            frame.originX + block.x * frame.scale,
            frame.originY + block.y * frame.scale,
            Math.max(block.width * frame.scale, 1),
            Math.max(block.height * frame.scale, 1)
          )
        }
      }
      context.restore()

      // 缩略图自己已经按主题导出(exportWithDarkMode),这里不能再套滤镜。
      if (thumb !== null) {
        const rect = thumbnailRect(thumb.bounds, frame)
        context.drawImage(thumb.canvas, rect.x, rect.y, rect.width, rect.height)
      }

      context.strokeStyle = VIEW_STROKE
      context.lineWidth = 1.5
      context.strokeRect(frame.viewX, frame.viewY, frame.viewWidth, frame.viewHeight)

      canvas.dataset.thumb =
        thumb !== null ? 'ready' : blocks.length === 0 ? 'empty' : 'fallback'
      canvas.dataset.embedsStatus = thumb?.embeds ?? 'none'
      canvas.dataset.embeds = thumb?.embedsAttr ?? ''
      canvas.dataset.view = rectAttr({
        x: frame.viewX,
        y: frame.viewY,
        width: frame.viewWidth,
        height: frame.viewHeight
      })
      canvas.dataset.content =
        bounds === null ? '' : rectAttr(thumbnailRect(bounds, frame))
    }

    const refresh = async (): Promise<void> => {
      const generation = ++generationRef.current
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const elements = getNonDeletedElements(api.getSceneElements())
      // 太大或太空都不导出:保持回退色块/空白,别让渲染进程卡住。
      if (elements.length === 0 || elements.length > BOARD_PREVIEW_MAX_ELEMENTS) {
        thumbRef.current = null
        paint()
        return
      }
      const [minX, minY, maxX, maxY] = getCommonBounds(elements)
      if (![minX, minY, maxX, maxY].every((value) => Number.isFinite(value))) {
        thumbRef.current = null
        paint()
        return
      }
      const bounds: ContentBounds = { minX, minY, maxX, maxY }
      const cards = embedCards(elements, { boardPath, depth: 0 })
      try {
        const exported = await exportToCanvas({
          elements,
          files: api.getFiles(),
          appState: canvasBoardExportAppState(api.getAppState(), theme),
          maxWidthOrHeight: MINIMAP_THUMB_MAX,
          exportPadding: 0
        })
        if (generation !== generationRef.current) return
        const exportSize = { width: exported.width, height: exported.height }

        // 第一遍:基础导出 + 类型卡。不等文件,地图先可用。
        const base =
          cards.length === 0
            ? exported
            : compositeEmbedCards(exported, {
                cards,
                contents: new Map(),
                bounds,
                theme
              })
        thumbRef.current = {
          canvas: base,
          bounds,
          embeds: cards.length === 0 ? 'none' : 'base',
          embedsAttr: embedAttr(bounds, cards, new Map())
        }
        paint()

        // 第二遍:只给面积大的卡片读真实内容;失败/超时保持类型卡。
        const selected = pickContentCards(cards, exportSize, bounds)
        if (selected.length === 0) return
        const contents = await loaderRef.current!.load(selected, {
          signal: controller.signal,
          theme
        })
        if (generation !== generationRef.current || contents.size === 0) return
        const refined = compositeEmbedCards(exported, {
          cards,
          contents,
          bounds,
          theme
        })
        thumbRef.current = {
          canvas: refined,
          bounds,
          embeds: 'refined',
          embedsAttr: embedAttr(bounds, cards, contents)
        }
        paint()
      } catch (error) {
        if (generation !== generationRef.current) return
        console.warn('[canvas-minimap] 缩略图生成失败', error)
        thumbRef.current = null
        paint()
      }
    }

    const scheduleRefresh = (): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void refresh()
      }, THUMB_DEBOUNCE_MS)
    }

    versionRef.current = getSceneVersion(api.getSceneElements())
    paint()
    void refresh()

    const stopChange = api.onChange((elements) => {
      paint()
      // 只有元素真的变了才重出缩略图;选中、切换工具这类 appState 变化不付费。
      const version = getSceneVersion(elements)
      if (version === versionRef.current) return
      versionRef.current = version
      scheduleRefresh()
    })
    const stopScroll = api.onScrollChange(paint)
    return () => {
      generationRef.current += 1
      abortRef.current?.abort()
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      stopChange()
      stopScroll()
    }
  }, [api, open, theme, boardPath])

  // 白板根节点上的滚轮监听会平移画布,而且是捕获不到的冒泡监听。
  // React 的 onWheel 经常是 passive,preventDefault 不可靠。
  // 在小地图自己的 canvas 上用捕获阶段拦住,滚轮只留给这里的缩放。
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || !open) return
    const stopWheel = (event: WheelEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      const painted = sceneRef.current
      if (painted === null || event.deltaY === 0) return
      const point = mapPoint(canvas, event.clientX, event.clientY)
      applyScene(
        api,
        zoomAtMapPoint(painted.viewport, painted.frame, point.x, point.y, event.deltaY)
      )
    }
    canvas.addEventListener('wheel', stopWheel, { capture: true, passive: false })
    return () => canvas.removeEventListener('wheel', stopWheel, { capture: true })
  }, [api, open])

  const toggle = (): void => {
    setOpen((current) => {
      const next = !current
      writeOpen(next)
      return next
    })
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const painted = sceneRef.current
    const canvas = canvasRef.current
    if (painted === null || canvas === null) return
    const point = mapPoint(canvas, event.clientX, event.clientY)
    if (pointInView(painted.frame, point.x, point.y)) {
      const start = point
      const startViewport = painted.viewport
      const move = (next: PointerEvent): void => {
        const at = mapPoint(canvas, next.clientX, next.clientY)
        applyScene(api, dragView(startViewport, painted.frame, start.x, start.y, at.x, at.y))
      }
      const up = (): void => {
        canvas.removeEventListener('pointermove', move)
        canvas.removeEventListener('pointerup', up)
      }
      canvas.setPointerCapture(event.pointerId)
      canvas.addEventListener('pointermove', move)
      canvas.addEventListener('pointerup', up)
      return
    }
    applyScene(api, centerOnMapPoint(painted.viewport, painted.frame, point.x, point.y))
  }

  return (
    <div className="canvas-minimap">
      {open && (
        <canvas
          ref={canvasRef}
          className="canvas-minimap-map"
          width={MINIMAP_WIDTH}
          height={MINIMAP_HEIGHT}
          aria-label={t('notes.canvas.minimap')}
          onPointerDown={onPointerDown}
        />
      )}
      <div className="canvas-minimap-buttons">
        <button
          type="button"
          className="canvas-minimap-toggle"
          aria-pressed={open}
          title={t('notes.canvas.minimap')}
          onClick={toggle}
        >
          <MinimapIcon />
        </button>
        <button
          type="button"
          className="canvas-help-toggle"
          title={t('notes.canvas.help')}
          aria-label={t('notes.canvas.help')}
          onClick={() => openHelp(board)}
        >
          <HelpIcon />
        </button>
      </div>
    </div>
  )
}

interface MinimapPaint {
  blocks: SceneBox[]
  viewport: SceneViewport
  frame: ReturnType<typeof minimapFrame>
}

function applyScene(api: ExcalidrawImperativeAPI, next: MinimapScene): void {
  api.updateScene({
    appState: {
      scrollX: next.scrollX,
      scrollY: next.scrollY,
      zoom: { value: next.zoom as NormalizedZoomValue }
    },
    // 平移和缩放不进撤销。NEVER 仍会通知 onChange,但视口字段不写进 .excal。
    captureUpdate: CaptureUpdateAction.NEVER
  })
}

function sceneViewport(state: AppState): SceneViewport {
  return {
    scrollX: state.scrollX,
    scrollY: state.scrollY,
    zoom: state.zoom.value,
    width: state.width,
    height: state.height
  }
}

function mapPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): {
  x: number
  y: number
} {
  const box = canvas.getBoundingClientRect()
  return {
    x: ((clientX - box.left) / box.width) * MINIMAP_WIDTH,
    y: ((clientY - box.top) / box.height) * MINIMAP_HEIGHT
  }
}

function boardBackground(state: AppState): string {
  const value = state.viewBackgroundColor
  return typeof value === 'string' && value.trim() !== '' ? value : '#ffffff'
}

/** 给 E2E 读的矩形,小地图逻辑坐标,保留一位小数。 */
function rectAttr(rect: { x: number; y: number; width: number; height: number }): string {
  return [rect.x, rect.y, rect.width, rect.height].map((value) => value.toFixed(1)).join(',')
}

/**
 * 场景坐标里的内容外接框 + 每块卡片的位置与内容类型。E2E 用它们把卡片换算到
 * 小地图逻辑坐标,不依赖绘制结果去猜。`cards` 保持场景顺序。
 */
function embedAttr(
  bounds: ContentBounds,
  cards: readonly EmbedCard[],
  contents: ReadonlyMap<string, CardContent>
): string {
  return JSON.stringify({
    bounds: [round2(bounds.minX), round2(bounds.minY), round2(bounds.maxX), round2(bounds.maxY)],
    cards: cards.map((card) => ({
      id: card.id,
      kind: card.kind,
      mode: card.mode,
      content: contents.get(card.id)?.mode ?? 'type',
      rect: [
        round2(card.rect.x),
        round2(card.rect.y),
        round2(card.rect.width),
        round2(card.rect.height),
        round2(card.rect.angle)
      ]
    }))
  })
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function MinimapIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4.8 3.8 6.6v12.2L9 17l6 1.8 5.2-1.8V4.8L15 6.6 9 4.8z" />
      <path d="M9 4.8v12.2M15 6.6v12.2" />
    </svg>
  )
}

function HelpIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 4.4 1.5c-.9 1-1.9 1.3-1.9 2.8" />
      <path d="M12 17.1h.01" />
    </svg>
  )
}

/**
 * 打开 Excalidraw 自己的帮助对话框。原生按钮还留在 DOM 里(只是被 CSS 藏起来),
 * 直接点它最稳 —— 库换版本后也还是同一个动作。只看白板自己的那一层:
 * 卡片里的只读画布也可能有同名按钮,点它会开在卡片里面。
 * 找不到才退回给白板根节点派发 `?`。
 */
function openHelp(board: HTMLElement | null): void {
  const root = board === null ? null : board.querySelector<HTMLElement>(':scope > .excalidraw')
  const native = root?.querySelector<HTMLElement>('.layer-ui__wrapper .help-icon') ?? null
  if (native !== null) {
    native.click()
    return
  }
  root?.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))
}

function readOpen(): boolean {
  try {
    return minimapOpenFrom(localStorage.getItem(STORAGE_KEY))
  } catch {
    // 读不到就按默认:收起。想用时再点开关。
    return false
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, open ? 'true' : 'false')
  } catch {
    // 浏览器不让写时,这次打开期间仍按按钮状态显示。
  }
}
