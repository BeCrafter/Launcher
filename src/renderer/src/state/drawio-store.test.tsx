// draw.io 在线/离线偏好与离线包状态的 store。
//
// 这里测的是「界面为什么显示成那样」的下游逻辑:
// - 模式记忆:localStorage 里选过就听用户的;从没选过而本机已装包时默认离线
// - ensureStatus 只拉一次 IPC,失败后要能把缓存清掉重试
// - 下载 / 取消 / 导入 war 的 phase 流转;取消不算错误
// - main 推来的进度只在「正在下载」时覆盖,结束后不能被迟到的进度又写回去
//
// store 有模块级缓存(statusPromise / subscribed),每个用例用 resetModules 拿一份新的;
// 模式是在模块初始化时从 localStorage 读的,所以都要在 import 之前先播好。

import { describe, expect, it, vi, type Mock } from 'vitest'
import type { DrawioStatus, DrawioStatusEvent } from '@shared/drawio'
import { installLauncherStub, mockLauncher } from '../test/launcher-stub'

const installed: DrawioStatus = {
  installed: true,
  version: '32.6.10',
  stub: false,
  downloading: false
}
const missing: DrawioStatus = {
  installed: false,
  version: '32.6.10',
  stub: false,
  downloading: false
}

interface DrawioApiMock {
  status: Mock<() => Promise<DrawioStatus>>
  download: Mock<() => Promise<{ ok: boolean; status: DrawioStatus; message?: string }>>
  cancel: Mock<() => Promise<void>>
  importWar: Mock<(warPath: string) => Promise<{ ok: boolean; status: DrawioStatus; message?: string }>>
  onStatus: Mock<(cb: (event: DrawioStatusEvent) => void) => () => void>
}

function api(overrides: Partial<DrawioApiMock> = {}): DrawioApiMock {
  return {
    status: vi.fn(async () => missing),
    download: vi.fn(async () => ({ ok: true, status: installed })),
    cancel: vi.fn(async () => undefined),
    importWar: vi.fn(async () => ({ ok: true, status: installed })),
    onStatus: vi.fn(() => () => {}),
    ...overrides
  }
}

type StoreModule = typeof import('./drawio-store')

/** 新开一份 store 模块。localStorage 必须在调用前播好(模块初始化时读模式)。 */
async function boot(
  options: { drawio?: Partial<DrawioApiMock>; pickFile?: unknown } = {}
): Promise<{ store: StoreModule; drawio: DrawioApiMock }> {
  const drawio = api(options.drawio)
  vi.resetModules()
  installLauncherStub({
    drawio,
    ...(options.pickFile === undefined ? {} : { pickFile: options.pickFile as never })
  })
  const store = await import('./drawio-store')
  return { store, drawio }
}

const MODE_KEY = 'launcher.drawio.mode'

describe('effectiveDrawioMode', () => {
  it('选了离线但包不在 → 回退在线,不打开空 iframe', async () => {
    const { store } = await boot()
    expect(store.effectiveDrawioMode('offline', null)).toBe('online')
    expect(store.effectiveDrawioMode('offline', missing)).toBe('online')
  })

  it('包装好才真的走离线', async () => {
    const { store } = await boot()
    expect(store.effectiveDrawioMode('offline', installed)).toBe('offline')
  })

  it('在线偏好不受包状态影响', async () => {
    const { store } = await boot()
    expect(store.effectiveDrawioMode('online', null)).toBe('online')
    expect(store.effectiveDrawioMode('online', installed)).toBe('online')
  })
})

describe('初始模式', () => {
  it('没选过也没有包 → 在线', async () => {
    const { store } = await boot()
    expect(store.useDrawioStore.getState().mode).toBe('online')
  })

  it('选过离线 → 离线', async () => {
    localStorage.setItem(MODE_KEY, 'offline')
    const { store } = await boot()
    expect(store.useDrawioStore.getState().mode).toBe('offline')
  })

  it('存了别的值按在线处理', async () => {
    localStorage.setItem(MODE_KEY, 'whatever')
    const { store } = await boot()
    expect(store.useDrawioStore.getState().mode).toBe('online')
  })

  it('localStorage 读不了也不崩,按在线', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { store } = await boot()
    expect(store.useDrawioStore.getState().mode).toBe('online')
  })
})

