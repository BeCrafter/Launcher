// 白板右下角的一簇:左边小地图开关,右边帮助按钮,中间留 8px。
// 两个按钮都是我们自己的,锚在 `.canvas-board` 上 —— Excalidraw 的帮助按钮在它的
// UI 层里,右侧栏停靠时 UI 层会变窄,帮助按钮就跟着离开右缘,和地图开关分开。
// 帮助对话框还是 Excalidraw 的:点这个按钮转调它自己的动作。
// 点空白把视口中心移过去,拖框平移,滚轮缩放并让光标下的点留住。
// 默认收起,点开关才展开;开/关都记在浏览器里,所有白板共用,不写进 .excal。
// 视口变化也不进撤销。

import { useEffect, useRef, useState } from 'react'
import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type {
  AppState,
  ExcalidrawImperativeAPI,
  NormalizedZoomValue
} from '@excalidraw/excalidraw/types'
import { useT } from '../../../hooks/useT'
import {
  MINIMAP_HEIGHT,
  MINIMAP_WIDTH,
  centerOnMapPoint,
  dragView,
  minimapBlocks,
  minimapFrame,
  minimapOpenFrom,
  pointInView,
  zoomAtMapPoint,
  type MinimapScene,
  type SceneBox,
  type SceneViewport
} from './canvas-minimap'

const STORAGE_KEY = 'launcher.notes.canvas.minimap'
const VIEW_STROKE = '#6965db'

export function CanvasMinimap({
  api,
  board
}: {
  api: ExcalidrawImperativeAPI
  /** 白板容器。帮助按钮借它找到 Excalidraw 自己的帮助入口。 */
  board: HTMLElement | null
}): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(readOpen)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<MinimapPaint | null>(null)

  useEffect(() => {
    const paint = (): void => {
      const canvas = canvasRef.current
      if (canvas === null || !open) return
      const state = api.getAppState()
      const blocks = minimapBlocks(api.getSceneElements())
      const viewport = sceneViewport(state)
      const frame = minimapFrame(blocks, viewport, MINIMAP_WIDTH, MINIMAP_HEIGHT)
      sceneRef.current = { blocks, viewport, frame }
      drawMinimap(canvas, blocks, frame)
    }
    paint()
    const stopChange = api.onChange(paint)
    const stopScroll = api.onScrollChange(paint)
    return () => {
      stopChange()
      stopScroll()
    }
  }, [api, open])

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

function drawMinimap(
  canvas: HTMLCanvasElement,
  blocks: readonly SceneBox[],
  frame: ReturnType<typeof minimapFrame>
): void {
  const context = canvas.getContext('2d')
  if (context === null) return
  context.clearRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT)
  for (const block of blocks) {
    context.fillStyle = block.color
    context.fillRect(
      frame.originX + block.x * frame.scale,
      frame.originY + block.y * frame.scale,
      Math.max(block.width * frame.scale, 1),
      Math.max(block.height * frame.scale, 1)
    )
  }
  context.strokeStyle = VIEW_STROKE
  context.lineWidth = 1.5
  context.strokeRect(frame.viewX, frame.viewY, frame.viewWidth, frame.viewHeight)
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
