// 全屏媒体查看器:笔记阅读模式里点图片 / 图表后弹出,可缩放与拖动。
//
// 几个刻意的选择:
//   · 1 倍 = 适应窗口(max-width/height 把大图缩进视口),往上才叫放大,不提供缩小到 1 以下;
//   · 滚轮用**原生非 passive 监听**:React 根上的 wheel 是 passive 的,preventDefault 无效;
//   · 缩放锚定光标 —— 放大时用户盯着哪块,哪块就留在原处;
//   · 拖动只在放大后启用,并夹紧到内容边缘,避免把图甩出屏幕找不回来;
//   · 图表由 mermaid 产出的是已净化 SVG,沿用 MermaidBlock 的 ref + innerHTML 注入,
//     不经过 React,也就不存在把用户输入送进 JSX 的路径;
//   · **图表放大靠放大它的布局尺寸,而不是 transform: scale** —— 合成层会把 SVG 按
//     变换前的尺寸栅格化,再拉伸这张位图,文字与细线就糊了;改尺寸会让浏览器按目标
//     尺寸重绘矢量(见下面「图表放大 = 放大 SVG 的布局尺寸」那组 effect)。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../../hooks/useT'
import { useLightboxStore, type LightboxItem } from '../../state/lightbox-store'

const MIN_SCALE = 1
const MAX_SCALE = 8
const ZOOM_STEP = 1.25
/** 双击放大到的倍数;再双击回到适应窗口 */
const DOUBLE_CLICK_SCALE = 2.5
/** 拖动超过这个距离才算出「拖」,否则仍视为点击(用于抑制背景关闭) */
const DRAG_THRESHOLD = 3
const KEY_PAN_STEP = 60

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * 只认 `viewBox="minX minY w h"`(空格 / 逗号都行)。返回 null = 不能用尺寸缩放:
 * 没有 viewBox 的 SVG 改宽高只会改变视口,内容不会跟着放大。
 */
function viewBoxSize(el: Element): { w: number; h: number } | null {
  const raw = el.getAttribute('viewBox')
  if (raw === null) return null
  const parts = raw.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4) return null
  const w = parts[2]
  const h = parts[3]
  if (w === undefined || h === undefined || !Number.isFinite(w) || !Number.isFinite(h)) return null
  return w > 0 && h > 0 ? { w, h } : null
}

export function MediaLightbox(): React.JSX.Element | null {
  const item = useLightboxStore((s) => s.item)
  const seq = useLightboxStore((s) => s.seq)
  const close = useLightboxStore((s) => s.close)

  if (item === null) return null
  // key = seq:每次打开都从适应窗口开始,不继承上一次的缩放
  return <LightboxView key={seq} item={item} onClose={close} />
}

