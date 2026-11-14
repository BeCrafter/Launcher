// 预览右上角的标题刻度 + 悬停浮层目录。
//
// 常驻时不铺开:右上角只留一排短刻度(当前节高亮),悬停或键盘聚焦才展开卡片。
// 浮层只负责展示层级与定位跳转 —— 折叠不在这里做,只保留预览标题旁的折叠箭头。
//
// 位置只由 CSS 按刻度条的 right 锚定,不再测量:
// 刻度条和浮层共用同一套 right,可见面板出现在刻度条左缘左侧 1px。

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from 'react'
import { useT } from '../../hooks/useT'
import { findDirectHeading } from '../../lib/preview-fold'
import {
  OUTLINE_EDGE,
  OUTLINE_EDGE_SPEED,
  OUTLINE_FOLLOW_MS,
  outlineEdgeEnds,
  outlineTickScrollTarget,
  pickActiveHeadingKey,
  pinnedActiveKey,
  stepOutlineEdgeScroll,
  stepOutlineFollow,
  visibleHeadingKeys,
  type HeadingPosition,
  type OutlinePin,
  type PreviewHeading
} from '../../lib/preview-outline'

/** 预览顶部内边距 20px + 一点余量:标题顶边越过这里就算「当前节」 */
const ACTIVE_OFFSET = 28
/** 跳转后正文标题的定位底色,和 CSS 动画同长;动画没播完也要拆掉 */
const LOCATE_MS = 1080

const locateCleanup = new WeakMap<HTMLElement, () => void>()

/** 高亮对准这根刻度时,槽应该停在哪。用内容位置,不用正在滑的拇指。 */
function tickScrollTarget(strip: HTMLElement): number | null {
  const tick = strip.querySelector<HTMLElement>('.preview-outline-tick.is-active')
  if (tick === null) return null
  const max = Math.max(0, strip.scrollHeight - strip.clientHeight)
  return outlineTickScrollTarget({
    scrollTop: strip.scrollTop,
    maxScroll: max,
    tickTop: tick.offsetTop,
    tickHeight: tick.offsetHeight,
    viewHeight: strip.clientHeight,
    padding: OUTLINE_EDGE
  })
}

function clearLocated(el: HTMLElement): void {
  const finish = locateCleanup.get(el)
  if (finish !== undefined) {
    locateCleanup.delete(el)
    finish()
  }
  el.classList.remove('is-located')
}

/** 给刚跳到的标题铺一层淡出的底。连点同一行要重播,所以先拆掉再强制重排。 */
function flashLocated(el: HTMLElement): void {
  const root = el.parentElement
  if (root !== null) {
    for (const other of root.querySelectorAll<HTMLElement>(':scope > .md-h.is-located')) {
      if (other !== el) clearLocated(other)
    }
  }
  clearLocated(el)
  // 读一次布局,浏览器才会把「去掉类」和「加上类」看成两次,动画才能重播。
  void el.offsetWidth
  el.classList.add('is-located')
  const finish = (): void => {
    window.clearTimeout(timer)
    el.removeEventListener('animationend', onEnd)
    el.classList.remove('is-located')
    if (locateCleanup.get(el) === finish) locateCleanup.delete(el)
  }
  const onEnd = (event: AnimationEvent): void => {
    if (event.target !== el || event.animationName !== 'md-h-located') return
    finish()
  }
  const timer = window.setTimeout(finish, LOCATE_MS)
  el.addEventListener('animationend', onEnd)
  locateCleanup.set(el, finish)
}

export interface PreviewOutlineRailProps {
  previewRef: RefObject<HTMLDivElement | null>
  headings: readonly PreviewHeading[]
  /** 仅用于把被折起标题的子级从目录里滤掉;浮层本身不触发折叠 */
  foldedKeys: ReadonlySet<string>
}

