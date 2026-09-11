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
  /** launchctl print-disabled 显示为 disabled(开源 isDisabledByOverride:橙点 + enable 修复) */
  isDisabledByOverride?: boolean
}

export interface InvalidPlist {
  path: string
  reason: string
}

export type CronScope = 'user' | 'system'

export interface CronJob {
  id: string
  user: string
  expr: string
  cmd: string
  desc: string
  enabled: boolean
  log?: boolean
  system?: boolean
  /** @reboot/@daily 等特殊入口(vixie cron) */
  special?: boolean
  /** log=true 时的日志文件绝对路径(后端填充;解析时由包裹行推导) */
  logPath?: string
}

/** 单个 crontab 作用域的元信息 */
export interface CronScopeData {
  /** 文件头部原文(首个任务前的注释/env 块) */
  headerRaw: string
  /** 文件是否存在(用户 crontab 为空 / /etc/crontab 不存在 → false) */
  exists: boolean
}

export interface CronListPayload {
  jobs: CronJob[]
  headers: { user: CronScopeData; system: CronScopeData }
}

export type ServiceStatus = 'running' | 'exited'

// 端口服务(lsof -iTCP -sTCP:LISTEN 解析 + ps 补全;type/kind/evidence 由分类管线填充)
export interface PortService {
  id: string
  port: number
  name: string
  /** docker 容器条目无宿主 pid */
  pid?: number
  command: string
  user: string
  cmd: string
  status: ServiceStatus
  addr: string
  proto: string
  uptime: string
  type?: SvcType
  kind?: SvcKind
  evidence?: string
  /** 存在即 docker 容器条目(操作走 docker start/stop/restart) */
  containerId?: string
}

export interface DockerContainer {
  id: string
  containerId: string
  name: string
  image: string
  status: 'running' | 'exited'
  /** docker ps Status 原文(如 "Up 3 hours" / "Exited (0) 2 days ago") */
  statusText: string
  portsRaw: string
}

export type SvcType = 'brew' | 'node' | 'process' | 'docker'

export type SvcKind = 'brew' | 'node' | 'python' | 'php' | 'jvm' | 'ruby' | 'docker' | 'dev' | 'process'

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

export interface AppUrls {
  github: string
  help: string
}
