// 图片查看器:滚轮缩放、拖拽平移、双击 1× ↔ 2.5×,缩放夹在 0.2–8×。
// 磁盘图片与解码后的 PSD/TIFF/HEIC 共用这一个组件(后者传 blob URL)。

import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../hooks/useT'

const MIN_SCALE = 0.2
const MAX_SCALE = 8

const clampScale = (v: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v))

export function ImageViewer({ src, alt }: { src: string; alt: string }): React.JSX.Element {
  const t = useT()
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [failed, setFailed] = useState(false)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  // React 的 onWheel 走 passive 监听,拦不住页面滚动 —— 用原生监听
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      setScale((s) => clampScale(s * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const reset = (): void => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }

  return (
    <div className="file-image-stage" ref={stageRef} data-scale={scale.toFixed(3)}>
      <div className="file-image-tools">
        <button
          type="button"
          title={t('notes.file.zoomOut')}
          onClick={() => setScale((s) => clampScale(s / 1.25))}
        >
          <i className="fa-solid fa-magnifying-glass-minus" />
        </button>
        <button
          type="button"
          title={t('notes.file.zoomReset')}
          onClick={reset}
          className="file-image-scale"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          title={t('notes.file.zoomIn')}
          onClick={() => setScale((s) => clampScale(s * 1.25))}
        >
          <i className="fa-solid fa-magnifying-glass-plus" />
        </button>
      </div>
      {failed ? (
        <div className="file-placeholder">
          <i className="fa-solid fa-file-circle-xmark" />
          <div>{t('notes.file.imageFailed')}</div>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="file-image"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          onError={() => setFailed(true)}
          onDoubleClick={() => setScale((s) => (s > 1.5 ? 1 : 2.5))}
          onPointerDown={(e) => {
            if (scale <= 1) return
            e.currentTarget.setPointerCapture(e.pointerId)
            dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
          }}
          onPointerMove={(e) => {
            const d = dragRef.current
            if (!d) return
            setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) })
          }}
          onPointerUp={(e) => {
            dragRef.current = null
            e.currentTarget.releasePointerCapture(e.pointerId)
          }}
        />
      )}
    </div>
  )
}
