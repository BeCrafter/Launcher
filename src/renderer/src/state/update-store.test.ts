// 自动检查提示的会话内忽略:
//   · 点「稍后」只静音当前目标版本,不是全局关提醒;
//   · 用户主动检查时清掉忽略(他想知道最新情况);
//   · 从 ready 取消下载会回到 available —— 这是用户主动放弃,不该立刻再被问一遍。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@shared/ipc'
import { useUpdateStore } from './update-store'

function stateWith(phase: UpdateState['phase'], target: string | null): UpdateState {
  return {
    phase,
    currentVersion: '0.3.1',
    targetVersion: target,
    channel: 'npm',
    mode: 'self',
    progress: null,
    message: null,
    error: null,
    fallbackCommand: '',
    checkedAt: null,
    downloadSize: null,
    canCheck: true,
    canCancel: false,
    canApply: phase === 'ready'
  }
}

const updates = {
  check: vi.fn(),
  download: vi.fn(),
  cancel: vi.fn()
}

beforeEach(() => {
  updates.check.mockReset()
  updates.download.mockReset()
  updates.cancel.mockReset()
  ;(globalThis as unknown as { window: unknown }).window = { launcher: { updates } }
  useUpdateStore.setState({
    state: null,
    countdown: null,
    postponed: false,
    dirtyBlocked: false,
    dismissedVersion: null
  })
})

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window
})

describe('update-store 的自动检查提示', () => {
  it('「稍后」只记下当前目标版本', () => {
    useUpdateStore.setState({ state: stateWith('available', '0.4.0') })
    useUpdateStore.getState().dismissAvailable()
    expect(useUpdateStore.getState().dismissedVersion).toBe('0.4.0')

    // 新版本到来时忽略自然失效(横幅的条件比的是版本号)
    useUpdateStore.setState({ state: stateWith('available', '0.4.1') })
    expect(useUpdateStore.getState().dismissedVersion).toBe('0.4.0')
  })

  it('用户主动检查会清掉忽略', async () => {
    useUpdateStore.setState({ state: stateWith('available', '0.4.0'), dismissedVersion: '0.4.0' })
    updates.check.mockResolvedValue(stateWith('upToDate', '0.3.1'))

    await useUpdateStore.getState().check()

    expect(useUpdateStore.getState().dismissedVersion).toBeNull()
  })

  it('从 ready 取消下载后不再弹回同一个版本的提示', async () => {
    useUpdateStore.setState({ state: stateWith('ready', '0.4.0') })
    updates.cancel.mockResolvedValue(stateWith('available', '0.4.0'))

    await useUpdateStore.getState().cancel()

    expect(useUpdateStore.getState().state?.phase).toBe('available')
    expect(useUpdateStore.getState().dismissedVersion).toBe('0.4.0')
  })
})