export function PreviewOutlineRail({
  previewRef,
  headings,
  foldedKeys
}: PreviewOutlineRailProps): React.JSX.Element | null {
  const t = useT()
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<HTMLDivElement | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLSpanElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  /** 指针在刻度条上的 y(相对条顶);离开条时为 null,贴边滚动才停 */
  const pointerYRef = useRef<number | null>(null)
  const edgeRafRef = useRef<number | null>(null)
  const followRafRef = useRef<number | null>(null)
  /** 这一段跟随从哪、朝哪走。目标变了就从当前位置改跟,不重播上一段。 */
  const followRef = useRef<{ from: number; to: number; started: number } | null>(null)
  /** 上一帧拇指对准的刻度。换了一篇笔记(旧键不在)时直接落上,不从旧位置滑过来。 */
  const thumbKeyRef = useRef<string | null>(null)
  const [edge, setEdge] = useState({ above: false, below: false })
  const positions = useRef<{ sig: string; list: HeadingPosition[] }>({ sig: '', list: [] })
  // 点了滚不到顶的标题时,当前项停在它上面,直到用户自己滚动。
  const pinRef = useRef<OutlinePin | null>(null)

  const visible = useMemo(() => visibleHeadingKeys(headings, foldedKeys), [headings, foldedKeys])
  const rows = useMemo(() => headings.filter((heading) => visible.has(heading.key)), [headings, visible])

  // 当前节被祖先折起来时,目录里显示最近一个仍然可见的祖先。
  const activeVisibleKey = useMemo(() => {
    if (activeKey === null) return rows[0]?.key ?? null
    const byKey = new Map(headings.map((heading) => [heading.key, heading]))
    let key: string | null = activeKey
    while (key !== null && !visible.has(key)) key = byKey.get(key)?.parentKey ?? null
    return key ?? rows[0]?.key ?? null
  }, [activeKey, headings, rows, visible])

  // ── 滚动跟随 ──
  // 布局没变时复用上次量到的位置;滚动事件只做一次区间比较,不反复读 rect。
  useEffect(() => {
    const pv = previewRef.current
    if (pv === null) return
    let raf = 0
    // 正文或折叠变了,上一次点击的落点不再对应这些标题。
    pinRef.current = null

    const measure = (): HeadingPosition[] => {
      const sig = `${pv.clientWidth}:${pv.scrollHeight}:${headings.map((h) => h.line).join(',')}:${[
        ...foldedKeys
      ].join(',')}`
      if (positions.current.sig === sig) return positions.current.list
      const body = pv.querySelector<HTMLElement>('.notes-preview-body')
      const base = pv.getBoundingClientRect().top - pv.scrollTop
      const list: HeadingPosition[] = []
      for (const heading of headings) {
        const el = body === null ? null : findDirectHeading(body, heading.line)
        // display:none(被折叠/祖先被折叠)不参与当前节
        if (el === null || el.getClientRects().length === 0) continue
        const top = el.getBoundingClientRect().top - base
        if (Number.isFinite(top)) list.push({ key: heading.key, top })
      }
      positions.current = { sig, list }
      return list
    }

    const update = (): void => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const pin = pinRef.current
        // 滚动离开落点就拆钉,免得用户滚回去时又被钉上。
        if (pin !== null && Math.abs(pv.scrollTop - pin.scrollTop) > 1) pinRef.current = null
        const next = pinnedActiveKey(
          pickActiveHeadingKey(measure(), pv.scrollTop, ACTIVE_OFFSET),
          pinRef.current,
          pv.scrollTop
        )
        setActiveKey((current) => (current === next ? current : next))
      })
    }

    pv.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(() => {
      positions.current.sig = ''
      update()
    })
    observer.observe(pv)
    const body = pv.querySelector<HTMLElement>('.notes-preview-body')
    if (body !== null) observer.observe(body)
    update()

    return () => {
      pv.removeEventListener('scroll', update)
      observer.disconnect()
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [previewRef, headings, foldedKeys])

  // 展开时(以及展开期间当前节变化时)把当前项滚到列表中间,
  // 目录很长、当前节很靠下时也能一眼看到。
  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => {
      const list = listRef.current
      if (list === null) return
      const row = list.querySelector<HTMLElement>('.preview-outline-row.is-active')
      if (row === null) return
      const listRect = list.getBoundingClientRect()
      const rowRect = row.getBoundingClientRect()
      const target =
        list.scrollTop + (rowRect.top - listRect.top) - (listRect.height - rowRect.height) / 2
      const max = Math.max(0, list.scrollHeight - list.clientHeight)
      list.scrollTop = Math.max(0, Math.min(max, target))
    })
    return () => cancelAnimationFrame(raf)
  }, [open, activeVisibleKey, rows.length])

  const syncEdge = useCallback((): void => {
    const strip = stripRef.current
    if (strip === null) return
    const max = Math.max(0, strip.scrollHeight - strip.clientHeight)
    const next = outlineEdgeEnds(strip.scrollTop, max)
    setEdge((current) =>
      current.above === next.above && current.below === next.below ? current : next
    )
  }, [])

  const stopFollow = useCallback((): void => {
    if (followRafRef.current !== null) cancelAnimationFrame(followRafRef.current)
    followRafRef.current = null
    followRef.current = null
  }, [])

  const reducedMotion = useCallback(
    (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  )

  /**
   * 高亮从上一根滑到这一根。第一次出现、或旧键已经不在这些刻度里,直接落上。
   * 滑动只加在 transform 上;目标一变,浏览器从当前插值改跟,不排队。
   */
  const placeThumb = useCallback((): void => {
    const strip = stripRef.current
    const thumb = thumbRef.current
    if (strip === null || thumb === null) return
    const tick = strip.querySelector<HTMLElement>('.preview-outline-tick.is-active')
    if (tick === null) return
    const previous = thumbKeyRef.current
    const known = previous !== null && strip.querySelector(`[data-key="${CSS.escape(previous)}"]`) !== null
    if (!known || reducedMotion()) thumb.style.transition = 'none'
    const y = tick.offsetTop + (tick.offsetHeight - thumb.offsetHeight) / 2
    thumb.style.transform = `translateY(${y}px)`
    if (!known || reducedMotion()) {
      void thumb.offsetWidth
      thumb.style.transition = ''
    }
    thumbKeyRef.current = activeVisibleKey
  }, [activeVisibleKey, reducedMotion])

  /**
   * 栏只在目标不是当前值时才动,和拇指同一帧起步、同一段走完。
   * 指针还在条上时不调用:贴边翻看不能被拉回去。
   * 必须写在 syncEdge 之后:依赖数组在渲染时就读它。
   */
  const followTick = useCallback((): void => {
    if (pointerYRef.current !== null) return
    const strip = stripRef.current
    if (strip === null) return
    const target = tickScrollTarget(strip)
    if (target === null) return
    const current = strip.scrollTop
    if (Math.abs(target - current) <= 0.5 || reducedMotion()) {
      stopFollow()
      if (strip.scrollTop !== target) strip.scrollTop = target
      syncEdge()
      return
    }
    followRef.current = { from: current, to: target, started: performance.now() }
    if (followRafRef.current !== null) return
    const step = (now: number): void => {
      const motion = followRef.current
      const node = stripRef.current
      if (motion === null || node === null || pointerYRef.current !== null) {
        followRafRef.current = null
        return
      }
      const next = stepOutlineFollow(motion.from, motion.to, now - motion.started)
      const whole = Math.round(next)
      if (whole !== node.scrollTop) node.scrollTop = whole
      syncEdge()
      if (next === motion.to) {
        followRafRef.current = null
        followRef.current = null
        return
      }
      followRafRef.current = requestAnimationFrame(step)
    }
    followRafRef.current = requestAnimationFrame(step)
  }, [reducedMotion, stopFollow, syncEdge])

  useLayoutEffect(() => {
    placeThumb()
    followTick()
  }, [activeVisibleKey, rows.length, placeThumb, followTick])

  const runEdge = useCallback(() => {
    let last = performance.now()
    // scrollTop 只认整数。一帧的位移不到 1px,直接赋值会被取整成 0,下一帧又从 0 算,永远滚不动。
    let carried = 0
    const step = (now: number): void => {
      const y = pointerYRef.current
      const strip = stripRef.current
      if (y === null || strip === null) {
        edgeRafRef.current = null
        return
      }
      const max = Math.max(0, strip.scrollHeight - strip.clientHeight)
      const dt = (now - last) / 1000
      last = now
      const next = stepOutlineEdgeScroll({
        scrollTop: strip.scrollTop + carried,
        maxScroll: max,
        pointerY: y,
        height: strip.clientHeight,
        edge: OUTLINE_EDGE,
        dt,
        speed: OUTLINE_EDGE_SPEED
      })
      const whole = Math.trunc(next)
      carried = next - whole
      if (whole !== strip.scrollTop) strip.scrollTop = whole
      syncEdge()
      const towardTop = y < OUTLINE_EDGE
      const towardBottom = y > strip.clientHeight - OUTLINE_EDGE
      // 第一帧的 rAF 时间戳可能比指针事件里的 performance.now() 还早,dt 是负的,这一帧不动。
      // 停在 0 只说明还没往下走,不是到顶;只有正朝那一头、并且已经到了,才停。
      const atEnd = (towardTop && strip.scrollTop <= 0) || (towardBottom && strip.scrollTop >= max)
      if ((!towardTop && !towardBottom) || atEnd) {
        edgeRafRef.current = null
        return
      }
      edgeRafRef.current = requestAnimationFrame(step)
    }
    if (edgeRafRef.current === null) edgeRafRef.current = requestAnimationFrame(step)
  }, [syncEdge])

  useEffect(() => {
    const strip = stripRef.current
    if (strip === null) return
    syncEdge()
    const observer = new ResizeObserver(() => syncEdge())
    observer.observe(strip)
    return () => observer.disconnect()
  }, [rows.length, syncEdge, followTick])

  useEffect(() => {
    return () => {
      if (edgeRafRef.current !== null) cancelAnimationFrame(edgeRafRef.current)
      stopFollow()
    }
  }, [stopFollow])

  const onStripPointer = (event: React.PointerEvent<HTMLDivElement>): void => {
    const strip = stripRef.current
    if (strip === null) return
    stopFollow()
    pointerYRef.current = event.clientY - strip.getBoundingClientRect().top
    runEdge()
  }

  const onStripLeave = (): void => {
    pointerYRef.current = null
    if (edgeRafRef.current !== null) cancelAnimationFrame(edgeRafRef.current)
    edgeRafRef.current = null
    followTick()
  }

  const jumpTo = useCallback(
    (heading: PreviewHeading): void => {
      const pv = previewRef.current
      if (pv === null) return
      const body = pv.querySelector<HTMLElement>('.notes-preview-body')
      const el = body === null ? null : findDirectHeading(body, heading.line)
      if (el === null) return
      const desired = el.getBoundingClientRect().top - pv.getBoundingClientRect().top + pv.scrollTop - 12
      const max = Math.max(0, pv.scrollHeight - pv.clientHeight)
      // Electron 里程序化平滑滚动不可靠;目录导航要的是准,不是动画。
      pv.scrollTo({ top: Math.min(max, Math.max(0, desired)), behavior: 'instant' as ScrollBehavior })
      const landed = pv.scrollTop
      // 夹住了:标题到不了视口顶部。先钉住,再派发 scroll,下一帧才不会被侦察盖掉。
      pinRef.current = desired - landed > 1 ? { key: heading.key, scrollTop: landed } : null
      // 本环境的程序化滚动不一定派发 scroll(分栏联动与滚动跟随都靠它),手动补一次。
      pv.dispatchEvent(new Event('scroll'))
      // 高亮直接落位,不等下一帧测量。
      setActiveKey(heading.key)
      flashLocated(el)
    },
    [previewRef]
  )

  const onBlur = (event: React.FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget
    if (next === null || rootRef.current === null || !rootRef.current.contains(next)) setOpen(false)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      setOpen(false)
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      return
    }
    if (event.key === 'ArrowDown' && document.activeElement === handleRef.current) {
      event.preventDefault()
      setOpen(true)
      requestAnimationFrame(() => {
        listRef.current?.querySelector<HTMLButtonElement>('.preview-outline-jump')?.focus()
      })
    }
  }

  if (headings.length === 0) return null

  return (
    <div
      ref={rootRef}
      className={`preview-outline${open ? ' is-open' : ''}`}
      role="navigation"
      aria-label={t('notes.outline.label')}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      {/* 原生 button 的 overflow 不可靠,滚动槽放在可聚焦的 div 里。 */}
      <div
        ref={handleRef}
        className="preview-outline-handle"
        role="button"
        tabIndex={0}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="preview-outline-card"
        aria-label={t('notes.outline.handle')}
        title={t('notes.outline.handle')}
        onFocus={() => setOpen(true)}
        // 悬停已经把卡片打开了;点击不再反向切换(否则点一下就关,像误触)。
        onClick={() => setOpen(true)}
      >
        <div
          ref={stripRef}
          className={
            'preview-outline-strip' +
            (edge.above ? ' fade-top' : '') +
            (edge.below ? ' fade-bottom' : '')
          }
          onScroll={syncEdge}
          onPointerMove={onStripPointer}
          onPointerLeave={onStripLeave}
        >
          {activeVisibleKey !== null ? (
            <span ref={thumbRef} className="preview-outline-thumb" aria-hidden="true" />
          ) : null}
          {rows.map((row) => (
            <span
              key={row.key}
              className={'preview-outline-tick' + (row.key === activeVisibleKey ? ' is-active' : '')}
              data-key={row.key}
              data-level={row.level}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>

      <div className="preview-outline-card" id="preview-outline-card">
        <div className="preview-outline-card-inner">
          <div className="preview-outline-hd">{t('notes.outline.title')}</div>
          <div className="preview-outline-list" ref={listRef}>
            {rows.map((row) => {
              const isActive = row.key === activeVisibleKey
              return (
                <div
                  key={row.key}
                  className={'preview-outline-row' + (isActive ? ' is-active' : '')}
                  data-level={row.level}
                  data-depth={row.depth}
                  data-line={row.line}
                  style={{ paddingLeft: row.depth * 12 }}
                >
                  <button
                    type="button"
                    className="preview-outline-jump"
                    aria-current={isActive ? 'location' : undefined}
                    title={t('notes.outline.jump').replace('{TITLE}', row.title)}
                    onClick={() => jumpTo(row)}
                  >
                    {row.title}
                  </button>
                  <span className="preview-outline-mark-slot" aria-hidden="true">
                    {isActive ? <span className="preview-outline-mark" /> : null}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
