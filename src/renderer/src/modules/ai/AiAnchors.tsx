// 对话右侧的会话锚点(快速定位到某条用户消息)
//
// 设计取舍:
//  · **锚点 = 用户消息**(每轮对话的起点)—— 语义上就是"会话位置",数量也天然受控;
//    按助手消息切会碎得多(一条 run 里有多条 assistant 消息)。
//  · **一次最多显示 MAX_VISIBLE 个**(用户要求:不展示全部,要美观)。超出时锚点条自身成窗口,
//    指针移到条的上/下缘即开始滚动窗口 —— 这就是"移动到区域顶部或尾部时实现该区域滚动"。
//  · 悬浮高亮目标消息**用命令式加类**,不走 React state:否则每次划过都要重渲整条消息流,
//    流式输出时尤其亏(消息多、帧率高)。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAiStore } from '../../state/ai-store'
import { buildItems } from './AiMessages'
import type { AiMessage } from '@shared/ai'

/** 一次最多显示几个锚点。10 个 × 16px 间距 ≈ 150px,在画布右侧是一小段,不喧宾夺主 */
const MAX_VISIBLE = 10
/** 相邻锚点的垂直间距(px) */
const PITCH = 16
/** 指针进入条的上/下这么多像素内就开始滚动窗口 */
const EDGE_ZONE = 26
/** 判定"当前锚点"的容差:消息顶部进入视口上方这么多以内就算到了 */
const ACTIVE_SLACK = 90

interface Anchor {
  /** 渲染项下标(用于在 DOM 里找回那条消息) */
  mi: number
  label: string
}

