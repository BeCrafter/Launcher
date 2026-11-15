import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdatePhase } from '../../shared/ipc'
import { createUpdateScheduler } from './update-scheduler'

const FIRST = 1000
const INTERVAL = 5000

function makeHarness(over: { phase?: UpdatePhase; enabled?: boolean } = {}) {
  let phase: UpdatePhase = over.phase ?? 'upToDate'
  let enabled = over.enabled ?? true
  let checks = 0
  const check = vi.fn(async () => {
    checks += 1
  })
  const scheduler = createUpdateScheduler({
    check,
    getPhase: () => phase,
    getAutoEnabled: () => enabled,
    firstDelayMs: FIRST,
    intervalMs: INTERVAL
  })
  return {
    scheduler,
    check,
    checks: () => checks,
    setPhase: (p: UpdatePhase) => {
      phase = p
    },
    setEnabled: (v: boolean) => {
      enabled = v
    }
  }
}

describe('update-scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('首次延时后才检查,之后按间隔重复', async () => {
    const h = makeHarness()
    h.scheduler.start()
    await vi.advanceTimersByTimeAsync(FIRST - 1)
    expect(h.checks()).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.checks()).toBe(1)
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(h.checks()).toBe(2)
    await vi.advanceTimersByTimeAsync(INTERVAL * 2)
    expect(h.checks()).toBe(4)
    h.scheduler.stop()
  })

  it('下载中 / 待重启等相位不发起检查', async () => {
    const h = makeHarness({ phase: 'downloading' })
    h.scheduler.start()
    await vi.advanceTimersByTimeAsync(FIRST + INTERVAL * 2)
    expect(h.checks()).toBe(0)

    // available 是「等用户点下载」的稳定态,也不该被每小时检查重置
    h.setPhase('available')
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(h.checks()).toBe(0)

    // error 是用户可见的失败,不自动重试
    h.setPhase('error')
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(h.checks()).toBe(0)
    h.scheduler.stop()
  })

  it('设置关掉后不再检查,重新打开的下一个 tick 恢复', async () => {
    const h = makeHarness()
    h.scheduler.start()
    h.setEnabled(false)
    await vi.advanceTimersByTimeAsync(FIRST + INTERVAL * 2)
    expect(h.checks()).toBe(0)

    h.setEnabled(true)
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(h.checks()).toBe(1)
    h.scheduler.stop()
  })

  it('上一次检查未结束时 tick 不重入', async () => {
    const gate: { finish: (() => void) | null } = { finish: null }
    const check = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          gate.finish = resolve
        })
    )
    const scheduler = createUpdateScheduler({
      check,
      getPhase: () => 'upToDate',
      getAutoEnabled: () => true,
      firstDelayMs: FIRST,
      intervalMs: INTERVAL
    })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(FIRST + INTERVAL * 3)
    expect(check).toHaveBeenCalledTimes(1)

    gate.finish?.()
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(check).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('stop() 之后不再触发,start() 幂等', async () => {
    const h = makeHarness()
    h.scheduler.start()
    h.scheduler.start()
    await vi.advanceTimersByTimeAsync(FIRST)
    expect(h.checks()).toBe(1)

    h.scheduler.stop()
    await vi.advanceTimersByTimeAsync(INTERVAL * 3)
    expect(h.checks()).toBe(1)
  })
})
