// IPC 通道常量与负载类型(main ↔ preload ↔ renderer 契约,防字符串漂移)

import type { AgentScope, CronJob } from './models'
import type { CronScope, DockerContainer, DockerUnavailableReason, PortService } from './models'
import type { LauncherSettings } from './settings'
import type { AiApprovalDecision, AiMention } from './ai'

// ── invoke 通道 ──
export const IPC = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsReset: 'settings:reset',
  appInfo: 'app:info',
  openExternal: 'shell:openExternal',
  shellPickFile: 'shell:pickFile',
  shellSaveText: 'shell:saveText',
  shellRevealLog: 'agents:revealLog',
  agentsBadge: 'agents:badgeCount',
  // ── Launch Agents(阶段 1) ──
  agList: 'agents:list',
  agBrewAction: 'agents:brewAction',
  agCreateDraft: 'agents:createDraft',
  agSaveForm: 'agents:saveForm',
  agRename: 'agents:rename',
  agRemove: 'agents:remove',
  agClone: 'agents:clone',
  agOps: 'agents:ops',
  agReadDocument: 'agents:readDocument',
  agSaveXml: 'agents:saveXml',
  agReadStatus: 'agents:readStatus',
  agReadLogs: 'agents:readLogs',
  agClearLogs: 'agents:clearLogs',
  agValidateXml: 'agents:validateXml',
  agCheckMissing: 'agents:checkMissing',
  appCheckUpdates: 'app:checkUpdates',
  // ── 定时任务(阶段 2) ──
  cronList: 'cron:list',
  cronCreate: 'cron:create',
  cronUpdate: 'cron:update',
  cronRemove: 'cron:remove',
  cronReadLog: 'cron:readLog',
  cronListLogs: 'cron:listLogs',
  cronDeleteLog: 'cron:deleteLog',
  cronCleanupLogs: 'cron:cleanupLogs',
  cronWriteHeader: 'cron:writeHeader',
  // ── 端口服务(阶段 3) ──
  svcList: 'services:list',
  svcKill: 'services:kill',
  svcRestart: 'services:restart',
  svcContainerAction: 'services:containerAction',
  svcSetPolling: 'services:setPolling',
  svcSetActive: 'services:setActive',
  // ── AI 助手(阶段 4) ──
  aiGetState: 'ai:getState',
  aiSetKey: 'ai:setKey',
  aiClearKey: 'ai:clearKey',
  aiRevealKey: 'ai:revealKey',
  aiTestConnection: 'ai:testConnection',
  aiListSessions: 'ai:listSessions',
  aiCreateSession: 'ai:createSession',
  aiDeleteSession: 'ai:deleteSession',
  aiGetMessages: 'ai:getMessages',
  aiSend: 'ai:send',
  aiAbort: 'ai:abort',
  aiRespondApproval: 'ai:respondApproval',
  aiSkills: 'ai:skills',
  aiInstallMcpLink: 'ai:installMcpLink',
  aiCatalog: 'ai:catalog',
  aiMcpInfo: 'ai:mcpInfo'
} as const

// ── main → renderer 推送事件(preload onEvent 白名单) ──
export const IPC_EVENTS = {
  settingsChanged: 'settings:changed',
  agentsDirChanged: 'agents:dirChanged',
  servicesUpdated: 'services:updated',
  /** AI 运行事件流(AiRunEvent;高频,只在会话运行期间推送) */
  aiRunEvent: 'ai:runEvent'
} as const

export type IpcEventChannel = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]

export interface AppInfo {
  arch: string
  platform: string
  version: string
  isPackaged: boolean
  /** 探测到的安装来源(brew/npm/manual)——决定「检查更新」给哪条升级命令 */
  installChannel: InstallChannel
}

// agents:dirChanged 负载(launchd 目录 fs.watch 去抖命中)
export interface AgentsDirChangedPayload {
  dirs: string[]
}

/** 安装来源:三条通道 + 探测不出来的兜底(详见 main/services/install-channel.ts) */
export type InstallChannel = 'brew' | 'npm' | 'manual'

/**
 * 各通道的升级命令 —— 界面直接展示给用户照抄。
 * ⚠ 与另两处是同一套入口,改通道文档/地址时一起改:
 *   packaging/homebrew/README.md、packaging/npm/README.md、scripts/install.sh 的 usage。
 *   （`dev` 是当前默认分支;合并回 main 后这里要跟着改,否则 curl 通道拉到的是别的分支）
 */
export const UPGRADE_COMMAND: Record<InstallChannel, string> = {
  brew: 'brew upgrade --cask becrafter/brew/launcher',
  npm: 'npx -y @becrafter/launcher',
  manual: 'curl -fsSL https://raw.githubusercontent.com/BeCrafter/Launcher/dev/scripts/install.sh | bash'
}

export interface LatestVersionInfo {
  version: string
  /** 清单里的最新稳定版(全是预发布时为 null) */
  stable: string | null
}

