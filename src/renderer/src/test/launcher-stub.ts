// window.launcher 的测试桩。
//
// 原则:
//   · 只给「组件真正会调用」的方法显式默认值,其余由 Proxy 兜底并**同步抛错**,
//     错误信息带完整路径 —— 比 `undefined is not a function` 好定位。
//   · 每次 installLauncherStub() 都重建整个对象与订阅表;dataSource() 缓存的
//     repository 实例内部才读 window.launcher,所以每个用例换桩是安全的。
//   · 方法都是 vi.fn,测试可直接断言调用参数。

import { vi, type Mock } from 'vitest'
import type { LauncherApi } from '@shared/api'
import type { IpcEventChannel } from '@shared/ipc'
import type { LauncherSettings } from '@shared/settings'
import { normalizeSettings } from '@shared/settings'
import { makeEngineState, makeSession, makeUpdateState } from './fixtures'

export type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? Mock<(...args: A) => R>
    : T[K] extends object
      ? Mocked<T[K]>
      : T[K]
}

export type MockedLauncherApi = Mocked<LauncherApi>

type AnyMethod = (...args: never[]) => unknown

type DomainOverrides = {
  [K in keyof LauncherApi]?: LauncherApi[K] extends AnyMethod
    ? LauncherApi[K]
    : LauncherApi[K] extends object
      ? Partial<LauncherApi[K]>
      : LauncherApi[K]
}

export type LauncherStubOptions = DomainOverrides & {
  /** 同时作为 initialSettings / getSettings / setSettings 的基线 */
  settings?: Partial<LauncherSettings>
  initialSettings?: Partial<LauncherSettings>
}

/** 这些键在 LauncherApi 里是对象域,统一包一层 Proxy 兜底 */
const DOMAIN_KEYS = ['updates', 'agents', 'cron', 'services', 'ai', 'notes'] as const

type EventHandler = (payload: unknown) => void

let subscriptions = new Map<IpcEventChannel, Set<EventHandler>>()

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 未桩定的成员:返回一个抛错函数;symbol / then 透传,避免 await / 序列化异常 */
function withThrowingFallback<T extends object>(target: T, path: string): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === 'symbol' || prop === 'then') {
        return Reflect.get(obj, prop, receiver)
      }
      if (prop in obj) return Reflect.get(obj, prop, receiver)
      return vi.fn(() => {
        throw new Error(`[test] ${path}.${String(prop)} 未桩定 —— 请在 installLauncherStub() 中提供`)
      })
    }
  })
}

export function installLauncherStub(options: LauncherStubOptions = {}): MockedLauncherApi {
  const { settings, initialSettings, ...domainOverrides } = options
  const seed = normalizeSettings({ ...initialSettings, ...settings })

  subscriptions = new Map()
  const onEvent = vi.fn((channel: IpcEventChannel, cb: EventHandler): (() => void) => {
    const set = subscriptions.get(channel) ?? new Set<EventHandler>()
    set.add(cb)
    subscriptions.set(channel, set)
    return () => {
      set.delete(cb)
    }
  })

  // 与真实 IPC 一致:getSettings 每次给一份副本,set/reset 会改变后续读数。
  // 共用同一个对象会让「测试里改返回值」意外污染后面的断言。
  let currentSettings = structuredClone(seed)
  const snapshot = (): LauncherSettings => structuredClone(currentSettings)

  const base: Record<string, unknown> = {
    appName: 'Launcher',
    versions: { electron: '44.0.0', node: '24.0.0', chrome: '140.0.0' },
    initialSettings: structuredClone(seed),
    getSettings: vi.fn(async () => snapshot()),
    setSettings: vi.fn(async (patch: Partial<LauncherSettings>) => {
      currentSettings = normalizeSettings({ ...currentSettings, ...patch })
      return snapshot()
    }),
    resetSettings: vi.fn(async () => {
      currentSettings = normalizeSettings({})
      return snapshot()
    }),
    getAppInfo: vi.fn(async () => ({
      arch: 'arm64',
      platform: 'darwin',
      version: '0.2.2',
      isPackaged: false,
      installChannel: 'manual'
    })),
    openExternal: vi.fn(async () => undefined),
    pickFile: vi.fn(async () => null),
    saveTextFile: vi.fn(async () => null),
    reportBadgeCount: vi.fn(async () => undefined),
    notifyBootPainted: vi.fn(),
    onEvent,
    updates: {
      getState: vi.fn(async () => makeUpdateState()),
      check: vi.fn(async () => makeUpdateState()),
      download: vi.fn(async () => makeUpdateState()),
      apply: vi.fn(async () => makeUpdateState()),
      cancel: vi.fn(async () => makeUpdateState()),
      consumeResult: vi.fn(async () => null),
      revealLog: vi.fn(async () => null)
    },
    ai: {
      getState: vi.fn(async () => makeEngineState()),
      revealKey: vi.fn(async () => ''),
      setKey: vi.fn(async () => makeEngineState()),
      clearKey: vi.fn(async () => makeEngineState({ hasKey: false, configured: false })),
      testConnection: vi.fn(async () => ({ ok: true, message: 'ok' })),
      listSessions: vi.fn(async () => []),
      createSession: vi.fn(async () => makeSession()),
      deleteSession: vi.fn(async () => undefined),
      getMessages: vi.fn(async () => []),
      send: vi.fn(async () => undefined),
      retract: vi.fn(async () => ({ text: '' })),
      branch: vi.fn(async () => makeSession({ id: 's-branch' })),
      abort: vi.fn(async () => undefined),
      // 默认 false:respondApproval 在 await 之后不会再写 store,避免 act 警告
      respondApproval: vi.fn(async () => ({ autoApprove: false })),
      setAutoApprove: vi.fn(async () => ({ autoApprove: false })),
      skills: vi.fn(async () => []),
      catalog: vi.fn(async () => [])
    },
    notes: { search: vi.fn(async () => []) }
  }

  // 一层深合并:覆盖 ai.respondApproval 不会把 ai 其它默认值整块丢掉。
  for (const [key, value] of Object.entries(domainOverrides)) {
    if (value === undefined) continue
    const current = base[key]
    base[key] =
      isPlainObject(current) && isPlainObject(value) ? { ...current, ...value } : value
  }

  for (const key of DOMAIN_KEYS) {
    base[key] = withThrowingFallback((base[key] as object | undefined) ?? {}, `window.launcher.${key}`)
  }
  const launcher = withThrowingFallback(base, 'window.launcher') as unknown as MockedLauncherApi

  Object.defineProperty(window, 'launcher', {
    configurable: true,
    writable: true,
    value: launcher
  })
  return launcher
}

/** 当前已注入的桩(便于断言 mock 调用) */
export function mockLauncher(): MockedLauncherApi {
  return window.launcher as unknown as MockedLauncherApi
}

/** 驱动 onEvent 订阅者(后续 IPC 事件测试用) */
export function emitLauncherEvent(channel: IpcEventChannel, payload?: unknown): void {
  for (const cb of subscriptions.get(channel) ?? []) cb(payload)
}
