// 渲染层全局状态的按用例重置。
//
// Zustand 5 的 getInitialState() 返回 create() 时那份快照;setState(snapshot, true)
// 连状态带 action 一起恢复,比手写 reset 对象更不容易漏字段。
//
// 模块级状态(eventInited / toastTimer / initialized / booted / elevation 请求)不在
// store 里,这里只处理能处理的;其余在 docs/testing.md 里列为「不要调用 init()」的约束。

import type { LauncherSettings } from '@shared/settings'
import { normalizeSettings } from '@shared/settings'
import { setRuntimeLang } from '../i18n'
import {
  ELEVATION,
  confirmDangerous,
  setAuthCacheMinGetter,
  setConfirmDangerousGetter
} from '../lib/elevation'
import { useAgentsStore } from '../state/agents-store'
import { useAiStore } from '../state/ai-store'
import { useCardMenuStore } from '../state/card-menu-store'
import { useCronStore } from '../state/cron-store'
import { useDrawerStore } from '../state/drawer-store'
import { useLightboxStore } from '../state/lightbox-store'
import { useNoteRefPickerStore } from '../state/note-ref-picker-store'
import { useNotesStore } from '../state/notes-store'
import { useServicesStore } from '../state/services-store'
import { useSettingsNav } from '../state/settings-nav-store'
import { useSettingsStore } from '../state/settings-store'
import { useSvcConfigStore } from '../state/svc-config-store'
import { useUiStore } from '../state/ui-store'
import { useUnsavedStore } from '../state/unsaved-store'
import { useUpdateStore } from '../state/update-store'

interface ResettableStore<T> {
  getInitialState: () => T
  setState: (state: T | ((state: T) => T), replace: true) => void
}

function resetStore<T>(store: ResettableStore<T>): void {
  store.setState(store.getInitialState(), true)
}

export function resetRendererStores(): void {
  resetStore(useAiStore)
  resetStore(useSettingsStore) // settings 回到 null;useT() 会回退 zh-CN
  resetStore(useUiStore)
  resetStore(useSettingsNav)
  resetStore(useAgentsStore)
  resetStore(useCronStore)
  resetStore(useServicesStore)
  resetStore(useNotesStore)
  resetStore(useUpdateStore)
  resetStore(useUnsavedStore)
  resetStore(useDrawerStore)
  resetStore(useSvcConfigStore)
  resetStore(useCardMenuStore)
  resetStore(useNoteRefPickerStore)
  resetStore(useLightboxStore)

  setRuntimeLang('zh-CN')
  document.documentElement.lang = 'zh-CN'
  document.body.className = ''

  // 上一个用例可能停在授权/危险确认的 Promise 上;必须先 resolve,否则它永远挂着
  setAuthCacheMinGetter(() => 5)
  setConfirmDangerousGetter(() => true)
  confirmDangerous.cancel()
  ELEVATION.cancel()

  localStorage.clear()
  sessionStorage.clear()
}

/** 让设置立即生效(语言/主题/DOM),但不经过 IPC;英文用例用它 */
export function setTestSettings(raw: Record<string, unknown> = {}): LauncherSettings {
  const current = useSettingsStore.getState().settings
  const next = normalizeSettings({ ...(current ?? {}), ...raw })
  useSettingsStore.getState().applyFromMain(next)
  return next
}
