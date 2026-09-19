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
  /**
   * 文件存在但不是可操作的 launchd 任务(plist 未定义 Label,如 Google keystone 的空 <dict/> 占位)。
   * 列表内置灰、不可启停/克隆,但可编辑(补上 Label 即成为真正的任务)与删除。
   * 这类行的 label 为空,身份与展示名都用 fileName。
   */
  isNotTask?: boolean
  /** plist 无法解析(损坏/不可读)的原因;有此值时同样置灰,编辑走 XML 修复 */
  parseError?: string
  /** 非任务文件的原文件名(仅 isNotTask 时填充;label 为空时作展示名与身份) */
  fileName?: string
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
  /** 该任务在 crontab 中的命令含**未转义的 %**(cron 会截断命令 → 静默失败);后端解析时填充,供 UI 告警/一键修复 */
  percentUnescaped?: boolean
  /** 日志重定向为「日期模板」形式(每小时一段):实际文件需按 id 扫目录解析,故 logPath 由后端填充 */
  logTemplate?: boolean
  /** 已产生的**按小时分段**文件数(不含迁移前的历史单文件);由后端 list() 扫描填充,供 UI 显示「共 N 段」 */
  segmentCount?: number
}

/** 一个日志文件(分段或迁移前的历史单文件);供日志抽屉的文件列表 */
export interface CronLogFileInfo {
  /** 文件名(如 5ca5a5f7-2026091622.log) */
  name: string
  size: number
  mtimeMs: number
  /** 迁移前的整份单文件(非按小时分段) */
  legacy: boolean
  /** 小时段的 10 位时间戳 `YYYYMMDDHH`(legacy 文件无此值);UI 据此显示小时区间 */
  stamp?: string
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

/** docker 不可用的原因(main 判定 → 经 ServicesListPayload 供 UI 区分「未装 CLI」与「daemon 未运行」) */
export type DockerUnavailableReason = 'cli-missing' | 'daemon-down' | 'timeout' | 'unknown'

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
  /** null = plist 里没有 StartInterval(未设置);正整数 = 固定间隔秒数 */
  startInterval: number | null
}

export type KeepAliveMode = 'bool' | 'dict'

// 三态:null = 未设置(不写该子键)。launchd 把字典内各条件 OR 起来,且 false 是合法反向条件
// (SuccessfulExit:false = 失败时重启;Crashed:false = 未崩溃时保持),故不能用 false 表示「未设置」。
// 用 null 而非 undefined:JSON 会丢 undefined 键,false/null 都保真。
export interface KeepAliveDict {
  crashed: boolean | null
  successfulExit: boolean | null
}

export type SciEntry = Partial<Record<'Minute' | 'Hour' | 'Day' | 'Weekday' | 'Month', number>>

export interface AgentForm {
  label: string
  desc: string
  processType: string
  program: string
  args: string[]
  workingDir: string
  /** 仅 daemon 域生效(launchd 对 agent 忽略该键);空串 = 不写 */
  userName: string
  nice: number
  /** null = 未设置(launchd 默认 10 秒);0 是合法值,不能与「未设置」混同 */
  throttleInterval: number | null
  env: Record<string, string>
  triggers: DrawerTriggers
  keepAliveMode: KeepAliveMode
  keepAliveDict: KeepAliveDict
  watchPaths: string[]
  sciEntries: SciEntry[]
  stdout: string
  stderr: string
}

/** Program 与 ProgramArguments 的原始形态(argv 语义不同,表单不能无损表达 "both") */
export type ProgramShape = 'program' | 'arguments' | 'both' | 'none'

/**
 * B 类/保留项的可读说明(复审 item 5):页面要能回答「这个键是什么、值是什么、为什么这样处理、
 * 保存后保证到哪一档」——只给键名不够。
 */
export interface CompatibilityEntry {
  path: string
  type: string
  summary: string
  reason: string
  /** renderer 翻译键；reason 保留作非 renderer 调用方的后备文本 */
  reasonKey?: string
  /** value = 表单不碰该键,保存时按值保留(格式可能重排);unsupported = 表单拥有该键,保存会改写 → 已锁表单 */
  preservation: 'value' | 'unsupported'
}

