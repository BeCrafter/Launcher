// 领域模型类型(纯类型,无逻辑;与 demo MOCK_DATA 结构一一对应)
// 形状来源:docs/demo/js/data.js(迁移基线见 docs/design/demo-react-migration-map.md)

export type AgentStatus = 'running' | 'loaded' | 'stopped'
export type AgentScope = 'user' | 'system' | 'daemon'

export interface Agent {
  id: string
  label: string
  desc: string
  status: AgentStatus
  pid: number | null
  uptime: string | null
  scope: AgentScope
  tags: string[]
  program: string
  exitCode: number | null
  restarts: number
  isBrew?: boolean
}

export interface InvalidPlist {
  path: string
  reason: string
}

export interface CronJob {
  id: string
  user: string
  expr: string
  cmd: string
  desc: string
  enabled: boolean
  log?: boolean
  system?: boolean
}

export type ServiceStatus = 'running'

// 端口服务(lsof -iTCP -sTCP:LISTEN 关键列;type 由分类管线推导,不落数据)
export interface PortService {
  id: string
  port: number
  name: string
  pid: number
  command: string
  user: string
  cmd: string
  status: ServiceStatus
  addr: string
  proto: string
  uptime: string
}

export type SvcType = 'brew' | 'node' | 'process'

export type LogType = 'info' | 'ok' | 'warn' | 'err' | ''

export interface LogLine {
  ts: string
  type: LogType
  text: string
}

export interface CronPreset {
  labelKey: string
  expr: string
  descKey: string
}

// ── 抽屉编辑器表单 ──

export interface DrawerTriggers {
  runAtLoad: boolean
  keepAlive: boolean
  watchPaths: boolean
  startCalendarInterval: boolean
  startInterval: number
}

export type KeepAliveMode = 'bool' | 'dict'

export interface KeepAliveDict {
  crashed: boolean
  afterInitialDemand: boolean
  successfulExit: boolean
}

export type SciEntry = Partial<Record<'Minute' | 'Hour' | 'Day' | 'Weekday' | 'Month', number>>

export interface AgentForm {
  label: string
  desc: string
  processType: string
  program: string
  args: string[]
  workingDir: string
  nice: number
  throttleInterval: number
  env: Record<string, string>
  triggers: DrawerTriggers
  keepAliveMode: KeepAliveMode
  keepAliveDict: KeepAliveDict
  watchPaths: string[]
  sciEntries: SciEntry[]
  stdout: string
  stderr: string
}

export interface OpsState {
  loaded: boolean
  enabled: boolean
  running: boolean
}

export interface DrawerStatusModel {
  state: AgentStatus
  pid: number | null
  uptime: string | null
  cpu: string
  cpuWidth: string
  mem: string
  memWidth: string
  exitCode: number | null
  restarts: number
  startTime: string
  plistPath: string
  workDir: string
  scope: string
}

export interface AppMeta {
  versionFull: string
  footerVersion: string
}

export interface AppUrls {
  github: string
  help: string
}
