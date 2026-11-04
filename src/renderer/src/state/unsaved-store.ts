// 渲染层临时编辑器(内联 crontab、服务覆写浮层等)的未保存状态汇总。
//
// 这些编辑值活在组件 useState 里,没有进入任何领域 store;升级自动重启无法像笔记/AI 那样
// 直接检查。组件用 useUnsavedEditor(key, dirty) 注册,update-store 只问 hasUnsaved()。
//
// key 使用稳定身份(如 cron:<id>),不要用数组下标;同一 key 重复注册按 false 清理,
// 组件卸载/取消编辑时必须注销,否则会永久挡住自动升级。

import { create } from 'zustand'

interface UnsavedState {
  /** 只记录有待保存内容的编辑器;false/不存在都表示没有 */
  editors: Record<string, true>
  setEditor(key: string, dirty: boolean): void
  hasUnsaved(): boolean
}

export const useUnsavedStore = create<UnsavedState>((set, get) => ({
  editors: {},

  setEditor(key, dirty) {
    const current = get().editors[key] === true
    if (current === dirty) return
    const next = { ...get().editors }
    if (dirty) next[key] = true
    else delete next[key]
    set({ editors: next })
  },

  hasUnsaved() {
    return Object.keys(get().editors).length > 0
  }
}))