describe('ensureStatus', () => {
  it('只拉一次 IPC,后续直接用缓存', async () => {
    const { store, drawio } = await boot({ drawio: { status: vi.fn(async () => installed) } })
    const first = await store.useDrawioStore.getState().ensureStatus()
    const second = await store.useDrawioStore.getState().ensureStatus()
    expect(first).toEqual(installed)
    expect(second).toEqual(installed)
    expect(drawio.status).toHaveBeenCalledTimes(1)
  })

  it('E2E stub 视作已装,直接走离线', async () => {
    const { store } = await boot({ drawio: { status: vi.fn(async () => ({ ...missing, stub: true })) } })
    await store.useDrawioStore.getState().ensureStatus()
    expect(store.useDrawioStore.getState().mode).toBe('offline')
  })

  it('装好包且从没选过模式 → 默认离线(本地打开快得多)', async () => {
    const { store } = await boot({ drawio: { status: vi.fn(async () => installed) } })
    await store.useDrawioStore.getState().ensureStatus()
    expect(store.useDrawioStore.getState().mode).toBe('offline')
  })

  it('用户显式选过在线,装了包也听用户的', async () => {
    localStorage.setItem(MODE_KEY, 'online')
    const { store } = await boot({ drawio: { status: vi.fn(async () => installed) } })
    await store.useDrawioStore.getState().ensureStatus()
    expect(store.useDrawioStore.getState().mode).toBe('online')
  })

  it('没包也不改用户的在线选择', async () => {
    const { store } = await boot({ drawio: { status: vi.fn(async () => missing) } })
    await store.useDrawioStore.getState().ensureStatus()
    expect(store.useDrawioStore.getState().mode).toBe('online')
  })

  it('读取失败抛出中文错误,并且清掉缓存让下次能重试', async () => {
    const status = vi
      .fn<() => Promise<DrawioStatus>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(installed)
    const { store } = await boot({ drawio: { status } })
    await expect(store.useDrawioStore.getState().ensureStatus()).rejects.toThrow(
      '读取 draw.io 组件状态失败'
    )
    await expect(store.useDrawioStore.getState().ensureStatus()).resolves.toEqual(installed)
    expect(status).toHaveBeenCalledTimes(2)
  })
})

describe('requestOffline', () => {
  it('已经装好包:直接切离线并记住', async () => {
    const { store } = await boot({ drawio: { status: vi.fn(async () => installed) } })
    await store.useDrawioStore.getState().requestOffline()
    expect(store.useDrawioStore.getState().mode).toBe('offline')
    expect(store.useDrawioStore.getState().phase).toBe('idle')
    expect(localStorage.getItem(MODE_KEY)).toBe('offline')
  })

  it('没装包:先问用户要不要下载,不偷偷改模式', async () => {
    const { store } = await boot({ drawio: { status: vi.fn(async () => missing) } })
    await store.useDrawioStore.getState().requestOffline()
    expect(store.useDrawioStore.getState().phase).toBe('confirm')
    expect(store.useDrawioStore.getState().mode).toBe('online')
    expect(localStorage.getItem(MODE_KEY)).toBeNull()
  })

  it('取消确认框回到 idle', async () => {
    const { store } = await boot({ drawio: { status: vi.fn(async () => missing) } })
    await store.useDrawioStore.getState().requestOffline()
    store.useDrawioStore.getState().dismissConfirm()
    expect(store.useDrawioStore.getState().phase).toBe('idle')
  })
})

describe('switchOnline', () => {
  it('切回在线:记住选择并清掉下载进度/错误', async () => {
    localStorage.setItem(MODE_KEY, 'offline')
    const { store } = await boot({ drawio: { status: vi.fn(async () => installed) } })
    store.useDrawioStore.setState({
      mode: 'offline',
      phase: 'downloading',
      progress: { phase: 'download', received: 10, total: 100 },
      error: '旧错误'
    })
    store.useDrawioStore.getState().switchOnline()
    const state = store.useDrawioStore.getState()
    expect(state.mode).toBe('online')
    expect(state.phase).toBe('idle')
    expect(state.progress).toBeNull()
    expect(state.error).toBeNull()
    expect(localStorage.getItem(MODE_KEY)).toBe('online')
  })
})

