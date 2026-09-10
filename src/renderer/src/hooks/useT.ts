// useT:订阅设置语言的 t() 绑定(语言切换 → 全树重渲染,等价 demo applyLanguage 全量重绘)
import { useMemo } from 'react'
import { fmt, makeT } from '../i18n'
import { useSettingsStore } from '../state/settings-store'

export function useT(): (key: string) => string {
  const lang = useSettingsStore((s) => s.settings?.language ?? 'zh-CN')
  return useMemo(() => makeT(lang), [lang])
}

export function useFmt(): (tpl: string, vars: Record<string, string | number>) => string {
  return useMemo(() => fmt, [])
}

