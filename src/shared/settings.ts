// LauncherSettings:设置持久化 schema 单一事实来源(main/renderer/测试共用)
// 物理路径:${HOME}/.config/launcher/config.json(见 src/main/settings/store.ts)
// 键名承接 demo localStorage(launcherTheme → theme 等),映射关系见 docs/design/demo-react-migration-map.md

export type ThemeMode = 'system' | 'light' | 'dark'
export type Language = 'zh-CN' | 'en-US'
export type XmlIndent = '2' | '4' | 'tab'

/** 单个端口服务的用户覆写(应用新增;UI-only、可逆,不影响 main 的发现管线) */
export interface ServiceOverride {
  /** 自定义显示名;空 = 回退自动名 */
  alias?: string
  /** 可连接 host(裸主机名/IP,不带 scheme 与端口);空 = 由 svc.addr 推导 */
  host?: string
  /** 附加路径(空 = 无)。URL = http://{host}:{port}{path} */
  path?: string
}

// 上限:设置经 additionalArguments 注入每个新窗口 argv,且每次 save() 全量 normalize。
// 无上限时损坏文件可把 argv/广播撑大。最坏情形(CJK 3 字节/码元)≈143KB,约 macOS ARG_MAX 的 14%;
// 典型情形(别名 4 字、host 9 字符)≈12KB。
export const SERVICE_OVERRIDE_MAX_ENTRIES = 128
const OVERRIDE_FIELD_MAX = { alias: 40, host: 64, path: 160 } as const
const OVERRIDE_KEY_MAX = 96

export interface LauncherSettings {
  // ── 外观与语言 ──
  theme: ThemeMode
  language: Language
  // ── 窗口与形态 ──
  sidebarCollapsed: boolean
  launchAtLogin: boolean
  menubarOnly: boolean
  trayVisible: boolean
  dockVisible: boolean
  menubarBadge: boolean
  // ── launchd 引擎 ──
  fseventsActive: boolean
  cmdTimeout: number
  cronLogRetainDays: number
  // ── 编辑器 ──
  labelPrefix: string
  xmlIndent: XmlIndent
  // ── 安全 ──
  authCacheMin: number
  confirmDangerous: boolean
  // ── 端口服务覆写 ──
  /** identityKey → ServiceOverride(键规则见 renderer lib/svc-override.ts) */
  serviceOverrides: Record<string, ServiceOverride>
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
  confirmDangerous: true,
  // ⚠ schema 里唯一的引用型默认值:normalizeServiceOverrides 始终返回新对象,
  //   切勿写成 `r.serviceOverrides ?? d.serviceOverrides`(会把同一对象发给所有调用方)
  serviceOverrides: {}
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

/** 单条覆写:非对象回 null;三字段各自 trim + 截断;全空条目丢弃(避免记录无限增长) */
function overrideOr(v: unknown): ServiceOverride | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const out: ServiceOverride = {}
  for (const k of ['alias', 'host', 'path'] as const) {
    const raw = o[k]
    if (typeof raw !== 'string') continue
    const s = raw.trim().slice(0, OVERRIDE_FIELD_MAX[k])
    if (s !== '') out[k] = s
  }
  return out.alias || out.host || out.path ? out : null
}

export function normalizeServiceOverrides(v: unknown): Record<string, ServiceOverride> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
  const out: Record<string, ServiceOverride> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (Object.keys(out).length >= SERVICE_OVERRIDE_MAX_ENTRIES) break
    // ⚠ 必须显式跳过:JSON.parse 会把 "__proto__" 造为自有属性,而 out[k] = … 走的是
    // Object.prototype 的 __proto__ setter → 会改写 out 的原型而非写入条目(原型污染)
    if (k === '__proto__' || k.length === 0 || k.length > OVERRIDE_KEY_MAX) continue
    const o = overrideOr(val)
    if (o) out[k] = o
  }
  return out
}

// 未知键丢弃、枚举白名单纠正、类型错误回默认;input 缺失/损坏时整体安全
export function normalizeSettings(raw: unknown): LauncherSettings {
  const r = (raw ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  return {
    // 外观与语言
    theme: enumOr(r.theme, THEME_VALUES, d.theme),
    language: enumOr(r.language, LANGUAGE_VALUES, d.language),
    // 窗口与形态
    sidebarCollapsed: boolOr(r.sidebarCollapsed, d.sidebarCollapsed),
    launchAtLogin: boolOr(r.launchAtLogin, d.launchAtLogin),
    menubarOnly: boolOr(r.menubarOnly, d.menubarOnly),
    trayVisible: boolOr(r.trayVisible, d.trayVisible),
    dockVisible: boolOr(r.dockVisible, d.dockVisible),
    menubarBadge: boolOr(r.menubarBadge, d.menubarBadge),
    // launchd 引擎
    fseventsActive: boolOr(r.fseventsActive, d.fseventsActive),
    cmdTimeout: enumNumberOr(r.cmdTimeout, CMD_TIMEOUT_VALUES, d.cmdTimeout),
    cronLogRetainDays: enumNumberOr(r.cronLogRetainDays, CRON_RETAIN_VALUES, d.cronLogRetainDays),
    // 编辑器
    labelPrefix: typeof r.labelPrefix === 'string' && r.labelPrefix.length > 0 ? r.labelPrefix : d.labelPrefix,
    xmlIndent: enumOr(r.xmlIndent, XML_INDENT_VALUES, d.xmlIndent),
    // 安全
    authCacheMin: enumNumberOr(r.authCacheMin, AUTH_CACHE_VALUES, d.authCacheMin),
    confirmDangerous: boolOr(r.confirmDangerous, d.confirmDangerous),
    // 端口服务覆写
    serviceOverrides: normalizeServiceOverrides(r.serviceOverrides)
  }
}