/** 兼容性报告(P1-2 全键 schema):B 类锁定 + 保留清单 + 提示 + 源形态 */
export interface FormCompatibility {
  /** B/C 类:表单拥有该键(或父键)却无法无损表达 → 锁表单走 XML */
  unsupportedPaths: string[]
  /** 表单不展示、保存时按值保留的顶层键 */
  preservedTopLevelKeys: string[]
  /** 不锁表单、但需要在页面上说明的运行效果提示 */
  warnings: string[]
  /** 与 warnings 同序的 renderer 翻译键 */
  warningKeys?: string[]
  /** 逐键说明(preservedTopLevelKeys + unsupportedPaths 的可读展开) */
  entries: CompatibilityEntry[]
  sourceShape: { program: ProgramShape }
}

/** 保存意图(P0-2):save 只写文件;saveAndApply 额外把「保存前已载入」的任务重新载入(不 kickstart) */
export type ApplyMode = 'save' | 'saveAndApply'

/** 分阶段结果(P0-2):失败时也要说清「文件写了没 / 回滚了没 / 运行态现在如何」 */
export interface ApplyReport {
  fileWritten: boolean
  fileRolledBack: boolean
  /** null = 未检查(applyMode='save' 不触碰运行态,零 launchctl 调用) */
  wasLoaded: boolean | null
  nowLoaded: boolean | null
  /** null = 未检查(applyMode='save' 不触碰运行态) */
  wasEnabled: boolean | null
  nowEnabled: boolean | null
  applied: boolean
  notes: string[]
}

/**
 * Agent 文档(P0-3/P1-1):一次读取给出表单 + 原文 + 兼容报告 + revision。
 * revision = sourceXml 的 sha1(内容 hash):任何写操作都带 expectedRevision 做 CAS,挡住静默并发覆盖。
 */
export interface AgentDocument {
  id: string
  scope: AgentScope
  path: string
  revision: string
  sourceXml: string
  /** null = 损坏文件(无字典可映射,走 XML 修复) */
  form: AgentForm | null
  compatibility: Omit<FormCompatibility, 'sourceShape'>
  sourceShape: { program: ProgramShape }
}

export type SaveFailureKind =
  | 'not-found'
  | 'conflict'
  | 'invalid'
  | 'unsupported'
  | 'rename-required'
  | 'elevation-cancelled'
  | 'elevation-failed'
  | 'write-failed'

/** 写操作的统一结果:成功带最新文档;失败带 kind(message 仅供展示,kind 供 UI 分支) */
export type SaveOutcome =
  | { ok: true; document: AgentDocument; report: ApplyReport }
  /** 删除成功没有可回写的文档；renderer 必须刷新列表并关闭抽屉，而非解引用空 document。 */
  | { ok: true; removed: true; report: ApplyReport }
  | { ok: false; kind: SaveFailureKind; message: string; latest?: AgentDocument; report?: ApplyReport }

export interface SaveFormInput {
  id: string
  expectedRevision: string
  /** 用户触碰过的字段(P1-1 可选优化):服务端只覆盖这些字段,其余取保存时的磁盘最新值 */
  dirtyFields: string[]
  patch: Partial<AgentForm> & { label?: string; desc?: string }
  applyMode: ApplyMode
}

export interface SaveXmlInput {
  id: string
  expectedRevision: string
  xml: string
  applyMode: ApplyMode
}

/** 克隆:与其它写路径一致带 expectedRevision(源文件被外部改过就拒绝,不克隆旧快照) */
export interface CloneInput {
  id: string
  expectedRevision: string
}

export interface RenameInput {
  id: string
  expectedRevision: string
  newLabel: string
  applyMode: ApplyMode
  /** 表单改名时可附带同一事务中用户明确修改的字段 */
  dirtyFields?: string[]
  patch?: Partial<AgentForm> & { desc?: string }
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