function LightboxView({
  item,
  onClose
}: {
  item: LightboxItem
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  /** 图表「适应窗口」时的实际尺寸;null = 只能退回 transform 缩放(无 viewBox / 测不到) */
  const [svgFit, setSvgFit] = useState<{ w: number; h: number } | null>(null)
  /** 窗口尺寸变化后要重新量一次,因为适应尺寸依赖视口 */
  const [resizeTick, setResizeTick] = useState(0)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const svgHostRef = useRef<HTMLDivElement | null>(null)
  /** mermaid 写在 SVG 行内 style 上的 max-width;量适应尺寸时要还原它 */
  const fitMaxWidthRef = useRef('')
  const dragRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null)
  const draggedRef = useRef(false)

  const isSvg = item.kind === 'svg'

  // 事件回调要读到「最新的」缩放/位移,而 window/原生监听不随 render 重建;
  // 用 ref 镜像一份,比给每个监听都加依赖更不容易漏。
  const viewRef = useRef({ scale, tx, ty })
  viewRef.current = { scale, tx, ty }

  // SVG 注入(与 MermaidBlock.useSvg 同一策略:React 不参与这棵子树)。
  // 用 layout effect:紧接着要量尺寸,必须赶在绘制之前。
  useLayoutEffect(() => {
    const host = svgHostRef.current
    if (host === null) return
    host.innerHTML = item.kind === 'svg' ? item.svg : ''
    const svg = host.querySelector('svg')
    fitMaxWidthRef.current = svg?.style.maxWidth ?? ''
    return () => {
      host.innerHTML = ''
    }
  }, [item])

  // 量一次「适应窗口」尺寸(缩放不改变它,只在换内容 / 窗口变化时重量)。
  useLayoutEffect(() => {
    if (item.kind !== 'svg') {
      setSvgFit(null)
      return
    }
    const svg = svgHostRef.current?.querySelector('svg')
    const vb = svg === null || svg === undefined ? null : viewBoxSize(svg)
    if (svg === null || svg === undefined || vb === null) {
      setSvgFit(null)
      return
    }
    // 先还原适应窗口布局:放大状态下量到的不能当基准
    svg.style.width = ''
    svg.style.height = ''
    svg.style.maxWidth = fitMaxWidthRef.current
    svg.style.maxHeight = ''

    const rect = svg.getBoundingClientRect()
    // jsdom / 尚未布局时 rect 为 0:用 viewBox 兜底,行为仍然确定
    setSvgFit({
      w: rect.width > 0 ? rect.width : vb.w,
      h: rect.height > 0 ? rect.height : vb.h
    })
  }, [item, resizeTick])

  // 图表放大 = 放大 SVG 的布局尺寸。Chromium 会按新尺寸重绘矢量,
  // 而 transform: scale 只是把旧位图拉伸 —— 那正是放大后发糊的原因。
  useLayoutEffect(() => {
    if (item.kind !== 'svg' || svgFit === null) return
    const svg = svgHostRef.current?.querySelector('svg')
    if (svg === null || svg === undefined) return
    // 行内覆盖:压过 mermaid 自带的 max-width 与样式表里的 max-height
    svg.style.maxWidth = 'none'
    svg.style.maxHeight = 'none'
    svg.style.width = `${svgFit.w * scale}px`
    svg.style.height = `${svgFit.h * scale}px`
  }, [item, svgFit, scale])

  useEffect(() => {
    const onResize = (): void => setResizeTick((n) => n + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /** 放大后的平移边界:内容最多拖到「自己的边缘对齐视口边缘」 */
  const clampOffset = useCallback(
    (nextScale: number, x: number, y: number): { tx: number; ty: number } => {
      if (nextScale <= MIN_SCALE) return { tx: 0, ty: 0 }
      const stage = stageRef.current
      if (stage === null) return { tx: x, ty: y }
      const rect = stage.getBoundingClientRect()
      // jsdom / 尚未布局时为 0:不做夹紧,否则会把位移直接归零
      if (rect.width === 0 || rect.height === 0) return { tx: x, ty: y }
      // 图表按 SVG 的真实尺寸算;图片没有单独的 fit 尺寸,沿用舞台尺寸(与旧行为一致)
      const baseW = item.kind === 'svg' && svgFit !== null ? svgFit.w : rect.width
      const baseH = item.kind === 'svg' && svgFit !== null ? svgFit.h : rect.height
      const maxX = Math.max(0, (baseW * nextScale - rect.width) / 2)
      const maxY = Math.max(0, (baseH * nextScale - rect.height) / 2)
      return { tx: clamp(x, -maxX, maxX), ty: clamp(y, -maxY, maxY) }
    },
    [item.kind, svgFit]
  )

  /** 缩放到指定倍数;给了 clientX/Y 就以该点为锚点(滚轮 / 双击) */
  const applyScale = useCallback(
    (nextScale: number, clientX?: number, clientY?: number): void => {
      const cur = viewRef.current
      const s2 = clamp(nextScale, MIN_SCALE, MAX_SCALE)
      if (Math.abs(s2 - cur.scale) < 1e-6) return

      let px = 0
      let py = 0
      const stage = stageRef.current
      if (stage !== null && clientX !== undefined && clientY !== undefined) {
        const rect = stage.getBoundingClientRect()
        px = clientX - (rect.left + rect.width / 2)
        py = clientY - (rect.top + rect.height / 2)
      }
      const ratio = s2 / cur.scale
      // 保持光标下的内容点不动:新位移 = 锚点 - (锚点 - 旧位移) * 倍率
      const next = clampOffset(s2, px - (px - cur.tx) * ratio, py - (py - cur.ty) * ratio)
      setScale(s2)
      setTx(next.tx)
      setTy(next.ty)
    },
    [clampOffset]
  )

  const reset = useCallback((): void => {
    setScale(1)
    setTx(0)
    setTy(0)
  }, [])

  const panBy = useCallback(
    (dx: number, dy: number): void => {
      const cur = viewRef.current
      if (cur.scale <= MIN_SCALE) return
      const next = clampOffset(cur.scale, cur.tx + dx, cur.ty + dy)
      setTx(next.tx)
      setTy(next.ty)
    },
    [clampOffset]
  )

  // 滚轮缩放。必须原生 + { passive: false },React 的 onWheel 拦不住页面滚动。
  useEffect(() => {
    const el = rootRef.current
    if (el === null) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      // deltaMode=1(行)在部分鼠标/触控板上常见,换算成近似像素
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      applyScale(viewRef.current.scale * Math.exp(-delta * 0.0015), e.clientX, e.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyScale])

  // 键盘:Esc 关闭、+/- 缩放、0 复位、方向键平移
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true) return
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const cur = viewRef.current
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          onClose()
          break
        case '+':
        case '=':
          e.preventDefault()
          applyScale(cur.scale * ZOOM_STEP)
          break
        case '-':
        case '_':
          e.preventDefault()
          applyScale(cur.scale / ZOOM_STEP)
          break
        case '0':
          e.preventDefault()
          reset()
          break
        case 'ArrowLeft':
          e.preventDefault()
          panBy(KEY_PAN_STEP, 0)
          break
        case 'ArrowRight':
          e.preventDefault()
          panBy(-KEY_PAN_STEP, 0)
          break
        case 'ArrowUp':
          e.preventDefault()
          panBy(0, KEY_PAN_STEP)
          break
        case 'ArrowDown':
          e.preventDefault()
          panBy(0, -KEY_PAN_STEP)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [applyScale, onClose, panBy, reset])

  // 打开时接管焦点并锁滚动;关闭后把焦点还给原来的元素
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    rootRef.current?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      if (previous !== null && previous.isConnected && typeof previous.focus === 'function') {
        previous.focus()
      }
    }
  }, [])

  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    // 拖动结束的这一次 click 不算「点背景」
    if (draggedRef.current) {
      draggedRef.current = false
      return
    }
    if (e.target === e.currentTarget) onClose()
  }

  // Tab 在工具条内部循环,焦点不会跑到背后的页面上
  const onKeyDownRoot = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab') return
    const root = rootRef.current
    if (root === null) return
    const nodes = root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    if (nodes.length === 0) return
    const first = nodes[0]!
    const last = nodes[nodes.length - 1]!
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    // 新的一次按下永远作废上一次拖动的「抑制关闭」标记
    draggedRef.current = false
    if (e.button !== 0 || viewRef.current.scale <= MIN_SCALE) return
    dragRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
    const el = e.currentTarget
    if (typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* jsdom / 已释放的指针:忽略 */
      }
    }
    e.preventDefault()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== e.pointerId) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) drag.moved = true
    if (drag.moved) draggedRef.current = true
    drag.x = e.clientX
    drag.y = e.clientY
    if (!drag.moved) return
    const cur = viewRef.current
    const next = clampOffset(cur.scale, cur.tx + dx, cur.ty + dy)
    setTx(next.tx)
    setTy(next.ty)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    const el = e.currentTarget
    if (typeof el.releasePointerCapture === 'function') {
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* 指针已失效 */
      }
    }
  }

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const cur = viewRef.current.scale
    applyScale(cur > MIN_SCALE + 0.01 ? MIN_SCALE : DOUBLE_CLICK_SCALE, e.clientX, e.clientY)
  }

  const vector = isSvg && svgFit !== null
  const label = isSvg ? (item.label ?? t('lightbox.diagram')) : item.alt?.trim() || t('lightbox.image')
  const percent = Math.round(scale * 100)
  const atFit = scale <= MIN_SCALE + 1e-6 && tx === 0 && ty === 0

  return (
    <div
      ref={rootRef}
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      onClick={onClick}
      onKeyDown={onKeyDownRoot}
    >
      <div className="lightbox-bar">
        <span className="lightbox-title" title={label}>
          {label}
        </span>
        <div className="lightbox-actions">
          <button
            type="button"
            className="lightbox-btn"
            title={t('lightbox.zoomOut')}
            aria-label={t('lightbox.zoomOut')}
            disabled={scale <= MIN_SCALE + 1e-6}
            onClick={() => applyScale(viewRef.current.scale / ZOOM_STEP)}
          >
            <i className="fa-solid fa-minus" />
          </button>
          <span className="lightbox-scale">{percent}%</span>
          <button
            type="button"
            className="lightbox-btn"
            title={t('lightbox.zoomIn')}
            aria-label={t('lightbox.zoomIn')}
            disabled={scale >= MAX_SCALE - 1e-6}
            onClick={() => applyScale(viewRef.current.scale * ZOOM_STEP)}
          >
            <i className="fa-solid fa-plus" />
          </button>
          <button
            type="button"
            className="lightbox-btn"
            title={t('lightbox.reset')}
            aria-label={t('lightbox.reset')}
            disabled={atFit}
            onClick={reset}
          >
            <i className="fa-solid fa-expand" />
          </button>
          <span className="lightbox-divider" />
          <button
            type="button"
            className="lightbox-btn lightbox-close"
            title={t('lightbox.close')}
            aria-label={t('lightbox.close')}
            onClick={onClose}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className={'lightbox-stage' + (scale > MIN_SCALE + 1e-6 ? ' can-pan' : '')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
      >
        <div
          className={'lightbox-content' + (isSvg ? ' is-svg' : '') + (vector ? ' is-vector' : '')}
          style={{
            // 矢量图:尺寸已经写在 SVG 上,这里只平移(再叠加 scale 就会拉糊)
            transform: vector
              ? `translate(${tx}px, ${ty}px)`
              : `translate(${tx}px, ${ty}px) scale(${scale})`
          }}
        >
          {isSvg ? (
            <div className="lightbox-svg" ref={svgHostRef} />
          ) : (
            <img
              className="lightbox-img"
              src={item.src}
              alt={item.alt ?? ''}
              referrerPolicy="no-referrer"
              draggable={false}
            />
          )}
        </div>
      </div>

      <div className="lightbox-hint">{t('lightbox.hint')}</div>
    </div>
  )
}
