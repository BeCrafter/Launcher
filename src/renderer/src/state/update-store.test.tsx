// 更新 store 的自动重启边界:
// - ready → 倒计时 → 真正调用 apply
// - 笔记 / AI / Agent 抽屉 / 内联编辑有未保存内容时暂停,清理后恢复
// - 窗口不可见时不自动退出
//
// update-store 有模块级 initialized/tickTimer,因此每个用例用 resetModules 拿一份全新的
// store 模块;setup 里的 window.launcher 桩会在用例内重新安装。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@shared/ipc'
import { installLauncherStub, mockLauncher } from '../test/launcher-stub'
import { makeUpdateState } from '../test/fixtures'

type Modules = {
  useUpdateStore: typeof import('./update-store')['useUpdateStore']
  useNotesStore: typeof import('./notes-store')['useNotesStore']
  useAiStore: typeof import('./ai-store')['useAiStore']
  useDrawerStore: typeof import('./drawer-store')['useDrawerStore']
  useUnsavedStore: typeof import('./unsaved-store')['useUnsavedStore']
}

async function boot(
  state: UpdateState,
  seed?: (m: Modules) => void
): Promise<Modules> {
  vi.resetModules()
  const [update, notes, ai, drawer, unsaved] = await Promise.all([
    import('./update-store'),
    import('./notes-store'),
    import('./ai-store'),
    import('./drawer-store'),
    import('./unsaved-store')
  ])
  const modules: Modules = {
    useUpdateStore: update.useUpdateStore,
    useNotesStore: notes.useNotesStore,
    useAiStore: ai.useAiStore,
    useDrawerStore: drawer.useDrawerStore,
    useUnsavedStore: unsaved.useUnsavedStore
  }

  installLauncherStub({
    updates: {
      getState: vi.fn(async () => state)
    }
  })
  seed?.(modules)
  modules.useUpdateStore.getState().init()
  // init() 的 getState/consumeResult 都是 promise;让微任务跑完再断言
  await vi.advanceTimersByTimeAsync(0)
  return modules
}

const readyState = (): UpdateState =>
  makeUpdateState({
    phase: 'ready',
    targetVersion: '0.3.0',
    canCheck: false,
    canApply: true,
    canCancel: true
  })

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  // 有的用例会改写 visibilityState;jsdom 的 document 在同一文件内复用
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible'
  })
})

describe('自动重启倒计时', () => {
  it('ready 后从 10 秒倒数,到点调用 main 的 apply', async () => {
    const { useUpdateStore } = await boot(readyState())
    expect(useUpdateStore.getState().countdown).toBe(10)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(useUpdateStore.getState().countdown).toBeNull()
    expect(mockLauncher().updates.apply).toHaveBeenCalledTimes(1)
  })

  it('窗口不可见时暂停,重新可见后继续倒数', async () => {
    let visibility: DocumentVisibilityState = 'hidden'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility
    })
    const { useUpdateStore } = await boot(readyState())
    expect(useUpdateStore.getState().countdown).toBe(10)

    await vi.advanceTimersByTimeAsync(5000)
    expect(useUpdateStore.getState().countdown).toBe(10)
    expect(mockLauncher().updates.apply).not.toHaveBeenCalled()

    visibility = 'visible'
    await vi.advanceTimersByTimeAsync(1000)
    expect(useUpdateStore.getState().countdown).toBe(9)
  })
})

describe('未保存内容保护', () => {
  it('AI 草稿存在时不启动倒计时,草稿清空后恢复', async () => {
    const { useUpdateStore, useAiStore } = await boot(readyState(), (m) => {
      m.useAiStore.setState({ composerHasDraft: true })
    })
    expect(useUpdateStore.getState().countdown).toBeNull()
    expect(useUpdateStore.getState().dirtyBlocked).toBe(true)

    useAiStore.setState({ composerHasDraft: false })
    expect(useUpdateStore.getState().countdown).toBe(10)
  })

  it('Agent 抽屉有脏表单时暂停,关闭抽屉后恢复', async () => {
    const { useUpdateStore, useDrawerStore } = await boot(readyState(), (m) => {
      m.useDrawerStore.setState({ open: true, dirtyFields: ['label'] })
    })
    expect(useUpdateStore.getState().countdown).toBeNull()
    expect(useUpdateStore.getState().dirtyBlocked).toBe(true)

    useDrawerStore.setState({ open: false })
    expect(useUpdateStore.getState().countdown).toBe(10)
  })

  it('内联编辑器(如 crontab)注册草稿时暂停,注销后恢复', async () => {
    const { useUpdateStore, useUnsavedStore } = await boot(readyState(), (m) => {
      m.useUnsavedStore.getState().setEditor('cron:job-1', true)
    })
    expect(useUpdateStore.getState().countdown).toBeNull()
    expect(useUpdateStore.getState().dirtyBlocked).toBe(true)

    useUnsavedStore.getState().setEditor('cron:job-1', false)
    expect(useUpdateStore.getState().countdown).toBe(10)
  })

  it('手动 apply 也会被内联草稿拦住,不调用 IPC', async () => {
    const { useUpdateStore, useUnsavedStore } = await boot(readyState(), (m) => {
      m.useUnsavedStore.getState().setEditor('cron:job-1', true)
    })
    await useUpdateStore.getState().apply()
    expect(mockLauncher().updates.apply).not.toHaveBeenCalled()
    expect(useUpdateStore.getState().dirtyBlocked).toBe(true)
    expect(useUnsavedStore.getState().hasUnsaved()).toBe(true)
  })
})
