import { describe, expect, it } from 'vitest'
import { createPageRenderQueue, pageAtScroll, wantsWheelDefaultPrevented } from './pdf-scroll'

describe('pageAtScroll', () => {
  const frames = [
    { number: 1, top: 0, bottom: 1000 },
    { number: 2, top: 1012, bottom: 1212 }
  ]

  it('标记线落在哪一页,页码就是哪一页', () => {
    expect(pageAtScroll(frames, 0, 600, null)).toEqual({ page: 1, stuck: null })
    expect(pageAtScroll(frames, 800, 600, null)).toEqual({ page: 1, stuck: null })
    expect(pageAtScroll(frames, 1000, 600, null).page).toBe(2)
  })

  it('跳到末页但顶不上去时,只要那一页还在视口里就停在它上面', () => {
    expect(pageAtScroll(frames, 612, 600, 2)).toEqual({ page: 2, stuck: 2 })
  })

  it('那一页离开视口后改跟标记线', () => {
    expect(pageAtScroll(frames, 0, 600, 2)).toEqual({ page: 1, stuck: null })
  })
})

describe('createPageRenderQueue', () => {
  it('同一轮里先画离当前页最近的,并且一次只画一页', async () => {
    const queue = createPageRenderQueue()
    const started: number[] = []
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    queue.focus(1)
    queue.schedule({
      page: 3,
      cancelled: () => false,
      run: async () => {
        started.push(3)
        await gate
      }
    })
    queue.schedule({
      page: 1,
      cancelled: () => false,
      run: async () => {
        started.push(1)
        await gate
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(started).toEqual([1])
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(started).toEqual([1, 3])
  })

  it('只有按住 Ctrl 或 Command 的滚轮才拦截默认滚动', () => {
    expect(wantsWheelDefaultPrevented({ ctrlKey: false, metaKey: false })).toBe(false)
    expect(wantsWheelDefaultPrevented({ ctrlKey: true, metaKey: false })).toBe(true)
    expect(wantsWheelDefaultPrevented({ ctrlKey: false, metaKey: true })).toBe(true)
  })

  it('取消的不画', async () => {
    const queue = createPageRenderQueue()
    const started: number[] = []
    queue.schedule({
      page: 2,
      cancelled: () => true,
      run: async () => {
        started.push(2)
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(started).toEqual([])
  })
})
