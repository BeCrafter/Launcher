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
  /** 上次用过的模型 id:无内置模型目录的协议(OpenAI 兼容)做「上次用过」快捷填入 */
  lastModel?: string
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
  /** 当前模型 id(自定义端点连到哪家未知,故是自由字符串而非枚举) */
  aiModelId: string
  /** 按协议各存各的端点,切卡不互相覆盖 */
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
  aiModelId: 'claude-opus-5',
  aiProviders: {
    anthropic: { baseUrl: 'https://api.anthropic.com' },
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
const AI_BASE_URL_MAX = 400

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

/** 模型 id:trim + 截断;空串回默认(端点连到哪家未知,但其值本身仍是自由字符串) */
function normalizeModelId(v: unknown): string {
  if (typeof v !== 'string') return DEFAULT_SETTINGS.aiModelId
  const s = v.trim().slice(0, AI_MODEL_ID_MAX)
  return s === '' ? DEFAULT_SETTINGS.aiModelId : s
}

/** 单条协议配置:非对象回默认端点;baseUrl 空串回默认(端点不能为空,否则请求必失败) */
function aiProviderConfigOr(v: unknown, fallback: AiProviderConfig): AiProviderConfig {
  const o = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const base = typeof o.baseUrl === 'string' ? o.baseUrl.trim().slice(0, AI_BASE_URL_MAX) : ''
  const out: AiProviderConfig = { baseUrl: base === '' ? fallback.baseUrl : base }
  const last = typeof o.lastModel === 'string' ? o.lastModel.trim().slice(0, AI_MODEL_ID_MAX) : ''
  if (last !== '') out.lastModel = last
  return out
}

/** 按固定两条协议逐键取值 —— 不遍历入参键名(未知键丢弃,形状恒定) */
export function normalizeAiProviders(v: unknown): AiProvidersConfig {
  const o = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const d = DEFAULT_SETTINGS.aiProviders
  return {
    anthropic: aiProviderConfigOr(o.anthropic, d.anthropic),
    'openai-compatible': aiProviderConfigOr(o['openai-compatible'], d['openai-compatible'])
  }
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
    serviceOverrides: normalizeServiceOverrides(r.serviceOverrides),
    // AI 引擎
    aiProviderId: enumOr(r.aiProviderId, AI_PROVIDER_VALUES, d.aiProviderId),
    aiModelId: normalizeModelId(r.aiModelId),
    aiProviders: normalizeAiProviders(r.aiProviders),
    aiToolCallLimit: enumNumberOr(r.aiToolCallLimit, AI_TOOL_ROUNDS_VALUES, d.aiToolCallLimit),
    aiStream: boolOr(r.aiStream, d.aiStream),
    aiRequestTimeout: enumNumberOr(r.aiRequestTimeout, AI_TIMEOUT_VALUES, d.aiRequestTimeout),
    mcpPermission: enumOr(r.mcpPermission, MCP_PERMISSION_VALUES, d.mcpPermission)
  }
}
