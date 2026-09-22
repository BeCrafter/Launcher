// 数据接缝:视图/store 只依赖此接口,后端实现见 data/ipc/*(data/index.ts 组合)
// 全部方法返回 Promise;mock 实现立即 resolve(不加人为延迟,保持 demo 同步交互节奏)

import type {
  Agent,
  AgentDocument,
  CloneInput,
  CronJob,
  CronListPayload,
  CronLogFileInfo,
  CronScope,
  DrawerStatusModel,
  LogLine,
  OpsState,
  PortService,
  RenameInput,
  SaveFormInput,
  SaveOutcome,
  SaveXmlInput
} from '@shared/models'
import type { MissingAgent } from '@shared/ipc'
import type {
  ContainerAction,
  CronUpdateResult,
  KillOutcome,
  RestartOutcome,
  ServicesListPayload,
  AiApprovalInput,
  AiMcpInfo,
  AiSendInput,
  AiTestResult
} from '@shared/ipc'
import type { AiEngineState, AiMessage, AiRunEvent, AiSession, AiSkillInfo } from '@shared/ai'
import type { AiProviderId } from '@shared/settings'

/** 意图动作(用户语义):顺序逻辑在 main 内部完成 */
export type OpAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable'
export type AgentScope = 'user' | 'system' | 'daemon'
export type AgentFilter = 'all' | 'brew' | 'user' | 'system' | 'daemon'
/** 运行状态筛选(与类型筛选叠加;'all' = 不限) */
export type AgentStatusFilter = 'all' | 'running' | 'loaded' | 'stopped'
export type CronFilter = 'all' | 'user' | 'system'
export type SvcFilter = 'all' | 'brew' | 'node' | 'process' | 'docker'

export interface AgentRepository {
  list(): Promise<{ agents: Agent[] }>
  brewAction(kind: 'start' | 'stop', id: string): Promise<Agent>
  // 草稿:以给定 label 新建未加载条目并插入列表顶(demo openAgentDraft;label 去重在调用方完成)
  createDraft(scope: AgentScope, label: string): Promise<Agent>
  /** 文档读取(表单 + 原文 + 兼容报告 + revision) */
  readDocument(id: string): Promise<AgentDocument>
  saveForm(input: SaveFormInput): Promise<SaveOutcome>
  saveXml(input: SaveXmlInput): Promise<SaveOutcome>
  renameAgent(input: RenameInput): Promise<SaveOutcome>
  remove(id: string, expectedRevision: string): Promise<SaveOutcome>
  clone(input: CloneInput): Promise<SaveOutcome>
  // 意图动作(启动/停止/重启/开机自启/立即执行一次)
  ops(id: string, action: OpAction): Promise<OpsState>
  // 阶段 1 起:per-agent launchctl 真实数据
  readStatus(id: string): Promise<DrawerStatusModel>
  readLogs(id: string, source: 'file' | 'system'): Promise<LogLine[]>
  clearLogs(id: string): Promise<{ cleared: string[]; failed: { path: string; error: string }[] }>
  validateXml(xml: string): Promise<{ ok: boolean; error: string | null }>
  /** 定向复核:候选条目是否「仍被加载但 plist 已不存在」 */
  checkMissing(candidates: { scope: AgentScope; label: string }[]): Promise<MissingAgent[]>
}

export interface CronRepository {
  list(): Promise<CronListPayload>
  /** id 由后端按内容推导(scope|expr|cmd 哈希),调用方不传 */
  create(job: Omit<CronJob, 'id'>): Promise<CronJob>
  /** stale=true 表示原 id 失配、按命令降级匹配成功(外部改动过文件) */
  update(job: CronJob, patch: Partial<CronJob>): Promise<CronUpdateResult>
  remove(job: CronJob): Promise<void>
  /** 读取**单个**日志文件的尾部(上限 2000 行 / 256KB);name 省略 → 最新非空段 */
  readLog(id: string, name?: string): Promise<LogLine[]>
  /** 该任务已有的日志文件(新 → 旧),供日志抽屉的文件列表 */
  listLogs(id: string): Promise<CronLogFileInfo[]>
  /** 删除单个日志文件(文件名须属于该任务;已不存在按成功处理) */
  deleteLog(id: string, name: string): Promise<void>
  /** 清理超过保留期的日志文件,返回删除数量 */
  cleanupLogs(): Promise<number>
  /** 覆写指定作用域 crontab 的文件头(首个任务前的注释/env 块原文) */
  writeHeader(scope: CronScope, text: string): Promise<void>
}

export interface ServiceRepository {
  list(): Promise<ServicesListPayload>
  /** privileged=true 时经 osascript 管理员提权(他人进程) */
  kill(id: string, opts?: { privileged?: boolean }): Promise<KillOutcome>
  /** privileged=true 时经 osascript 提权终止他人进程(重新拉起仍以当前用户身份) */
  restart(id: string, opts?: { privileged?: boolean }): Promise<RestartOutcome>
  containerAction(id: string, action: ContainerAction): Promise<void>
  /** 监听状态开关(会话语义,不落配置) */
  setPolling(enabled: boolean): Promise<ServicesListPayload>
  /** 页面激活时开启 3s 轮询,离开停止(resource 友好) */
  setActive(active: boolean): Promise<void>
}

export interface DataSource {
  agents: AgentRepository
  crons: CronRepository
  services: ServiceRepository
  ai: AiRepository
}

/**
 * AI 仓储(阶段 4:pi 引擎在 main,renderer 只发意图 + 订阅事件流)。
 * Key 的读写只传明文进不出:setKey 单向送入 main,safeStorage 加密后存;状态里只有 hasKey 布尔。
 */
export interface AiRepository {
  getState(): Promise<AiEngineState>
  setKey(providerId: AiProviderId, apiKey: string): Promise<AiEngineState>
  clearKey(providerId: AiProviderId): Promise<AiEngineState>
  /** 读回已存的明文 Key(仅设置页用来显示;不参与引擎态) */
  revealKey(providerId: AiProviderId): Promise<string>
  testConnection(providerId: AiProviderId): Promise<AiTestResult>
  listSessions(): Promise<AiSession[]>
  createSession(): Promise<AiSession>
  deleteSession(id: string): Promise<void>
  getMessages(sessionId: string): Promise<AiMessage[]>
  send(input: AiSendInput): Promise<void>
  abort(): Promise<void>
  respondApproval(input: AiApprovalInput): Promise<void>
  skills(): Promise<AiSkillInfo[]>
  /** 该协议的模型目录(仅内置目录的协议非空) */
  catalog(providerId: AiProviderId): Promise<{ id: string; name: string }[]>
  mcpInfo(): Promise<AiMcpInfo>
  /** 安装/修复 PATH 上的 launcher-mcp 链接(用户显式点击);error 非空时带回原因 */
  installMcpLink(): Promise<{ info: AiMcpInfo; error: string | null }>
  /** 运行事件订阅(返回退订函数) */
  onRunEvent(cb: (e: AiRunEvent) => void): () => void
}
