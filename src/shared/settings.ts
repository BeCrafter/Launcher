// LauncherSettings:设置持久化 schema 单一事实来源(main/renderer/测试共用)
// 物理路径:${HOME}/.config/launcher/config.json(见 src/main/settings/store.ts)
// 键名承接 demo localStorage(launcherTheme → theme 等),映射关系见 docs/design/demo-react-migration-map.md

export type ThemeMode = 'system' | 'light' | 'dark'
export type Language = 'zh-CN' | 'en-US'
export type XmlIndent = '2' | '4' | 'tab'

export interface LauncherSettings {
  theme: ThemeMode
  language: Language
  sidebarCollapsed: boolean
  launchAtLogin: boolean
  menubarOnly: boolean
  trayVisible: boolean
  dockVisible: boolean
  menubarBadge: boolean
  fseventsActive: boolean
  cmdTimeout: number
  cronLogRetainDays: number
  labelPrefix: string
  xmlIndent: XmlIndent
  authCacheMin: number
  confirmDangerous: boolean
}

export const DEFAULT_SETTINGS: LauncherSettings = {
  theme: 'system',
  language: 'zh-CN',
  sidebarCollapsed: false,
  launchAtLogin: true,
  menubarOnly: true,
  trayVisible: true,
  dockVisible: true,
  menubarBadge: true,
  fseventsActive: true,
  cmdTimeout: 5000,
  cronLogRetainDays: 3,
  labelPrefix: 'com.user.',
  xmlIndent: '2',
  authCacheMin: 5,
  confirmDangerous: true
}

const THEME_VALUES: ThemeMode[] = ['system', 'light', 'dark']
const LANGUAGE_VALUES: Language[] = ['zh-CN', 'en-US']
const XML_INDENT_VALUES: XmlIndent[] = ['2', '4', 'tab']
const CMD_TIMEOUT_VALUES = [3000, 5000, 10000]
const CRON_RETAIN_VALUES = [1, 3, 7, 14]
const AUTH_CACHE_VALUES = [0, 5, 15]

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function enumOr<T extends string>(v: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback
}

function enumNumberOr(v: unknown, allowed: number[], fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return allowed.includes(n) ? n : fallback
}

// 未知键丢弃、枚举白名单纠正、类型错误回默认;input 缺失/损坏时整体安全
export function normalizeSettings(raw: unknown): LauncherSettings {
  const r = (raw ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  return {
    theme: enumOr(r.theme, THEME_VALUES, d.theme),
    language: enumOr(r.language, LANGUAGE_VALUES, d.language),
    sidebarCollapsed: boolOr(r.sidebarCollapsed, d.sidebarCollapsed),
    launchAtLogin: boolOr(r.launchAtLogin, d.launchAtLogin),
    menubarOnly: boolOr(r.menubarOnly, d.menubarOnly),
    trayVisible: boolOr(r.trayVisible, d.trayVisible),
    dockVisible: boolOr(r.dockVisible, d.dockVisible),
    menubarBadge: boolOr(r.menubarBadge, d.menubarBadge),
    fseventsActive: boolOr(r.fseventsActive, d.fseventsActive),
    cmdTimeout: enumNumberOr(r.cmdTimeout, CMD_TIMEOUT_VALUES, d.cmdTimeout),
    cronLogRetainDays: enumNumberOr(r.cronLogRetainDays, CRON_RETAIN_VALUES, d.cronLogRetainDays),
    labelPrefix: typeof r.labelPrefix === 'string' && r.labelPrefix.length > 0 ? r.labelPrefix : d.labelPrefix,
    xmlIndent: enumOr(r.xmlIndent, XML_INDENT_VALUES, d.xmlIndent),
    authCacheMin: enumNumberOr(r.authCacheMin, AUTH_CACHE_VALUES, d.authCacheMin),
    confirmDangerous: boolOr(r.confirmDangerous, d.confirmDangerous)
  }
}
