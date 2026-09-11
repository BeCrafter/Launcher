import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDebouncedDirWatcher, createTrailingDebouncer, launchdWatchDirs } from './dir-watcher'

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), 'dirwatcher-'))
}

// fs.watch 注册存在启动瞬态:注册完成前同 tick 的写入可能丢失(并行负载下偶发);
// 等待注册就绪再写入,保证测试确定性(生产场景启动后即有全量加载,无此影响)
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50))

const cleanups: string[] = []
afterEach(() => {
  for (const d of cleanups.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('launchdWatchDirs', () => {
  it('拼接用户与系统 launchd 目录', () => {
    expect(launchdWatchDirs('/Users/x')).toEqual([
      '/Users/x/Library/LaunchAgents',
      '/Library/LaunchAgents',
      '/Library/LaunchDaemons'
    ])
  })
})

describe('createTrailingDebouncer(确定性:伪时钟)', () => {
  it('窗口内多次 schedule 只触发一次;触发后可再次调度', () => {
    vi.useFakeTimers()
    try {
      const fn = vi.fn()
      const d = createTrailingDebouncer(100, fn)
      d.schedule()
      d.schedule()
      d.schedule()
      vi.advanceTimersByTime(99)
      expect(fn).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(fn).toHaveBeenCalledTimes(1)

      d.schedule()
      vi.advanceTimersByTime(100)
      expect(fn).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancel 取消未触发的调度', () => {
    vi.useFakeTimers()
    try {
      const fn = vi.fn()
      const d = createTrailingDebouncer(100, fn)
      d.schedule()
      d.cancel()
      vi.advanceTimersByTime(200)
      expect(fn).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('createDebouncedDirWatcher(fs.watch 集成)', () => {
  it('目录内新建文件 → 去抖后 onChange 收到该目录(至少一次、载荷正确)', async () => {
    const dir = mkTmp()
    cleanups.push(dir)
    const onChange = vi.fn()
    const w = createDebouncedDirWatcher({ dirs: [dir], debounceMs: 30, onChange })
    w.start()
    expect(w.watching).toEqual([dir])
    await settle()
    writeFileSync(join(dir, 'a.plist'), 'x')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith([dir]), { timeout: 3000 })
    w.stop()
  })

  it('stop 后写入不再触发', async () => {
    const dir = mkTmp()
    cleanups.push(dir)
    const onChange = vi.fn()
    const w = createDebouncedDirWatcher({ dirs: [dir], debounceMs: 30, onChange })
    w.start()
    w.stop()
    expect(w.watching).toEqual([])
    writeFileSync(join(dir, 'b.plist'), 'x')
    await new Promise((r) => setTimeout(r, 200))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('不存在/不可 watch 的目录被跳过且不抛', () => {
    const onChange = vi.fn()
    const w = createDebouncedDirWatcher({
      dirs: ['/no/such/dir-becrafter-e2e'],
      debounceMs: 30,
      onChange
    })
    expect(() => w.start()).not.toThrow()
    expect(w.watching).toEqual([])
    w.stop()
  })
})
