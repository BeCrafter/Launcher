// 数据接缝:视图/store 只依赖此接口,后端阶段将 data/index.ts 换成 ipcDataSource() 即可
// 全部方法返回 Promise;mock 实现立即 resolve(不加人为延迟,保持 demo 同步交互节奏)

import type {
  Agent,
  AgentForm,
  CronJob,
  DrawerStatusModel,
  InvalidPlist,
  LogLine,
  OpsState,
  PortService
} from '@shared/models'

export type OpAction = 'load' | 'enable' | 'kickstart'
export type AgentScope = 'user' | 'system' | 'daemon'
export type AgentFilter = 'all' | 'brew' | 'user' | 'system' | 'daemon'
export type CronFilter = 'all' | 'user' | 'system'
export type SvcFilter = 'all' | 'brew' | 'node' | 'process'

export interface AgentRepository {
  list(): Promise<{ agents: Agent[]; invalidPlists: InvalidPlist[] }>
  // demo toggleAgent:running → bootout 停止;否则 bootstrap 启动(返回新状态)
  toggle(id: string): Promise<Agent>
  brewAction(kind: 'start' | 'stop', id: string): Promise<Agent>
  // 草稿:以给定 label 新建未加载条目并插入列表顶(demo openAgentDraft;label 去重在调用方完成)
  createDraft(scope: AgentScope, label: string): Promise<Agent>
  save(id: string, patch: Partial<AgentForm> & { label: string; desc: string }): Promise<Agent>
  remove(id: string): Promise<void>
  clone(id: string): Promise<Agent>
  // 抽屉 ops 模拟状态机(demo drawerOpsAction)
  ops(id: string, action: OpAction): Promise<OpsState>
  // 阶段 1 前:全部卡片共用 MOCK_DATA.drawer 的表单/状态/原料(demo populateDrawerDefaults 行为)
  readForm(id: string): Promise<AgentForm>
  readStatus(id: string): Promise<DrawerStatusModel>
}

export interface CronRepository {
  list(): Promise<CronJob[]>
  create(job: CronJob): Promise<CronJob>
  update(id: string, patch: Partial<CronJob>): Promise<CronJob>
  remove(id: string): Promise<void>
  // demo cronLogLines:按任务的 log 路径构造近 3 天日志
  readLog(id: string): Promise<LogLine[]>
}

export interface ServiceRepository {
  list(): Promise<{ services: PortService[]; brewServices: string[] }>
  kill(id: string): Promise<void>
}

export interface LogStream {
  subscribe(handler: (line: LogLine) => void): () => void
}

export interface DataSource {
  agents: AgentRepository
  crons: CronRepository
  services: ServiceRepository
  logs: LogStream
}
