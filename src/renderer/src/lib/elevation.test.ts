// 提权缓存窗口(authCacheMin)语义单测:设置 → getter 注入 → ELEVATION 行为
// 说明:窗口只管「应用侧说明窗」的免打扰;真正的系统授权框由 macOS 控制(应用不缓存密码)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ElevationModule = typeof import('./elevation')

async function load(min: number): Promise<ElevationModule> {
  vi.resetModules()
  const mod = await import('./elevation')
  mod.setAuthCacheMinGetter(() => min)
  return mod
}

// 一次「需要人工确认」的请求:返回 {pending, grant, cancel}
async function requestPending(mod: ElevationModule): Promise<{ pending: Promise<boolean>; req: unknown }> {
  let seen: unknown = null
  mod.ELEVATION.subscribe((r) => {
    if (r) seen = r
  })
  const pending = mod.ELEVATION.request({ detail: 'd', command: 'c' })
  await Promise.resolve() // 订阅回调同步触发;让微任务清空
  return { pending, req: seen }
}

describe('authCacheMin 提权缓存窗口', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('min=5:授权后窗口内跳过说明窗;窗口过期后需再次确认', async () => {
    const mod = await load(5)
    const first = await requestPending(mod)
    expect(first.req).not.toBeNull() // 首次需人工
    mod.ELEVATION.grant()
    expect(await first.pending).toBe(true)

    // 窗口内:静默通过(不触发模态)
    const second = await requestPending(mod)
    expect(second.req).toBeNull()
    expect(await second.pending).toBe(true)

    // 5 分钟后:窗口过期,需再次人工
    vi.advanceTimersByTime(5 * 60_000 + 1)
    const third = await requestPending(mod)
    expect(third.req).not.toBeNull()
  })

  it('min=0:每次都要确认(不写窗口)', async () => {
    const mod = await load(0)
    const first = await requestPending(mod)
    mod.ELEVATION.grant()
    await first.pending
    const second = await requestPending(mod)
    expect(second.req).not.toBeNull() // 仍需人工
  })

  it('min=15:真实提权成功(noteSuccess)也置热窗口', async () => {
    const mod = await load(15)
    mod.ELEVATION.noteSuccess()
    const first = await requestPending(mod)
    expect(first.req).toBeNull() // 已置热 → 跳过
    expect(await first.pending).toBe(true)

    vi.advanceTimersByTime(15 * 60_000 + 1)
    const after = await requestPending(mod)
    expect(after.req).not.toBeNull()
  })

  it('窗口置热后把 min 改为 0 → 已热的窗口立即失效(每次确认)', async () => {
    const mod = await load(5)
    mod.ELEVATION.noteSuccess() // 置热
    const warm = await requestPending(mod)
    expect(warm.req).toBeNull() // 跳过 ✓
    mod.setAuthCacheMinGetter(() => 0)
    const after = await requestPending(mod)
    expect(after.req).not.toBeNull() // 改 0 后立即恢复确认
  })

  it('取消不写窗口:下一次仍需确认', async () => {
    const mod = await load(5)
    const first = await requestPending(mod)
    mod.ELEVATION.cancel()
    expect(await first.pending).toBe(false)
    const second = await requestPending(mod)
    expect(second.req).not.toBeNull()
  })
})
