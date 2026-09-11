import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { IPC_EVENTS } from '../../../shared/ipc'
import { DEFAULT_SETTINGS, type LauncherSettings } from '../../../shared/settings'
import type { ApplyCtx } from '../types'
import { createFsEventsApplier } from './fsevents'

const cleanups: string[] = []
afterEach(() => {
  for (const d of cleanups.splice(0)) rmSync(d, { recursive: true, force: true })
})

// fs.watch 注册存在启动瞬态(并行负载下偶发丢失同 tick 写入);等待注册就绪再写
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50))

function makeCtx(dir: string): { ctx: ApplyCtx; broadcast: Mock } {
  const broadcast = vi.fn()
  return {
    broadcast,
    ctx: {
      logoDir: () => '/tmp',
      getWindow: () => null,
      tray: { ensure: () => {}, setBadgeCount: () => {}, refreshBadge: () => {}, badgeCount: 0 },
      watchDirs: [dir],
      broadcast
    }
  }
}

function settings(patch: Partial<LauncherSettings>): LauncherSettings {
  return { ...DEFAULT_SETTINGS, ...patch }
}

describe('createFsEventsApplier', () => {
  it('fseventsActive=true → 目录变化广播 agents:dirChanged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fsevents-'))
    cleanups.push(dir)
    const { ctx, broadcast } = makeCtx(dir)
    const applier = createFsEventsApplier({ debounceMs: 30 })

    applier.apply(settings({ fseventsActive: true }), null, ctx)
    await settle()
    writeFileSync(join(dir, 'x.plist'), 'x')

    await vi.waitFor(
      () => expect(broadcast).toHaveBeenCalledWith(IPC_EVENTS.agentsDirChanged, { dirs: [dir] }),
      { timeout: 3000 }
    )
    applier.apply(settings({ fseventsActive: false }), settings({ fseventsActive: true }), ctx)
  })

  it('fseventsActive=false → 不监听不广播', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fsevents-'))
    cleanups.push(dir)
    const { ctx, broadcast } = makeCtx(dir)
    const applier = createFsEventsApplier({ debounceMs: 30 })

    applier.apply(settings({ fseventsActive: false }), null, ctx)
    writeFileSync(join(dir, 'x.plist'), 'x')
    await new Promise((r) => setTimeout(r, 200))
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('关闭后再开启恢复监听', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fsevents-'))
    cleanups.push(dir)
    const { ctx, broadcast } = makeCtx(dir)
    const applier = createFsEventsApplier({ debounceMs: 30 })

    // 重复 apply(true) 不应重复建 watcher(若重复,事件会翻倍——关闭态的无新增断言可捕获)
    applier.apply(settings({ fseventsActive: true }), null, ctx)
    applier.apply(settings({ fseventsActive: true }), null, ctx)
    await settle()
    writeFileSync(join(dir, 'a.plist'), 'a')
    await vi.waitFor(
      () => expect(broadcast).toHaveBeenCalledWith(IPC_EVENTS.agentsDirChanged, { dirs: [dir] }),
      { timeout: 3000 }
    )
    const afterEnable = broadcast.mock.calls.length

    applier.apply(settings({ fseventsActive: false }), null, ctx)
    writeFileSync(join(dir, 'b.plist'), 'b')
    await new Promise((r) => setTimeout(r, 300))
    expect(broadcast.mock.calls.length).toBe(afterEnable) // 关闭后无新增事件(确定性)

    applier.apply(settings({ fseventsActive: true }), null, ctx)
    await settle()
    writeFileSync(join(dir, 'c.plist'), 'c')
    await vi.waitFor(() => expect(broadcast.mock.calls.length).toBeGreaterThan(afterEnable), {
      timeout: 3000
    })
    applier.apply(settings({ fseventsActive: false }), null, ctx)
  })
})
