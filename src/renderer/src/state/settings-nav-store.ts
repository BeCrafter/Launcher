// 设置页当前 tab 的共享状态:让设置页之外的入口(AI 页的引擎 chip / 引导卡「去配置」)
// 能把用户直接送到对应面板。放独立小 store 而不是塞进 ui-store:它只服务设置页内部导航,
// 与模块路由/浮层/toast 无关。
import { create } from 'zustand'

export type SettingsTabId = 'general' | 'launchd' | 'editor' | 'security' | 'about' | 'login' | 'ai'

interface SettingsNavState {
  tab: SettingsTabId
  setTab(tab: SettingsTabId): void
}

export const useSettingsNav = create<SettingsNavState>((set) => ({
  tab: 'general',
  setTab(tab) {
    set({ tab })
  }
}))
