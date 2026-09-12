// 数据接缝:视图/store 只依赖此接口,后端实现见 data/ipc/*(data/index.ts 组合)
// 全部方法返回 Promise;mock 实现立即 resolve(不加人为延迟,保持 demo 同步交互节奏)

import type {
  Agent,
  AgentForm,
  CronJob,
  CronListPayload,
  CronScope,
  DrawerStatusModel,
  InvalidPlist,
  LogLine,
  OpsState,
  PortService
} from '@shared/models'
import type { MissingAgent } from '@shared/ipc'
import type {
  ContainerAction,
  CronUpdateResult,
  KillOutcome,
  RestartOutcome,
  ServicesListPayload
} from '@shared/ipc'

/** 意图动作(用户语义):顺序逻辑在 main 内部完成 */
export type OpAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable'
export type AgentScope = 'user' | 'system' | 'daemon'
export type AgentFilter = 'all' | 'brew' | 'user' | 'system' | 'daemon'
export type CronFilter = 'all' | 'user' | 'system'
export type SvcFilter = 'all' | 'brew' | 'node' | 'process' | 'docker'

export interface AgentRepository {
  list(): Promise<{ agents: Agent[]; invalidPlists: InvalidPlist[] }>
  brewAction(kind: 'start' | 'stop', id: string): Promise<Agent>
  // 草稿:以给定 label 新建未加载条目并插入列表顶(demo openAgentDraft;label 去重在调用方完成)
  createDraft(scope: AgentScope, label: string): Promise<Agent>
  save(id: string, patch: Partial<AgentForm> & { label: string; desc: string }): Promise<Agent>
  remove(id: string): Promise<void>
  clone(id: string): Promise<Agent>
  // 意图动作(启动/停止/重启/开机自启/立即执行一次)
  ops(id: string, action: OpAction): Promise<OpsState>
  // 阶段 1 起:per-agent plist/launchctl 真实数据
  readForm(id: string): Promise<AgentForm>
  readStatus(id: string): Promise<DrawerStatusModel>
  readXml(id: string): Promise<{ xml: string; formMode: boolean; unsupportedKeys: string[] }>
  saveXml(id: string, xml: string): Promise<void>
  readLogs(id: string, source: 'file' | 'system'): Promise<LogLine[]>
  clearLogs(id: string): Promise<void>
  validateXml(xml: string): Promise<{ ok: boolean; error: string | null }>
  /** 删除无效 plist 文件(横幅删除按钮) */
  removeInvalid(path: string): Promise<void>
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
  /** 读取任务日志文件尾(上限 2000 行 / 256KB) */
  readLog(id: string): Promise<LogLine[]>
  /** 覆写指定作用域 crontab 的文件头(首个任务前的注释/env 块原文) */
  writeHeader(scope: CronScope, text: string): Promise<void>
}

export interface ServiceRepository {
  list(): Promise<ServicesListPayload>
  /** privileged=true 时经 osascript 管理员提权(他人进程) */
  kill(id: string, opts?: { privileged?: boolean }): Promise<KillOutcome>
  restart(id: string): Promise<RestartOutcome>
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
}
