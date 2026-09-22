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

/** 接入协议 = pi 的线协议适配器(阶段 4 只接两条:anthropic-messages / openai-completions) */
export type AiProviderId = 'anthropic' | 'openai-compatible'

/** MCP 权限模式:只暴露只读工具 / 兼暴露写工具(仅约束 HTTP 环回连接,见 docs/design/ai-message-model-gap.md) */
export type McpPermission = 'readOnly' | 'full'

/**
 * 单个接入协议的配置。
 * ⚠ API Key **不在这里** —— 它由 main 进程 safeStorage 加密后另存(见 main/ai/secret-store.ts),
 * 设置文件是明文 JSON,不得落 Key。
 */
export interface AiProviderConfig {
  /** 服务端点(官方地址 / 代理网关 / 本地服务均可) */
  baseUrl: string
  /**
   * 该协议使用的模型 id。
   * ⚠ **必须按协议各存各的**:此前是全局单值,切到另一个协议再切回来就丢了
   * (端点一直是按协议存的,模型却只有一个全局槽位 —— 两者不对称就是那个 bug)。
   */
  modelId?: string
  /** 最近用过的模型 id(新的在前,最多 {@link RECENT_MODEL_MAX} 个),用作快捷填入 */
  recentModels?: string[]
  /**
   * 附加到每次模型请求上的自定义请求头(键值对)。
   * 存在的理由:不少企业网关/反代会按客户端标识放行 —— 例如要求 `User-Agent` 必须是某个 CLI,
   * 否则一律 403(实测某企业 Claude 网关就是如此)。没有这个口子,这类端点根本用不了。
   */
  headers?: Record<string, string>
}

export interface AiProvidersConfig {
  anthropic: AiProviderConfig
  'openai-compatible': AiProviderConfig
}

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
  // ── AI 引擎 ──
  /** 当前接入协议 */
  aiProviderId: AiProviderId
  /** 按协议各存各的端点与模型(切协议互不覆盖) */
  aiProviders: AiProvidersConfig
  /** 单次回答内最多连续调用多少次领域工具 */
  aiToolCallLimit: number
  /** 逐字显示生成结果;关闭后整段一次性显示 */
  aiStream: boolean
  /** 单次模型请求等待上限(秒) */
  aiRequestTimeout: number
  /** MCP 外部访问权限模式 */
  mcpPermission: McpPermission
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
  serviceOverrides: {},
  // AI 引擎(默认端点取 pi 目录里的官方地址;Key 未配置 → 进入未配置引导态)
  aiProviderId: 'anthropic',
  aiProviders: {
    // Anthropic 有内置目录,给一个默认可直接跑;OpenAI 兼容连到哪家未知,留空由用户自己填
    anthropic: {
      baseUrl: 'https://api.anthropic.com',
      modelId: 'claude-opus-5',
      recentModels: ['claude-opus-5']
    },
    'openai-compatible': { baseUrl: 'https://api.openai.com/v1' }
  },
  aiToolCallLimit: 8,
  aiStream: true,
  aiRequestTimeout: 60,
  mcpPermission: 'readOnly'
}

const THEME_VALUES: ThemeMode[] = ['system', 'light', 'dark']
const LANGUAGE_VALUES: Language[] = ['zh-CN', 'en-US']
const XML_INDENT_VALUES: XmlIndent[] = ['2', '4', 'tab']
const CMD_TIMEOUT_VALUES = [3000, 5000, 10000]
const CRON_RETAIN_VALUES = [1, 3, 7, 14]
const AUTH_CACHE_VALUES = [0, 5, 15]
const AI_PROVIDER_VALUES: AiProviderId[] = ['anthropic', 'openai-compatible']
const AI_TOOL_ROUNDS_VALUES = [4, 8, 16]
const AI_TIMEOUT_VALUES = [30, 60, 120]
const MCP_PERMISSION_VALUES: McpPermission[] = ['readOnly', 'full']
/** 模型 id 上限:防损坏文件塞进超长串(正常模型 id 数十字符) */
const AI_MODEL_ID_MAX = 200
/** 快捷填入最多留几个模型:再多会把这一行撑爆(demo 原本列整个目录,用户要求收敛到最近 3 个) */
export const RECENT_MODEL_MAX = 3
const AI_BASE_URL_MAX = 400
/** 自定义请求头上限:键值都会进请求,不设界时损坏文件能塞进任意大的串 */
export const HEADER_MAX_ENTRIES = 16
const HEADER_NAME_MAX = 64
const HEADER_VALUE_MAX = 400

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

/** 模型 id:trim + 截断(自由字符串 —— 自定义端点连到哪家未知) */
function modelIdOr(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, AI_MODEL_ID_MAX) : ''
}

