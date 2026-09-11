// fsevents 域:fseventsActive → launchd 目录监听启停 → 去抖后广播 agents:dirChanged
// (renderer agents-store 收到即 reload;数据源仍 mock,阶段 1 换真实源后即为真实刷新)

import { IPC_EVENTS } from '../../../shared/ipc'
import { createDebouncedDirWatcher, type DebouncedDirWatcher } from '../../services/dir-watcher'
import type { SettingsApplier } from '../types'

export function createFsEventsApplier(opts?: { debounceMs?: number }): SettingsApplier {
  const debounceMs = opts?.debounceMs ?? 400
  let watcher: DebouncedDirWatcher | null = null

  return {
    key: 'fsevents',
    apply(s, _prev, ctx) {
      if (s.fseventsActive) {
        if (watcher) return
        watcher = createDebouncedDirWatcher({
          dirs: ctx.watchDirs,
          debounceMs,
          log: (msg) => console.log(`[fswatch] ${msg}`),
          onChange: (dirs) => ctx.broadcast(IPC_EVENTS.agentsDirChanged, { dirs })
        })
        watcher.start()
      } else if (watcher) {
        watcher.stop()
        watcher = null
      }
    }
  }
}