// app:checkUpdates 结果(四态:最新/有新版本/尚未发版/请求失败)
export interface UpdateCheckResult {
  status: 'upToDate' | 'available' | 'noRelease' | 'error'
  currentVersion: string
  latest: LatestVersionInfo | null
  /** 判定所用的安装来源(界面据此挑升级文案;**从结果里取,不要反推命令字符串**) */
  installChannel: InstallChannel
  /** 该通道对应的升级命令(界面照抄给用户) */
  upgradeCommand: string
  /** 失败原因(HTTP 码 / 请求超时 / 网络错误);成功为 null */
  errorMessage: string | null
}

// ── 原生对话框负载(渲染层只传意图,路径选择由系统对话框完成) ──

export type PickFileMode = 'executable' | 'plist'

export interface PickedFile {
  path: string
  /** plist 模式返回文件内容(≤1MB);executable 模式为 null */
  content: string | null
}

// ── Launch Agents 负载 ──

/** 「已加载但 plist 已不存在」的孤儿服务(定向复核结果) */
export interface MissingAgent {
  label: string
  scope: AgentScope
  path: string | null
  pid: number | null
}

// ── 定时任务负载 ──

/** cron:update 结果;stale=true 表示原 id 失配,按命令降级匹配成功(外部改动过文件) */
export interface CronUpdateResult {
  job: CronJob
  stale: boolean
}

// ── 端口服务负载 ──

export interface ServicesListPayload {
  services: PortService[]
  brewServices: string[]
  containers: DockerContainer[]
  dockerAvailable: boolean
  /** dockerAvailable 为 false 时的原因(UI 据此区分「未装 CLI」/「daemon 未运行」/「超时」) */
  dockerReason: DockerUnavailableReason | null
  polling: boolean
  scannedAt: number
  /**
   * 本轮扫描的失败原因(非空 ⇒ 这份 services 是**上次成功的结果**,不是当前真相)。
   * 不带上它,「扫描挂了」与「真的没有监听端口」在 UI 上完全同形 —— 之前正是因此把整张表
   * 静默清空并显示成「共 0 个端口服务」。
   */
  error: string | null
}

export type KillOutcome = 'ok' | 'alreadyGone' | 'denied' | 'notFound' | 'timeout'

export interface RestartOutcome {
  ok: boolean
  newPid: number | null
  error: string | null
}

export type ContainerAction = 'start' | 'stop' | 'restart'

// 提权失败/取消的稳定错误码:经 IPC 错误消息透传,renderer 以 includes 判定
// (Electron invoke 的错误跨进程只剩 message,故用固定前缀而非 Error 子类)
export const ELEVATION_CANCELLED = 'ELEVATION_CANCELLED'
export const ELEVATION_FAILED = 'ELEVATION_FAILED'

// settings:set 的合法 patch(部分键)
export type SettingsPatch = Partial<LauncherSettings>

// ── AI 助手负载(阶段 4) ──

/** ai:send 的入参 */
export interface AiSendInput {
  sessionId: string
  text: string
  mentions?: AiMention[]
  /** 技能 id(欢迎态技能卡进入时带;决定注入的任务段与工具白名单) */
  skillId?: string
}

/** ai:testConnection 结果 */
export interface AiTestResult {
  ok: boolean
  message: string
}

/** ai:respondApproval 入参 */
export interface AiApprovalInput {
  runId: string
  toolCallId: string
  decision: AiApprovalDecision
}

/** PATH 上 launcher-mcp 链接的状态 */
export type McpLinkState =
  /** 指向**本应用**的脚本,可直接用短命令 */
  | 'linked'
  /** PATH 上找不到 */
  | 'missing'
  /** 找到了但目标不存在(应用被移动/删除过) */
  | 'dangling'
  /** 指向另一个 Launcher 副本 */
  | 'foreign'

export interface AiMcpLink {
  state: McpLinkState
  /** 在 PATH 上命中的路径;missing 时为 null */
  foundAt: string | null
  /** 期望指向的目标(本应用包内脚本) */
  expected: string
}

/** ai:mcpInfo —— 接入弹窗的两条用法(权限模式读设置里的 mcpPermission) */
export interface AiMcpInfo {
  /**
   * 命令行挂载要运行的**命令本身**(链接可用时是 `launcher-mcp`,否则是完整路径)。
   * 刻意不是 `claude mcp add ...` —— 那是某一家客户端的配置语法,不是命令;
   * 各家客户端(gui 配置 / 其他 CLI)要的都是"跑什么",那部分才是通用的。
   */
  stdioCommand: string
  httpUrl: string
  /** HTTP 端点是否在监听(需应用在跑) */
  httpRunning: boolean
  /** 命令名(展示用,如 launcher-mcp) */
  binName: string
  /** PATH 上那条链接的真实状态 —— 命令给短形式还是完整路径就以此为准 */
  link: AiMcpLink
}
