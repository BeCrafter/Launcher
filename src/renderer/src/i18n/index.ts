// i18n 运行时:t()/fmt() 语义与 demo i18n.js 一致(t 缺键回退键名;fmt {X} 占位替换)
// 字典由 scripts/port-demo-i18n.mjs 生成,勿手改。
import { zhCN } from './dict.zh-CN'
import { enUS } from './dict.en-US'
import type { Language } from '@shared/settings'

// GENERATED 字典自带类型;此处收窄为通用查表
const DICTS: Record<Language, Record<string, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS
}

// 模块级当前语言镜像:纯函数 lib(lib/cron 等)与测试可直接 t(),与 demo 行为一致
let currentLang: Language = 'zh-CN'

export function getCurrentLang(): Language {
  return currentLang
}

export function setRuntimeLang(lang: Language): void {
  currentLang = lang
}

export function makeT(lang: Language): (key: string) => string {
  return (key: string) => DICTS[lang][key] ?? key
}

export function t(key: string): string {
  return makeT(currentLang)(key)
}

export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}
