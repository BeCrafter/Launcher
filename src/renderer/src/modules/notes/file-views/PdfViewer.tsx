// PDF 画在当前页面里,不走 Chromium 自带阅读器。
// 那一页是跨源 iframe,父页面的主题色进不去,工具栏也去不掉。
// 页宽跟容器走,画布绝对定位,不让位图自己的像素尺寸把页撑开。
// 滚轮翻页,按住 Ctrl / 摸控板双指才缩放;文字层可以选中复制。
// 滚动时页码按已量好的页框算,远处的页不留画布,文字层等停下来再铺。
// 页面在单独的渲染线程里画。滚动过程中不新开绘制,避免和滚动条抢主线程。

import { memo, useEffect, useRef, useState, type RefObject } from 'react'
import {
  getDocument,
  GlobalWorkerOptions,
  RenderingCancelledException,
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import rendererUrl from 'pdfjs-dist/build/pdf.renderer.min.mjs?url'
import { useFmt, useT } from '../../../hooks/useT'
import {
  createPageRenderQueue,
  pageAtScroll,
  wantsWheelDefaultPrevented,
  type PdfFrame
} from './pdf-scroll'

/** 当前页前后各留这么多页的画布,再远的只留占位。 */
const PAGE_KEEP = 2
/** 滚动停下这么久再铺文字层。 */
const TEXT_IDLE_MS = 150
const pageRenders = createPageRenderQueue()

if (typeof window !== 'undefined') {
  // 生产环境是 file://,相对地址要先算成绝对的,否则退回主线程时会按模块位置找错 worker。
  const base = window.location.href
  GlobalWorkerOptions.workerSrc = new URL(workerUrl, base).href
  // 没设这个地址时,pdf.js 把整页画在主线程上,滚动条就会一顿一顿的。
  GlobalWorkerOptions.rendererSrc = new URL(rendererUrl, base).href
}

function pdfjsAsset(dir: string): string {
  return new URL(`pdfjs/${dir}/`, window.location.href).href
}

interface PageSize {
  number: number
  width: number
  height: number
  userUnit: number
}

interface OutlineEntry {
  title: string
  page: number | null
  depth: number
}

interface LoadedPdf {
  src: string
  pdf: PDFDocumentProxy
  pages: PageSize[]
  outline: OutlineEntry[]
}

interface OutlineNode {
  title: string
  dest: string | unknown[] | null
  items?: OutlineNode[]
}

const PIXEL_RATIO_CAP = 2
const MIN_SCALE = 0.2
const MAX_SCALE = 8

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/** 目录项指向的页。命名目标先换成显式目标,第一项是页引用。解不开就没有页。 */
async function outlinePage(pdf: PDFDocumentProxy, dest: OutlineNode['dest']): Promise<number | null> {
  let explicit = dest
  if (typeof explicit === 'string') explicit = await pdf.getDestination(explicit)
  const ref = Array.isArray(explicit) ? explicit[0] : null
  if (ref === null || typeof ref !== 'object') return null
  const index = await pdf.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0])
  return Number.isInteger(index) ? index + 1 : null
}

async function flattenOutline(pdf: PDFDocumentProxy, nodes: OutlineNode[], depth: number): Promise<OutlineEntry[]> {
  const entries: OutlineEntry[] = []
  for (const node of nodes) {
    let page: number | null = null
    try {
      page = await outlinePage(pdf, node.dest)
    } catch {
      page = null
    }
    entries.push({ title: node.title, page, depth })
    if (node.items !== undefined && node.items.length > 0) {
      entries.push(...(await flattenOutline(pdf, node.items, depth + 1)))
    }
  }
  return entries
}

