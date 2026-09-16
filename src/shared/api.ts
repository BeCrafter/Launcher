// 渲染层可用 API 契约(preload contextBridge 注入 window.launcher)

import type {
  AppInfo,
  ContainerAction,
  MissingAgent,
  PickedFile,
  PickFileMode,
  CronUpdateResult,
  IpcEventChannel,
  KillOutcome,
  RestartOutcome,
  ServicesListPayload,
  SettingsPatch,
  UpdateCheckResult
} from './ipc'
import type {
  Agent,
  AgentForm,
  AgentScope,
  CronJob,
  CronListPayload,
  CronLogFileInfo,
  CronScope,
  DrawerStatusModel,
  LogLine,
  OpsState
} from './models'
import type { LauncherSettings } from './settings'

export interface LauncherApi {
  appName: string
  versions: {
    electron: string
    node: string
    chrome: string
  }
  // 启动时由 main 经 additionalArguments 注入的首帧设置(免同步 IPC,无主题/语言闪烁)
  initialSettings: LauncherSettings
  getSettings: () => Promise<LauncherSettings>
  setSettings: (patch: SettingsPatch) => Promise<LauncherSettings>
  resetSettings: () => Promise<LauncherSettings>
  getAppInfo: () => Promise<AppInfo>
  openExternal: (url: string) => Promise<void>
  /** 原生文件选择:plist(含内容,用于导入)/ executable(仅路径,用于表单) */
  pickFile: (opts: { mode: PickFileMode; title?: string }) => Promise<PickedFile | null>
  /** 原生保存框 + 写文本(日志导出);取消 → null */
  saveTextFile: (opts: { suggestedName: string; content: string; title?: string }) => Promise<string | null>
  // 运行中 Agent 计数上报(menubarBadge 角标;数据在 renderer,阶段 1 换真实源后由 main 自算)
  reportBadgeCount: (count: number) => Promise<void>
  checkForUpdate: () => Promise<UpdateCheckResult>
  // Launch Agents(阶段 1:真实 launchctl/plist)
  agents: {
    list: () => Promise<{ agents: Agent[] }>
    brewAction: (kind: 'start' | 'stop', id: string) => Promise<Agent>
    createDraft: (scope: AgentScope, label: string) => Promise<Agent>
    save: (id: string, patch: Partial<AgentForm> & { label: string; desc: string }) => Promise<Agent>
    remove: (id: string) => Promise<void>
    clone: (id: string) => Promise<Agent>
    ops: (id: string, action: 'start' | 'stop' | 'restart' | 'enable' | 'disable') => Promise<OpsState>
    readForm: (id: string) => Promise<AgentForm>
    readXml: (id: string) => Promise<{ xml: string; formMode: boolean; unsupportedKeys: string[] }>
    saveXml: (id: string, xml: string) => Promise<void>
    readStatus: (id: string) => Promise<DrawerStatusModel>
    readLogs: (id: string, source: 'file' | 'system') => Promise<LogLine[]>
    clearLogs: (id: string) => Promise<void>
    validateXml: (xml: string) => Promise<{ ok: boolean; error: string | null }>
    /** 定向复核:这些(scope,label)对是否「仍被加载但 plist 已不存在」 */
    checkMissing: (candidates: { scope: AgentScope; label: string }[]) => Promise<MissingAgent[]>
    /** 在访达中显示该 agent 的日志文件;无文件 → null */
    revealLog: (id: string) => Promise<string | null>
  }
  // 定时任务(阶段 2:真实 crontab 读写)
  cron: {
    list: () => Promise<CronListPayload>
    create: (job: Omit<CronJob, 'id'>) => Promise<CronJob>
    update: (job: CronJob, patch: Partial<CronJob>) => Promise<CronUpdateResult>
    remove: (job: CronJob) => Promise<void>
    readLog: (id: string, name?: string) => Promise<LogLine[]>
    /** 该任务已有的日志文件(新 → 旧),供日志抽屉的文件列表 */
    listLogs: (id: string) => Promise<CronLogFileInfo[]>
    /** 删除单个日志文件(文件名须属于该任务;已不存在按成功处理) */
    deleteLog: (id: string, name: string) => Promise<void>
    /** 清理超过保留期的日志文件,返回删除数量 */
    cleanupLogs: () => Promise<number>
    writeHeader: (scope: CronScope, text: string) => Promise<void>
  }
  // 端口服务(阶段 3:真实进程发现/终止)
  services: {
    list: () => Promise<ServicesListPayload>
    kill: (id: string, opts?: { privileged?: boolean }) => Promise<KillOutcome>
    restart: (id: string) => Promise<RestartOutcome>
    containerAction: (id: string, action: ContainerAction) => Promise<void>
    setPolling: (enabled: boolean) => Promise<ServicesListPayload>
    setActive: (active: boolean) => Promise<void>
  }
  // main → renderer 推送订阅(白名单通道),返回退订函数
  onEvent: (channel: IpcEventChannel, cb: (payload: unknown) => void) => () => void
}