describe('download', () => {
  it('下载成功且包装好 → 切离线并记住', async () => {
    const downloading: DrawioStatus = { ...missing, downloading: true }
    const { store, drawio } = await boot({
      drawio: {
        status: vi.fn(async () => missing),
        download: vi.fn(async () => ({ ok: true, status: installed })),
        onStatus: vi.fn((cb: (event: DrawioStatusEvent) => void) => {
          cb({ status: downloading })
          return () => {}
        })
      }
    })
    await store.useDrawioStore.getState().ensureStatus()
    await store.useDrawioStore.getState().download()
    const state = store.useDrawioStore.getState()
    expect(drawio.download).toHaveBeenCalledTimes(1)
    expect(state.mode).toBe('offline')
    expect(state.phase).toBe('idle')
    expect(state.progress).toBeNull()
    expect(state.status).toEqual(installed)
    expect(localStorage.getItem(MODE_KEY)).toBe('offline')
  })

  it('取消:回到 idle,不当成错误', async () => {
    const { store } = await boot({
      drawio: {
        download: vi.fn(async () => ({ ok: false, status: missing, message: '已取消' }))
      }
    })
    await store.useDrawioStore.getState().download()
    const state = store.useDrawioStore.getState()
    expect(state.phase).toBe('idle')
    expect(state.error).toBeNull()
    expect(state.progress).toBeNull()
  })

  it('失败:停在 error 并把 main 的原因显示出来', async () => {
    const { store } = await boot({
      drawio: {
        download: vi.fn(async () => ({
          ok: false,
          status: missing,
          message: '下载源都连不上'
        }))
      }
    })
    await store.useDrawioStore.getState().download()
    const state = store.useDrawioStore.getState()
    expect(state.phase).toBe('error')
    expect(state.error).toBe('下载源都连不上')
    expect(state.mode).toBe('online')
  })

  it('返回 ok 但包装没装上,仍按失败处理', async () => {
    const { store } = await boot({
      drawio: {
        download: vi.fn(async () => ({ ok: true, status: missing }))
      }
    })
    await store.useDrawioStore.getState().download()
    expect(store.useDrawioStore.getState().phase).toBe('error')
    expect(store.useDrawioStore.getState().error).toBe('下载失败')
  })

  it('取消下载会真的通知 main', async () => {
    const { store, drawio } = await boot()
    await store.useDrawioStore.getState().cancel()
    expect(drawio.cancel).toHaveBeenCalledTimes(1)
    expect(store.useDrawioStore.getState().phase).toBe('idle')
    expect(store.useDrawioStore.getState().progress).toBeNull()
  })
})

describe('importWar', () => {
  it('选择框取消:什么都不做,也不调 IPC', async () => {
    const { store, drawio } = await boot()
    await store.useDrawioStore.getState().importWar('选择离线包')
    expect(mockLauncher().pickFile).toHaveBeenCalledTimes(1)
    expect(drawio.importWar).not.toHaveBeenCalled()
    expect(store.useDrawioStore.getState().phase).toBe('idle')
  })

  it('导入成功 → 切离线', async () => {
    const { store, drawio } = await boot({
      pickFile: vi.fn(async () => ({ path: '/tmp/draw.war' })),
      drawio: { importWar: vi.fn(async () => ({ ok: true, status: installed })) }
    })
    await store.useDrawioStore.getState().importWar('选择离线包')
    expect(drawio.importWar).toHaveBeenCalledWith('/tmp/draw.war')
    expect(store.useDrawioStore.getState().mode).toBe('offline')
    expect(localStorage.getItem(MODE_KEY)).toBe('offline')
  })

  it('导入失败 → error 里是 main 的原因', async () => {
    const { store } = await boot({
      pickFile: vi.fn(async () => ({ path: '/tmp/坏.war' })),
      drawio: {
        importWar: vi.fn(async () => ({ ok: false, status: missing, message: '不是 draw.io 资源包' }))
      }
    })
    await store.useDrawioStore.getState().importWar('选择离线包')
    expect(store.useDrawioStore.getState().phase).toBe('error')
    expect(store.useDrawioStore.getState().error).toBe('不是 draw.io 资源包')
  })
})

describe('main 推送的状态', () => {
  it('只订阅一次,状态事件覆盖 status', async () => {
    let listener: ((event: DrawioStatusEvent) => void) | null = null
    const { store, drawio } = await boot({
      drawio: {
        status: vi.fn(async () => missing),
        onStatus: vi.fn((cb: (event: DrawioStatusEvent) => void) => {
          listener = cb
          return () => {}
        })
      }
    })
    await store.useDrawioStore.getState().ensureStatus()
    await store.useDrawioStore.getState().ensureStatus()
    expect(drawio.onStatus).toHaveBeenCalledTimes(1)
    expect(listener).not.toBeNull()
    listener!({ status: installed })
    expect(store.useDrawioStore.getState().status).toEqual(installed)
  })

  it('下载中才接受进度,结束后的迟到进度不会把进度条写回来', async () => {
    let listener: ((event: DrawioStatusEvent) => void) | null = null
    const { store } = await boot({
      drawio: {
        status: vi.fn(async () => missing),
        onStatus: vi.fn((cb: (event: DrawioStatusEvent) => void) => {
          listener = cb
          return () => {}
        })
      }
    })
    await store.useDrawioStore.getState().ensureStatus()
    listener!({
      status: { ...missing, downloading: true },
      progress: { phase: 'download', received: 5, total: 10 }
    })
    expect(store.useDrawioStore.getState().progress).toBeNull()

    store.useDrawioStore.setState({ phase: 'downloading' })
    listener!({
      status: { ...missing, downloading: true },
      progress: { phase: 'verify', received: 10, total: 10 }
    })
    expect(store.useDrawioStore.getState().progress).toEqual({
      phase: 'verify',
      received: 10,
      total: 10
    })
  })
})
