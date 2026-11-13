// 白板右下角的小地图。开关在帮助按钮左边,中间留空,地图右缘跟帮助按钮对齐。
// 点空白把视口中心移过去,拖框平移,滚轮缩放并让光标下的点留住。
// 开关记在浏览器里,所有白板共用,不写进 .excal。视口变化也不进撤销。

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
  pointInView,
  zoomAtMapPoint,
  type MinimapScene,
  type SceneBox,
  type SceneViewport
} from './canvas-minimap'

const STORAGE_KEY = 'launcher.notes.canvas.minimap'
const VIEW_STROKE = '#6965db'

export function CanvasMinimap({
  api
}: {
  api: ExcalidrawImperativeAPI
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
      <button
        type="button"
        className="canvas-minimap-toggle"
        aria-pressed={open}
        title={t('notes.canvas.minimap')}
        onClick={toggle}
      >
        <MinimapIcon />
      </button>
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

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, open ? 'true' : 'false')
  } catch {
    // 浏览器不让写时,这次打开期间仍按按钮状态显示。
  }
}
