// PDF 滚动时少碰布局。页码用已经量好的页框算;画页面一次只画一页。

export interface PdfFrame {
  number: number
  top: number
  bottom: number
}

export interface PageAtScroll {
  /** 0 表示还没有页可以算。 */
  page: number
  /** 跳页钉住的那一页。离开视口后变成 null。 */
  stuck: number | null
}

/**
 * 滚动区里该算哪一页。
 * 标记线在视口顶往下 24px,和原来量每一页 getBoundingClientRect 的那条线一致。
 * 跳页之后,只要那一页还和视口相交(上下各让 8px),就停在它上面。
 */
export function pageAtScroll(
  frames: readonly PdfFrame[],
  scrollTop: number,
  clientHeight: number,
  stuck: number | null
): PageAtScroll {
  if (stuck !== null) {
    const frame = frames.find((item) => item.number === stuck)
    const viewTop = scrollTop + 8
    const viewBottom = scrollTop + clientHeight - 8
    if (frame !== undefined && frame.bottom > viewTop && frame.top < viewBottom) {
      return { page: stuck, stuck }
    }
  }
  const marker = scrollTop + 24
  let next = 0
  for (const frame of frames) {
    if (frame.top <= marker && frame.bottom > marker) {
      next = frame.number
      break
    }
    if (frame.top > marker && next === 0) next = frame.number
  }
  return { page: next, stuck: null }
}

export interface PageRenderJob {
  page: number
  cancelled: () => boolean
  run: () => Promise<void>
}

export interface PageRenderQueue {
  focus(page: number): void
  schedule(job: PageRenderJob): void
}

/** 同一轮提交里的页先排好队,再按离当前页的距离画。一次只画一页。 */
export function createPageRenderQueue(): PageRenderQueue {
  const jobs: (PageRenderJob & { seq: number })[] = []
  let seq = 0
  let focus = 1
  let draining = false
  let kickScheduled = false

  function sort(): void {
    jobs.sort((a, b) => Math.abs(a.page - focus) - Math.abs(b.page - focus) || a.seq - b.seq)
  }

  async function drain(): Promise<void> {
    if (draining) return
    draining = true
    try {
      while (jobs.length > 0) {
        sort()
        const job = jobs.shift()
        if (job === undefined || job.cancelled()) continue
        try {
          await job.run()
        } catch {
          // 这一页画失败就跳过,后面的页还要画。
        }
      }
    } finally {
      draining = false
      if (jobs.length > 0) kick()
    }
  }

  function kick(): void {
    if (draining || kickScheduled) return
    kickScheduled = true
    queueMicrotask(() => {
      kickScheduled = false
      void drain()
    })
  }

  return {
    focus(page) {
      focus = page
    },
    schedule(job) {
      jobs.push({ ...job, seq: seq })
      seq += 1
      kick()
    }
  }
}

/**
 * 白板在容器上挂了非 passive 的滚轮监听,普通滚动也会被它拦住等主线程。
 * 这里只在真正要缩放时才 preventDefault,其余时候监听保持 passive,滚动走合成器线程。
 * 每次按下或松开修饰键都要换一次:passive 不能中途改。
 */
export function wantsWheelDefaultPrevented(event: {
  ctrlKey: boolean
  metaKey: boolean
}): boolean {
  return event.ctrlKey || event.metaKey
}