/** 锚点标签:用户消息的首行,截断到可辨识长度 */
function anchorLabel(msg: AiMessage): string {
  const text = msg.blocks
    .filter((b): b is Extract<AiMessage['blocks'][number], { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
  const first = text.split('\n')[0]?.trim() ?? ''
  if (first === '') return '…'
  return first.length > 26 ? `${first.slice(0, 26)}…` : first
}

export function AiAnchors({
  scrollRef
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element | null {
  const messages = useAiStore((s) => s.messages)
  const [winStart, setWinStart] = useState(0)
  const [active, setActive] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)
  const hoverRef = useRef<number | null>(null)
  /** 指针在条内的 y(相对条顶);离开时为 null。用于边缘滚动 */
  const pointerYRef = useRef<number | null>(null)
  /** 边缘滚动循环是否在跑(避免重复起 rAF) */
  const edgeRafRef = useRef<number | null>(null)
  /** 手动/自动滚动窗口时,暂时不要用"当前锚点"把窗口拉回去 */
  const windowLockRef = useRef(0)

  const anchors = useMemo<Anchor[]>(() => {
    const items = buildItems(messages)
    const out: Anchor[] = []
    items.forEach((it, i) => {
      if (it.kind === 'user') out.push({ mi: i, label: anchorLabel(it.msg) })
    })
    return out
  }, [messages])

  const total = anchors.length

  // ── 当前锚点:视口上方最近的那一个 ──
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc || total === 0) return
    const sync = (): void => {
      const top = sc.scrollTop + ACTIVE_SLACK
      let idx = 0
      for (let i = 0; i < anchors.length; i++) {
        const el = sc.querySelector<HTMLElement>(`[data-mi="${anchors[i].mi}"]`)
        if (!el) continue
        if (offsetIn(sc, el) <= top) idx = i
        else break
      }
      setActive(idx)
      // 当前锚点跑到窗口外时把窗口挪过去(手动滚窗口后的短时间内不抢)
      if (Date.now() < windowLockRef.current) return
      setWinStart((w) => clampWindow(w, idx, total))
    }
    sync()
    sc.addEventListener('scroll', sync, { passive: true })
    return () => sc.removeEventListener('scroll', sync)
  }, [scrollRef, anchors, total])

  // ── 边缘滚动:指针停在条的上/下缘 → 窗口持续滚动 ──
  const runEdge = useCallback(() => {
    const step = (): void => {
      const y = pointerYRef.current
      const strip = stripRef.current
      if (y === null || !strip) {
        edgeRafRef.current = null
        return
      }
      const dir = y < EDGE_ZONE ? -1 : y > strip.clientHeight - EDGE_ZONE ? 1 : 0
      if (dir !== 0) {
        // 手动滚窗口期间锁一下自动跟随,否则"当前锚点必须在窗口内"会立刻把它拉回来
        windowLockRef.current = Date.now() + 600
        setWinStart((w) => Math.max(0, Math.min(w + dir, Math.max(0, total - visibleCount(total)))))
      }
      edgeRafRef.current = dir === 0 ? null : requestAnimationFrame(step)
    }
    if (edgeRafRef.current === null) edgeRafRef.current = requestAnimationFrame(step)
  }, [total])

  useEffect(() => {
    return () => {
      if (edgeRafRef.current !== null) cancelAnimationFrame(edgeRafRef.current)
    }
  }, [])

  // ── 悬浮高亮(命令式:见文件头说明)──
  const setHighlight = useCallback(
    (mi: number | null) => {
      const sc = scrollRef.current
      if (!sc) return
      sc.querySelectorAll('.ai-msg.is-anchor-hl').forEach((el) => el.classList.remove('is-anchor-hl'))
      if (mi === null) return
      sc.querySelector<HTMLElement>(`[data-mi="${mi}"]`)?.classList.add('is-anchor-hl')
    },
    [scrollRef]
  )

  useEffect(() => () => setHighlight(null), [setHighlight])

  const jumpTo = useCallback(
    (mi: number) => {
      const sc = scrollRef.current
      if (!sc) return
      const el = sc.querySelector<HTMLElement>(`[data-mi="${mi}"]`)
      if (!el) return
      // 用 rect 差值算目标位置:offsetTop 依赖 offsetParent,而消息链路上没有定位祖先。
      // ⚠ 直接赋 scrollTop 而不是 scrollTo({behavior:'smooth'}) —— 后者在这个容器上实测不生效
      //   (调用后 scrollTop 纹丝不动),而 .ai-scroll 本来就带 CSS scroll-behavior: smooth,
      //   赋值同样会平滑滚动。本视图的 scrollBottom 也是这么写的,保持一致。
      sc.scrollTop = Math.max(0, offsetIn(sc, el) - 12)
    },
    [scrollRef]
  )

  // 只有 1 个锚点时没有定位意义,不占画面
  if (total < 2) return null

  const visible = Math.min(MAX_VISIBLE, total)
  const windowed = total > MAX_VISIBLE
  const win = clampedWin(winStart, total, visible)

  return (
    <div
      className={`ai-anchors${windowed ? ' is-windowed' : ''}`}
      ref={stripRef}
      onPointerMove={(e) => {
        const strip = stripRef.current
        if (!strip) return
        pointerYRef.current = e.clientY - strip.getBoundingClientRect().top
        if (windowed) runEdge()
      }}
      onPointerLeave={() => {
        pointerYRef.current = null
        hoverRef.current = null
        setHover(null)
        setHighlight(null)
      }}
    >
      {anchors.slice(win, win + visible).map((a, k) => {
        const i = win + k
        const cls =
          'ai-anchor' +
          (i === active ? ' is-active' : '') +
          (hover === i ? ' is-hover' : '')
        return (
          <button
            key={a.mi}
            className={cls}
            type="button"
            style={{ height: PITCH }}
            /* data-anchor-mi:锚点指向的渲染项下标(便于定位/自动化断言) */
            data-anchor-mi={a.mi}
            aria-label={a.label}
            onPointerEnter={() => {
              hoverRef.current = i
              setHover(i)
              setHighlight(a.mi)
            }}
            onClick={() => jumpTo(a.mi)}
          >
            <span className="ai-anchor-bar" />
            {hover === i && <span className="ai-anchor-tip">{a.label}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** 元素在滚动容器内容坐标里的顶部位置 */
function offsetIn(container: HTMLElement, el: HTMLElement): number {
  return el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
}

/** 让 idx 落在 [start, start+visible) 内 */
function clampWindow(start: number, idx: number, total: number): number {
  const visible = Math.min(MAX_VISIBLE, total)
  let s = start
  if (idx < s) s = idx
  if (idx >= s + visible) s = idx - visible + 1
  return clampedWin(s, total, visible)
}

const visibleCount = (total: number): number => Math.min(MAX_VISIBLE, total)

function clampedWin(start: number, total: number, visible: number): number {
  return Math.max(0, Math.min(start, Math.max(0, total - visible)))
}
