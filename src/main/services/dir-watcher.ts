// launchd 目录监听:fs.watch + 去抖(0.4s,refactor-plan 阶段 1 既定口径);
// 逐目录降级:权限不足/不存在 → 跳过该目录,不影响其余目录与主流程

import { watch, type FSWatcher } from 'node:fs'

export function launchdWatchDirs(home: string): string[] {
  return [`${home}/Library/LaunchAgents`, '/Library/LaunchAgents', '/Library/LaunchDaemons']
}

export interface DebouncedDirWatcher {
  start(): void
  stop(): void
  readonly watching: string[]
}

// 尾沿去抖:窗口内多次 schedule 只触发一次 fn(纯逻辑,可注入时钟单测)
export function createTrailingDebouncer(
  delayMs: number,
  fn: () => void
): { schedule(): void; cancel(): void } {
  let timer: NodeJS.Timeout | null = null
  return {
    schedule() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        fn()
      }, delayMs)
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}

export function createDebouncedDirWatcher(opts: {
  dirs: string[]
  debounceMs?: number
  onChange(dirs: string[]): void
  log?(msg: string): void
}): DebouncedDirWatcher {
  const debounceMs = opts.debounceMs ?? 400
  const log = opts.log ?? ((): void => {})
  const watchers = new Map<string, FSWatcher>()
  const changed = new Set<string>()
  let running = false
  const debouncer = createTrailingDebouncer(debounceMs, () => {
    if (changed.size === 0) return
    const dirs = [...changed]
    changed.clear()
    log(`change detected: ${dirs.join(', ')}`)
    opts.onChange(dirs)
  })

  return {
    start() {
      if (watchers.size > 0) return
      running = true
      for (const dir of opts.dirs) {
        try {
          const w = watch(dir, () => {
            if (!running) return // stop 后到达的滞留事件不再触发
            changed.add(dir)
            debouncer.schedule()
          })
          w.on('error', (err) => {
            log(`watch error, drop ${dir}: ${String(err)}`)
            watchers.delete(dir)
            w.close()
          })
          watchers.set(dir, w)
        } catch (err) {
          log(`skip ${dir}: ${String(err)}`)
        }
      }
      log(`started (${watchers.size}/${opts.dirs.length} dirs)`)
    },
    stop() {
      running = false
      debouncer.cancel()
      changed.clear()
      for (const w of watchers.values()) w.close()
      watchers.clear()
      log('stopped')
    },
    get watching() {
      return [...watchers.keys()]
    }
  }
}