export function PdfViewer({ src }: { src: string }): React.JSX.Element {
  const t = useT()
  const fmt = useFmt()
  const viewRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null)
  const [fitWidth, setFitWidth] = useState(0)
  const [scale, setScale] = useState(1)
  const [page, setPage] = useState(1)
  // 滚动过程中不跟着换正在画的页。停下来再画当前这一屏,主线程才能把滚动让出去。
  const [settledPage, setSettledPage] = useState(1)
  const [draft, setDraft] = useState('1')
  const [editing, setEditing] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(true)
  const stickPage = useRef<number | null>(null)
  const shownPage = useRef(1)
  const editingRef = useRef(false)
  editingRef.current = editing
  const failed = failedSrc === src
  const view = loaded !== null && loaded.src === src ? loaded : null
  const pageCount = view?.pages.length ?? 0
  const pageWidth = fitWidth > 0 ? fitWidth * scale : 0

  useEffect(() => {
    setScale(1)
    setPage(1)
    setSettledPage(1)
    setDraft('1')
    setEditing(false)
    setOutlineOpen(false)
    setToolsOpen(true)
    stickPage.current = null
    shownPage.current = 1
  }, [src])

  useEffect(() => {
    let cancelled = false
    const task = getDocument({
      url: src,
      cMapUrl: pdfjsAsset('cmaps'),
      cMapPacked: true,
      standardFontDataUrl: pdfjsAsset('standard_fonts'),
      wasmUrl: pdfjsAsset('wasm')
    })
    void task.promise
      .then(async (pdf) => {
        const pages: PageSize[] = []
        for (let number = 1; number <= pdf.numPages; number += 1) {
          if (cancelled) return
          const page = await pdf.getPage(number)
          const viewport = page.getViewport({ scale: 1 })
          pages.push({
            number,
            width: viewport.width,
            height: viewport.height,
            userUnit: page.userUnit || 1
          })
        }
        if (cancelled) return
        if (pages.length === 0) {
          setFailedSrc(src)
          return
        }
        const tree = (await pdf.getOutline()) as OutlineNode[] | null
        const outline = tree === null ? [] : await flattenOutline(pdf, tree, 0)
        if (cancelled) return
        setLoaded({ src, pdf, pages, outline })
      })
      .catch(() => {
        if (!cancelled) setFailedSrc(src)
      })
    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [src])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const measure = (): void => {
      const style = getComputedStyle(scroller)
      const pad = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
      const width = scroller.clientWidth - pad
      setFitWidth((prev) => (Math.abs(prev - width) < 0.5 ? prev : width))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [failed, src])

  // 平时页码跟着滚动区顶部那一页。跳页之后,只要那一页还在视口里就停在它上面,
  // 最后一页顶不上去时也不会被前面那页抢回去。正在输入页码时不改输入框。
  // 页框只在容器尺寸变化时量一次。滚动时用距离算,不再每帧量每一页。
  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null || view === null || pageWidth <= 0) return
    let frames: PdfFrame[] = []
    let idle = 0
    const measure = (): void => {
      const base = scroller.offsetTop
      const next: PdfFrame[] = []
      for (const holder of scroller.querySelectorAll<HTMLElement>('.file-pdf-page')) {
        const number = Number(holder.dataset.page)
        if (!Number.isInteger(number)) continue
        const top = holder.offsetTop - base
        next.push({ number, top, bottom: top + holder.offsetHeight })
      }
      frames = next
    }
    const applyPage = (number: number): void => {
      if (number === 0 || number === shownPage.current) return
      shownPage.current = number
      setPage(number)
      if (!editingRef.current) setDraft(String(number))
    }
    const update = (): void => {
      const found = pageAtScroll(frames, scroller.scrollTop, scroller.clientHeight, stickPage.current)
      stickPage.current = found.stuck
      applyPage(found.page)
    }
    const onScroll = (): void => {
      update()
      scroller.classList.add('is-scrolling')
      window.clearTimeout(idle)
      idle = window.setTimeout(() => {
        scroller.classList.remove('is-scrolling')
        setSettledPage(shownPage.current)
        scroller.dispatchEvent(new Event('pdf-scroll-idle'))
      }, TEXT_IDLE_MS)
    }
    measure()
    update()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(() => {
      measure()
      update()
    })
    observer.observe(scroller)
    return () => {
      window.clearTimeout(idle)
      scroller.classList.remove('is-scrolling')
      scroller.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [view, pageCount, fitWidth, scale, pageWidth])

  useEffect(() => {
    pageRenders.focus(settledPage)
  }, [settledPage])

  useEffect(() => {
    const el = viewRef.current
    if (el === null) return
    // 画布元素的 onWheel 由 React 挂在根节点上,冒泡阶段的 stopPropagation 拦不住,
    // 滚轮会被当成白板平移。这里在捕获阶段截住。
    // 普通滚动必须 passive:非 passive 会让这次滚动等主线程,滚动条发涩。
    // Ctrl / Command(触控板双指也带 ctrlKey)才换成非 passive,用来缩放。
    // passive 不能中途改,按下或松开修饰键时换一次。
    let attached: boolean | null = null
    const onWheel = (event: WheelEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      // 目录自己滚,不拿来缩放,也不拦住。
      if (target?.closest('.file-pdf-outline') != null) return
      event.stopPropagation()
      if (attached !== false) return
      event.preventDefault()
      const factor = Math.exp(-event.deltaY * 0.002)
      setScale((current) => clampScale(current * factor))
    }
    const attach = (passive: boolean): void => {
      if (attached === passive) return
      if (attached !== null) el.removeEventListener('wheel', onWheel, true)
      el.addEventListener('wheel', onWheel, { capture: true, passive })
      attached = passive
    }
    const sync = (event: KeyboardEvent): void => {
      if (event.key !== 'Control' && event.key !== 'Meta') return
      const ctrlKey = event.key === 'Control' ? event.type === 'keydown' : event.ctrlKey
      const metaKey = event.key === 'Meta' ? event.type === 'keydown' : event.metaKey
      attach(!wantsWheelDefaultPrevented({ ctrlKey, metaKey }))
    }
    attach(true)
    window.addEventListener('keydown', sync)
    window.addEventListener('keyup', sync)
    return () => {
      if (attached !== null) el.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('keydown', sync)
      window.removeEventListener('keyup', sync)
    }
  }, [failed])

  if (failed) {
    return (
      <div className="file-placeholder" data-pdf-src={src}>
        <i className="fa-solid fa-file-circle-xmark" />
        <div>{t('notes.file.pdfFailed')}</div>
      </div>
    )
  }

  const hasOutline = view !== null && view.outline.some((entry) => entry.page !== null)

  const showPage = (number: number): void => {
    const next = Math.min(pageCount, Math.max(1, number))
    const scroller = scrollerRef.current
    const holder = scroller?.querySelector<HTMLElement>(`[data-page="${next}"]`)
    stickPage.current = next
    shownPage.current = next
    setSettledPage(next)
    // 只动 PDF 自己的滚动区。scrollIntoView 会把外面的白板容器一起滚走,顶栏就没了。
    if (scroller !== null && holder !== null && holder !== undefined) {
      scroller.scrollTo({ top: holder.offsetTop - scroller.offsetTop })
    }
    setPage(next)
    setDraft(String(next))
    setEditing(false)
  }

  const commitDraft = (): void => {
    const parsed = Number.parseInt(draft, 10)
    if (!Number.isInteger(parsed)) {
      setDraft(String(page))
      setEditing(false)
      return
    }
    showPage(parsed)
  }

  return (
    <div className="file-pdf-view" ref={viewRef} data-pdf-scale={scale.toFixed(3)} data-pdf-page={page}>
      <div className={`file-image-tools${toolsOpen ? '' : ' is-collapsed'}`}>
        {toolsOpen ? (
          <>
            {pageCount > 0 && (
              <button
                type="button"
                title={t('notes.file.pdfOutline')}
                aria-pressed={outlineOpen}
                onClick={() => setOutlineOpen((open) => !open)}
              >
                <i className="fa-solid fa-list" />
              </button>
            )}
            <button
              type="button"
              title={t('notes.file.pdfPrev')}
              disabled={page <= 1}
              onClick={() => showPage(page - 1)}
            >
              <i className="fa-solid fa-chevron-left" />
            </button>
            <span className="file-pdf-pager">
              <input
                className="file-pdf-page-input"
                aria-label={t('notes.file.pdfPage')}
                inputMode="numeric"
                value={editing ? draft : String(page)}
                onFocus={(event) => {
                  setEditing(true)
                  setDraft(String(page))
                  event.currentTarget.select()
                }}
                onChange={(event) => setDraft(event.target.value.replace(/\D/g, ''))}
                onBlur={commitDraft}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitDraft()
                    event.currentTarget.blur()
                  } else if (event.key === 'Escape') {
                    setDraft(String(page))
                    setEditing(false)
                    event.currentTarget.blur()
                  }
                }}
              />
              <span className="file-pdf-page-count">/ {pageCount || 1}</span>
            </span>
            <button
              type="button"
              title={t('notes.file.pdfNext')}
              disabled={pageCount === 0 || page >= pageCount}
              onClick={() => showPage(page + 1)}
            >
              <i className="fa-solid fa-chevron-right" />
            </button>
            <button
              type="button"
              title={t('notes.file.zoomOut')}
              onClick={() => setScale((current) => clampScale(current / 1.25))}
            >
              <i className="fa-solid fa-magnifying-glass-minus" />
            </button>
            <button
              type="button"
              title={t('notes.file.zoomReset')}
              className="file-image-scale"
              onClick={() => setScale(1)}
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              title={t('notes.file.zoomIn')}
              onClick={() => setScale((current) => clampScale(current * 1.25))}
            >
              <i className="fa-solid fa-magnifying-glass-plus" />
            </button>
            <button
              type="button"
              title={t('notes.file.pdfToolsCollapse')}
              aria-expanded={true}
              onClick={() => setToolsOpen(false)}
            >
              <i className="fa-solid fa-chevron-up" />
            </button>
          </>
        ) : (
          <button
            type="button"
            title={t('notes.file.pdfToolsExpand')}
            aria-expanded={false}
            onClick={() => setToolsOpen(true)}
          >
            <i className="fa-solid fa-chevron-down" />
          </button>
        )}
      </div>
      <div className="file-pdf-body">
        {outlineOpen && view !== null && (
          <nav
            className="file-pdf-outline"
            aria-label={t(hasOutline ? 'notes.file.pdfOutline' : 'notes.file.pdfPage')}
          >
            {hasOutline
              ? view.outline.map((entry, index) => (
                  <OutlineCard
                    key={index}
                    title={entry.title}
                    pageNumber={entry.page}
                    depth={entry.depth}
                    current={entry.page === page}
                    pdf={view.pdf}
                    pageSize={entry.page === null ? null : pageByNumber(view.pages, entry.page)}
                    pageLabel={
                      entry.page === null ? null : fmt(t('notes.file.pdfPageItem'), { N: entry.page })
                    }
                    onOpen={entry.page === null ? undefined : () => showPage(entry.page as number)}
                  />
                ))
              : view.pages.map((item) => (
                  <OutlineCard
                    key={item.number}
                    title={fmt(t('notes.file.pdfPageItem'), { N: item.number })}
                    pageNumber={item.number}
                    depth={0}
                    current={item.number === page}
                    pdf={view.pdf}
                    pageSize={item}
                    pageLabel={null}
                    onOpen={() => showPage(item.number)}
                  />
                ))}
          </nav>
        )}
        <div className="file-pdf" data-pdf-src={src} ref={scrollerRef}>
          {view !== null && pageWidth > 0 && (
            <div className="file-pdf-stack">
              {view.pages.map((item) => (
                <PdfPage
                  key={item.number}
                  pdf={view.pdf}
                  page={item}
                  cssWidth={pageWidth}
                  active={Math.abs(item.number - settledPage) <= PAGE_KEEP}
                  root={scrollerRef}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function pageByNumber(pages: PageSize[], number: number): PageSize | null {
  return pages.find((item) => item.number === number) ?? null
}

function OutlineCard({
  title,
  pageNumber,
  depth,
  current,
  pdf,
  pageSize,
  pageLabel,
  onOpen
}: {
  title: string
  pageNumber: number | null
  depth: number
  current: boolean
  pdf: PDFDocumentProxy
  pageSize: PageSize | null
  pageLabel: string | null
  onOpen?: () => void
}): React.JSX.Element {
  const indent = Math.min(depth, 4) * 8
  const body = (
    <>
      {pageSize !== null && <OutlineThumb pdf={pdf} page={pageSize} />}
      <span className="file-pdf-outline-label">{title}</span>
      {pageLabel !== null && pageLabel !== '' && <span className="file-pdf-outline-meta">{pageLabel}</span>}
    </>
  )
  const style = indent > 0 ? { marginLeft: indent } : undefined
  if (pageNumber === null || onOpen === undefined) {
    return (
      <div className="file-pdf-outline-item" style={style}>
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      className="file-pdf-outline-item"
      data-outline-page={pageNumber}
      aria-current={current ? 'page' : undefined}
      style={style}
      onClick={onOpen}
    >
      {body}
    </button>
  )
}

/** 目录卡片上的页缩略图。滚进来才画,避免一打开就把每一页都渲染一遍。 */
function OutlineThumb({ pdf, page }: { pdf: PDFDocumentProxy; page: PageSize }): React.JSX.Element {
  const holderRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const holder = holderRef.current
    if (holder === null) return
    const root = holder.closest('.file-pdf-outline')
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true)
      },
      { root: root instanceof HTMLElement ? root : null, rootMargin: '80px 0px' }
    )
    observer.observe(holder)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!seen) return
    const canvas = canvasRef.current
    if (canvas === null) return
    const handle = { cancelled: false, task: null as RenderTask | null }
    void (async () => {
      const proxy = await pdf.getPage(page.number)
      if (handle.cancelled) return
      // 缩略图只要能看清是哪一页。固定像素,滚动时不再跟着容器宽度重画。
      const cssWidth = 240
      const ratio = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP)
      const viewport = proxy.getViewport({ scale: (cssWidth / page.width) * ratio })
      canvas.width = Math.max(1, Math.floor(viewport.width))
      canvas.height = Math.max(1, Math.floor(viewport.height))
      const task = proxy.render({ canvas, viewport })
      handle.task = task
      try {
        await task.promise
      } catch (error) {
        if (error instanceof RenderingCancelledException) return
      }
    })()
    return () => {
      handle.cancelled = true
      handle.task?.cancel()
    }
  }, [seen, pdf, page.number, page.width])

  return (
    <div
      ref={holderRef}
      className="file-pdf-outline-thumb"
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  )
}

