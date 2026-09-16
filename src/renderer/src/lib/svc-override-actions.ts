// 端口服务覆写的唯一写入口(卡片双击改名与「配置」浮层共用)
// 乐观写:settings store 本地即时生效 → IPC 持久化 → main 广播回灌
import { SERVICE_OVERRIDE_MAX_ENTRIES } from '@shared/settings'
import type { ServiceOverride } from '@shared/settings'
import { useSettingsStore } from '../state/settings-store'
import { showToast } from './utils'
import { t } from '../i18n'

/**
 * 合并写一条覆写;全空条目自动删除(保持记录紧凑,与上游 setCustomName(nil) 同语义)。
 * ⚠ 必须基于整条 record 展开后再写:main 的 save() 对该键是浅合并,只发单条会抹掉其余全部覆写。
 * @returns false = 新条目会超出上限,未写入
 */
export function applyServiceOverride(key: string, patch: Partial<ServiceOverride>): boolean {
  const store = useSettingsStore.getState()
  const cur = store.settings?.serviceOverrides ?? {}
  if (cur[key] === undefined && Object.keys(cur).length >= SERVICE_OVERRIDE_MAX_ENTRIES) return false

  const next = { ...cur, [key]: { ...cur[key], ...patch } }
  const entry = next[key]
  if (!entry.alias && !entry.host && !entry.path) delete next[key]

  store.set({ serviceOverrides: next })
  return true
}

/** 用户可见入口:超限时明确提示,不让写入静默失效 */
export function saveServiceOverride(key: string, patch: Partial<ServiceOverride>): void {
  if (!applyServiceOverride(key, patch)) {
    showToast(t('svc.overrideLimit'), '#f87171', 'fa-circle-exclamation')
  }
}
