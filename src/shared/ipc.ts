// IPC 通道常量与负载类型(main ↔ preload ↔ renderer 契约,防字符串漂移)

import type { CronJob } from './models'
import type { CronScope, DockerContainer, PortService } from './models'
import type { LauncherSettings } from './settings'

// ── invoke 通道 ──
export const IPC = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsReset: 'settings:reset',
  appInfo: 'app:info',
  openExternal: 'shell:openExternal',
  agentsBadge: 'agents:badgeCount',
  // ── Launch Agents(阶段 1) ──
  agList: 'agents:list',
  agToggle: 'agents:toggle',
  agBrewAction: 'agents:brewAction',
  agCreateDraft: 'agents:createDraft',
  agSave: 'agents:save',
  agRemove: 'agents:remove',
  agClone: 'agents:clone',
  agOps: 'agents:ops',
  agReadForm: 'agents:readForm',
  agReadXml: 'agents:readXml',
  agSaveXml: 'agents:saveXml',
  agReadStatus: 'agents:readStatus',
  agReadLogs: 'agents:readLogs',
  agClearLogs: 'agents:clearLogs',
  agValidateXml: 'agents:validateXml',
  agRemoveInvalid: 'agents:removeInvalid',
  appCheckUpdates: 'app:checkUpdates',
  // ── 定时任务(阶段 2) ──
  cronList: 'cron:list',
  cronCreate: 'cron:create',
  cronUpdate: 'cron:update',
  cronRemove: 'cron:remove',
  cronReadLog: 'cron:readLog',
  cronWriteHeader: 'cron:writeHeader',
  // ── 端口服务(阶段 3) ──
  svcList: 'services:list',
  svcKill: 'services:kill',
  svcRestart: 'services:restart',
  svcContainerAction: 'services:containerAction',
  svcSetPolling: 'services:setPolling',
  svcSetActive: 'services:setActive'
} as const

// ── main → renderer 推送事件(preload onEvent 白名单) ──
export const IPC_EVENTS = {
  settingsChanged: 'settings:changed',
  agentsDirChanged: 'agents:dirChanged',
  servicesUpdated: 'services:updated'
} as const

export type IpcEventChannel = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]

export interface AppInfo {
  arch: string
  platform: string
  version: string
  isPackaged: boolean
}

// agents:dirChanged 负载(launchd 目录 fs.watch 去抖命中)
export interface AgentsDirChangedPayload {
  dirs: string[]
}

export interface LatestRelease {
  tagName: string
  version: string
  htmlUrl: string
  name: string | null
}

// app:checkUpdates 结果(四态:最新/有新版本/仓库无 Release/请求失败)
export interface UpdateCheckResult {
  status: 'upToDate' | 'available' | 'noRelease' | 'error'
  currentVersion: string
  latest: LatestRelease | null
  errorMessage: string | null
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
  polling: boolean
  scannedAt: number
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
