// 设置 store:renderer 侧缓存 + 乐观更新;持久化经 IPC 到 ~/.config/launcher/config.json
// 副作用:body.light-theme(对齐 demo setTheme/loadSettings 语义)、documentElement.lang、t() 语言镜像

import { create } from 'zustand'
import type { LauncherSettings } from '@shared/settings'
import { IPC_EVENTS } from '@shared/ipc'
import { setRuntimeLang } from '../i18n'

interface SettingsState {
  settings: LauncherSettings | null // bootstrap 前 null
  set(patch: Partial<LauncherSettings>): void
  reset(): void
  applyFromMain(s: LauncherSettings): void
}

function applyThemeSideEffects(s: LauncherSettings): void {
  // demo setTheme 三态语义:light → 加类;dark → 移类;system → 跟随 prefers-color-scheme
  if (s.theme === 'light') {
    document.body.classList.add('light-theme')
  } else if (s.theme === 'dark') {
    document.body.classList.remove('light-theme')
  } else {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    document.body.classList.toggle('light-theme', !prefersDark)
  }
}

function applyAllSideEffects(s: LauncherSettings): void {
  applyThemeSideEffects(s)
  setRuntimeLang(s.language)
  document.documentElement.lang = s.language
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,

  set(patch) {
    const current = get().settings
    if (!current) return
    const next = { ...current, ...patch }
    set({ settings: next })
    applyAllSideEffects(next)
    // 乐观:本地即时生效,持久化异步(失败仅打日志;schema 在 main 侧 normalize 兜底)
    void window.launcher.setSettings(patch).catch((err) => console.error('[settings] 持久化失败', err))
  },

  reset() {
    void window.launcher
      .resetSettings()
      .then((s) => {
        set({ settings: s })
        applyAllSideEffects(s)
      })
      .catch((err) => console.error('[settings] 重置失败', err))
  },

  applyFromMain(s) {
    set({ settings: s })
    applyAllSideEffects(s)
  }
}))

// bootstrap:用注入的首帧设置立即生效(无闪烁),再订阅 main 推送
export function initSettingsFromMain(): void {
  const store = useSettingsStore
  store.getState().applyFromMain(window.launcher.initialSettings)
  window.launcher.onEvent(IPC_EVENTS.settingsChanged, (payload) => {
    if (payload) store.getState().applyFromMain(payload as LauncherSettings)
  })
  // system 主题下跟随系统外观变化(demo 行为:setTheme('system') 时 matchMedia 决定类名)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const s = store.getState().settings
    if (s && s.theme === 'system') applyThemeSideEffects(s)
  })
}