const PdfPage = memo(function PdfPage({
  pdf,
  page,
  cssWidth,
  active,
  root
}: {
  pdf: PDFDocumentProxy
  page: PageSize
  cssWidth: number
  active: boolean
  root: RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const cssHeight = cssWidth * (page.height / page.width)

  useEffect(() => {
    if (!active || cssWidth < 1) return
    const canvas = canvasRef.current
    if (canvas === null) return
    const handle = { cancelled: false, task: null as RenderTask | null }
    pageRenders.schedule({
      page: page.number,
      cancelled: () => handle.cancelled,
      run: async () => {
        if (handle.cancelled || !canvas.isConnected) return
        const proxy = await pdf.getPage(page.number)
        if (handle.cancelled || !canvas.isConnected) return
        const ratio = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP)
        const viewport = proxy.getViewport({ scale: (cssWidth / page.width) * ratio })
        canvas.width = Math.max(1, Math.floor(viewport.width))
        canvas.height = Math.max(1, Math.floor(viewport.height))
        const task = proxy.render({ canvas, viewport })
        handle.task = task
        try {
          await task.promise
        } catch (error) {
          if (error instanceof RenderingCancelledException) return
        }
      }
    })
    return () => {
      handle.cancelled = true
      handle.task?.cancel()
    }
  }, [active, cssWidth, pdf, page])

  useEffect(() => {
    if (!active || cssWidth < 1) return
    const host = textRef.current
    const scroller = root.current
    if (host === null || scroller === null) return
    const handle = { cancelled: false, layer: null as TextLayer | null }
    let listening = false
    const build = (): void => {
      void (async () => {
        const proxy = await pdf.getPage(page.number)
        if (handle.cancelled) return
        const viewport = proxy.getViewport({ scale: cssWidth / page.width })
        host.replaceChildren()
        const layer = new TextLayer({
          textContentSource: await proxy.getTextContent(),
          container: host,
          viewport
        })
        handle.layer = layer
        if (handle.cancelled) {
          layer.cancel()
          return
        }
        try {
          await layer.render()
        } catch {
          // 换页或缩放时上一次会被 cancel,不当失败。
        }
      })()
    }
    const onIdle = (): void => {
      if (handle.cancelled || scroller.classList.contains('is-scrolling')) return
      scroller.removeEventListener('pdf-scroll-idle', onIdle)
      listening = false
      build()
    }
    if (!scroller.classList.contains('is-scrolling')) build()
    else {
      listening = true
      scroller.addEventListener('pdf-scroll-idle', onIdle)
    }
    return () => {
      handle.cancelled = true
      handle.layer?.cancel()
      if (listening) scroller.removeEventListener('pdf-scroll-idle', onIdle)
      host.replaceChildren()
    }
  }, [active, cssWidth, pdf, page, root])

  return (
    <div
      className="file-pdf-page"
      data-page={page.number}
      style={{
        width: cssWidth,
        height: cssHeight,
        ['--scale-factor' as string]: String(cssWidth / page.width),
        ['--user-unit' as string]: String(page.userUnit)
      }}
    >
      {active ? (
        <>
          <canvas ref={canvasRef} />
          <div ref={textRef} className="textLayer" />
        </>
      ) : null}
    </div>
  )
})