/** 自定义请求头:同 serviceOverrides 的守卫(丢 __proto__、逐键截断、空值丢弃) */
export function normalizeHeaders(v: unknown): Record<string, string> | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined
  const out: Record<string, string> = {}
  for (const [rawK, rawV] of Object.entries(v as Record<string, unknown>)) {
    if (Object.keys(out).length >= HEADER_MAX_ENTRIES) break
    if (rawK === '__proto__') continue
    if (typeof rawV !== 'string') continue
    const k = rawK.trim().slice(0, HEADER_NAME_MAX)
    const val = rawV.trim().slice(0, HEADER_VALUE_MAX)
    if (k === '' || val === '') continue
    out[k] = val
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 单条协议配置:非对象回默认端点;baseUrl 空串回默认(端点不能为空,否则请求必失败)。
 * `legacyModelId` 只给「当前生效的那个协议」,用于把老配置里的全局 aiModelId 迁移过来。
 */
function aiProviderConfigOr(v: unknown, fallback: AiProviderConfig, legacyModelId: string): AiProviderConfig {
  const o = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const base = typeof o.baseUrl === 'string' ? o.baseUrl.trim().slice(0, AI_BASE_URL_MAX) : ''
  const out: AiProviderConfig = { baseUrl: base === '' ? fallback.baseUrl : base }

  const own = modelIdOr(o.modelId)
  const model = own !== '' ? own : legacyModelId !== '' ? legacyModelId : (fallback.modelId ?? '')
  if (model !== '') out.modelId = model

  const recents = Array.isArray(o.recentModels) ? o.recentModels : []
  const list: string[] = []
  for (const r of recents) {
    const id = modelIdOr(r)
    if (id === '' || list.includes(id)) continue
    list.push(id)
    if (list.length >= RECENT_MODEL_MAX) break
  }
  // 当前模型保证在列表里:chip 行就是「最近用过的模型」,当前那个以 active 态呈现
  // (否则在用满 3 个时,用户只看得到 2 颗,与「显示最近 3 个」的预期不符)
  if (model !== '' && !list.includes(model)) list.unshift(model)
  if (list.length > 0) out.recentModels = list.slice(0, RECENT_MODEL_MAX)

  const headers = normalizeHeaders(o.headers)
  if (headers) out.headers = headers
  return out
}

/**
 * 按固定两条协议逐键取值 —— 不遍历入参键名(未知键丢弃,形状恒定)。
 * `legacyModelId` 是老配置(RECENT_MODEL_MAX 之前的全局 aiModelId)的迁移入口,
 * 只落到当前生效的协议上;没有它就说明是新配置,各协议用各自的默认模型。
 */
export function normalizeAiProviders(
  v: unknown,
  activeProviderId: AiProviderId,
  legacyModelId = ''
): AiProvidersConfig {
  const o = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const d = DEFAULT_SETTINGS.aiProviders
  const legacyFor = (id: AiProviderId): string => (id === activeProviderId ? legacyModelId : '')
  return {
    anthropic: aiProviderConfigOr(o.anthropic, d.anthropic, legacyFor('anthropic')),
    'openai-compatible': aiProviderConfigOr(
      o['openai-compatible'],
      d['openai-compatible'],
      legacyFor('openai-compatible')
    )
  }
}

// 未知键丢弃、枚举白名单纠正、类型错误回默认;input 缺失/损坏时整体安全
export function normalizeSettings(raw: unknown): LauncherSettings {
  const r = (raw ?? {}) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  // 先定协议,再解析协议配置:老配置的全局 aiModelId 只迁给「当时生效的那个协议」
  const activeAiProviderId = enumOr(r.aiProviderId, AI_PROVIDER_VALUES, d.aiProviderId)
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
    serviceOverrides: normalizeServiceOverrides(r.serviceOverrides),
    // AI 引擎(模型按协议各存各的;老配置的全局 aiModelId 迁移给当时生效的协议)
    aiProviderId: activeAiProviderId,
    aiProviders: normalizeAiProviders(r.aiProviders, activeAiProviderId, modelIdOr(r.aiModelId)),
    aiToolCallLimit: enumNumberOr(r.aiToolCallLimit, AI_TOOL_ROUNDS_VALUES, d.aiToolCallLimit),
    aiStream: boolOr(r.aiStream, d.aiStream),
    aiRequestTimeout: enumNumberOr(r.aiRequestTimeout, AI_TIMEOUT_VALUES, d.aiRequestTimeout),
    mcpPermission: enumOr(r.mcpPermission, MCP_PERMISSION_VALUES, d.mcpPermission)
  }
}
