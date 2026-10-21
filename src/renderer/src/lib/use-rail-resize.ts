// 列表栏左右拖拽调宽(随心记 / AI 会话栏共用)。
//
// 两条特殊约定:
//  1. 拖到 **小于 50px** 时直接触发该栏的折叠,而不是留一条几乎没有内容的窄栏。
//     这个过窄的值**不写进 localStorage** —— 下次展开时回到上一次的有效宽度。
//  2. 宽度低于 160px 时列表内容只裁切、不换行(见 `narrow` 返回值与 .rail-narrow 样式):
//     拖拽过程中文字如果重新折行,行高会跟着跳,观感很晃。
//
// 为什么用 window 上的 pointermove 而不是 setPointerCapture:与项目里
// notes 分栏拖拽(NotesView 的 .notes-divider)保持同一种做法,指针移出元素后仍跟手。
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

/** 用户指定的折叠阈值 */
export const RAIL_COLLAPSE_AT = 50
/** 窄于此宽度时内容只隐藏、不换行 */
export const RAIL_NARROW_AT = 160

const MAX_WIDTH = 420
/** 正文区至少保留的宽度:窗口再小也不让列表把它挤没 */
const CONTENT_MIN = 360
const STEP = 16

function availableMax(): number {
  const win = typeof window === 'undefined' ? 1280 : window.innerWidth
  return Math.max(RAIL_COLLAPSE_AT, Math.min(MAX_WIDTH, win - CONTENT_MIN))
}

function clampWidth(w: number): number {
  return Math.min(Math.max(w, RAIL_COLLAPSE_AT), availableMax())
}

function readWidth(storageKey: string, fallback: number): number {
  try {
    const n = Number(localStorage.getItem(storageKey))
    return Number.isFinite(n) && n > 0 ? clampWidth(n) : fallback
  } catch {
    return fallback
  }
}

function writeWidth(storageKey: string, w: number): void {
  try {
    localStorage.setItem(storageKey, String(Math.round(w)))
  } catch {
    /* 记不住偏好不是错误 */
  }
}

export interface RailResize {
  width: number
  /** 宽度已窄到只该裁切内容、不该重新折行 */
  narrow: boolean
  startResize: (e: PointerEvent<HTMLElement>) => void
  resetWidth: () => void
  onResizeKeyDown: (e: KeyboardEvent<HTMLElement>) => void
}

export function useRailResize(opts: {
  storageKey: string
  defaultWidth: number
  /** 拖到折叠阈值以下时调用(由调用方做真正的折叠,复用现有折叠状态) */
  onCollapse: () => void
}): RailResize {
  const { storageKey, defaultWidth } = opts
  // 回调放 ref:拖拽过程中父组件重渲染不会把监听器拆掉重建
  const collapseRef = useRef(opts.onCollapse)
  collapseRef.current = opts.onCollapse

  const [width, setWidth] = useState(() => readWidth(storageKey, clampWidth(defaultWidth)))
  // 当前宽度的实时值:一次 pointermove 可能连续多次 setWidth,
  // 若等到 pointerup 时读渲染出来的 state,可能还是上一帧的值 → 会存错宽度
  const liveRef = useRef(width)
  // 上一次「有效」的宽度:拖到折叠阈值以下时用它还原内存里的宽度,
  // 于是本次会话里点展开立刻回到可用宽度(而不是停在刚拖出来的 60px)
  const goodRef = useRef(width)
  const [resizing, setResizing] = useState(false)
  const startRef = useRef({ x: 0, width: 0 })

  const startResize = useCallback((e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    startRef.current = { x: e.clientX, width: liveRef.current }
    setResizing(true)
  }, [])

  useEffect(() => {
    if (!resizing) return
    document.body.classList.add('rail-resizing')
    let collapsed = false
    const onMove = (e: globalThis.PointerEvent): void => {
      if (collapsed) return
      const next = startRef.current.width + (e.clientX - startRef.current.x)
      if (next < RAIL_COLLAPSE_AT) {
        // 过窄即折叠:本次拖拽到此为止,宽度回到上一次有效值(不进 localStorage)
        collapsed = true
        liveRef.current = goodRef.current
        setWidth(goodRef.current)
        setResizing(false)
        collapseRef.current()
        return
      }
      const w = clampWidth(next)
      liveRef.current = w
      setWidth(w)
    }
    const onUp = (): void => {
      if (!collapsed) {
        goodRef.current = liveRef.current
        writeWidth(storageKey, liveRef.current)
      }
      setResizing(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('rail-resizing')
    }
  }, [resizing, storageKey])

  const resetWidth = useCallback(() => {
    const w = clampWidth(defaultWidth)
    goodRef.current = w
    liveRef.current = w
    setWidth(w)
    writeWidth(storageKey, w)
  }, [storageKey, defaultWidth])

  const onResizeKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = liveRef.current + (e.key === 'ArrowRight' ? STEP : -STEP)
    if (next < RAIL_COLLAPSE_AT) {
      liveRef.current = goodRef.current
      setWidth(goodRef.current)
      collapseRef.current()
      return
    }
    const w = clampWidth(next)
    goodRef.current = w
    liveRef.current = w
    setWidth(w)
    writeWidth(storageKey, w)
  }, [storageKey])

  // 窗口变窄:把显示宽度压回可用上限(偏好值仍留在 localStorage,窗口变宽后重进页面恢复)
  useEffect(() => {
    const onWinResize = (): void => {
      setWidth((w) => {
        const next = clampWidth(w)
        liveRef.current = next
        return next
      })
    }
    window.addEventListener('resize', onWinResize)
    return () => window.removeEventListener('resize', onWinResize)
  }, [])

  return { width, narrow: width < RAIL_NARROW_AT, startResize, resetWidth, onResizeKeyDown }
}
