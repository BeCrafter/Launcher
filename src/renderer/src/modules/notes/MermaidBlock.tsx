// 预览里的 mermaid 代码块。
//
// 三件事在这里收口:
//   · **异步渲染 + 缓存** —— 预览每敲一个字就整篇重渲染,同一张图不能被反复重画;
//     缓存键带上主题,深浅色切换会自然失效重画。
//   · **注入** —— mermaid 只给 SVG 字符串,注入是躲不开的。这里用 ref + innerHTML,
//     而不是 React 的 dangerouslySetInnerHTML:React 全程不知道这棵子树存在,
//     也就没有任何人能把用户输入送进来。净化在 lib/mermaid-render.ts 里做(两道闸)。
//   · **失败要说人话** —— 语法错了就把 mermaid 的报错和源码一起摆出来,
//     而不是留一块空白让人以为图丢了。

import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../../hooks/useT'
import { useEffectiveTheme } from '../../hooks/useEffectiveTheme'
import { renderMermaid, type MermaidResult } from '../../lib/mermaid-render'
import { showToast } from '../../lib/utils'

/** 源码 + 主题 → 结果。跨组件实例共享,所以放在模块级而不是 useRef。 */
const CACHE_MAX = 32
const cache = new Map<string, MermaidResult>()

function cacheKey(code: string, theme: string): string {
  return `${theme}\u0000${code}`
}

function cacheGet(key: string): MermaidResult | undefined {
  const hit = cache.get(key)
  if (hit === undefined) return undefined
  cache.delete(key)
  cache.set(key, hit)
  return hit
}

function cacheSet(key: string, value: MermaidResult): void {
  cache.set(key, value)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
}

/** 把 SVG 灌进容器。容器由 React 渲染但内容不由 React 管 —— 见文件头注释。 */
function useSvg(hostRef: React.RefObject<HTMLDivElement | null>, svg: string | null): void {
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    host.innerHTML = svg ?? ''
    return () => {
      host.innerHTML = ''
    }
  }, [hostRef, svg])
}

export function MermaidBlock({
  code,
  onEdit
}: {
  code: string
  /** 不传 = 只读(帮助页/AI 消息之类的场合)。传了才出现「编辑」 */
  onEdit?: (code: string) => void
}): React.JSX.Element {
  const t = useT()
  const theme = useEffectiveTheme()
  const key = cacheKey(code, theme)

  // 命中缓存时同步拿到结果 —— 否则每敲一个字都会先闪一下「渲染中」
  const cached = useMemo(() => cacheGet(key), [key])
  const [async_, setAsync] = useState<{ key: string; result: MermaidResult } | null>(null)
  const result = cached ?? (async_?.key === key ? async_.result : null)

  const [zoomed, setZoomed] = useState(false)
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (cached !== undefined) return
    let alive = true
    void renderMermaid(code, theme).then((r) => {
      cacheSet(key, r)
      if (alive) setAsync({ key, result: r })
    })
    return () => {
      alive = false
    }
  }, [key, code, theme, cached])

  useSvg(hostRef, result?.svg ?? null)

  const copy = (): void => {
    void navigator.clipboard
      .writeText(code)
      .then(() => showToast(t('notes.diagram.copied'), '#60a5fa', 'fa-clipboard-check'))
      .catch(() => showToast(t('notes.diagram.copyFailed'), '#f87171', 'fa-circle-exclamation'))
  }

  return (
    <div className="md-mermaid">
      <div className="md-mermaid-tools">
        <button type="button" title={t('notes.diagram.copy')} onClick={copy}>
          <i className="fa-regular fa-copy" />
        </button>
        {result?.svg != null && (
          <button type="button" title={t('notes.diagram.zoom')} onClick={() => setZoomed(true)}>
            <i className="fa-solid fa-up-right-and-down-left-from-center" />
          </button>
        )}
        {onEdit && (
          <button type="button" title={t('notes.diagram.edit')} onClick={() => onEdit(code)}>
            <i className="fa-solid fa-pen" />
          </button>
        )}
      </div>

      {result === null && (
        <div className="md-mermaid-state">
          <i className="fa-solid fa-spinner fa-spin" />
          <span>{t('notes.diagram.rendering')}</span>
        </div>
      )}

      {result !== null && result.error !== null && (
        <div className="md-mermaid-error">
          <div className="md-mermaid-error-hd">
            <i className="fa-solid fa-triangle-exclamation" />
            <span>{t('notes.diagram.error')}</span>
          </div>
          <div className="md-mermaid-error-msg">{result.error}</div>
          <pre className="md-code md-mermaid-error-src">
            <code>{code}</code>
          </pre>
        </div>
      )}

      {/* 有图才挂这个容器:空容器会把 SVG 的宽度撑成 0,后续布局会跳 */}
      {result?.svg != null && (
        <div className="md-mermaid-canvas">
          <div className="md-mermaid-svg" ref={hostRef} />
        </div>
      )}

      {zoomed && result?.svg != null && (
        <ZoomOverlay svg={result.svg} onClose={() => setZoomed(false)} />
      )}
    </div>
  )
}

/** 放大查看:大图在预览的窄栏里挤成一团,需要一个能看全的地方 */
function ZoomOverlay({ svg, onClose }: { svg: string; onClose: () => void }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  useSvg(hostRef, svg)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="md-mermaid-zoom" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="md-mermaid-zoom-inner" onClick={(e) => e.stopPropagation()}>
        <div className="md-mermaid-zoom-svg" ref={hostRef} />
      </div>
    </div>
  )
}
