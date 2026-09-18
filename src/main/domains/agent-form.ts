// launchd plist 键 ⇄ 抽屉表单(AgentForm)的双向映射(阶段 1;机制对齐开源 LaunchItem)
// 表单兼容守卫(开源行为):表单表达不了的内容 → 不兼容清单非空,强制走 XML 模式编辑

import type { AgentForm, CompatibilityEntry, FormCompatibility, ProgramShape, SciEntry } from '../../shared/models'

export type { FormCompatibility, ProgramShape }
import { scanTopLevelDict } from './plist-xml'
import type { PlistDict, PlistValue } from './plist-xml'

// 托管键 = 表单读写的键。分两类:
// - 可编辑字段:有 UI 与模型字段(UserName / StandardInPath / Nice / ThrottleInterval / ProcessType)
// - 往返白名单(无 UI,见 ROUND_TRIP_KEYS):读到不解析,保存时由 plistFromForm(form, base)
//   从磁盘原值原样搬回,只为「不触发守卫、不丢键」而存在
export const MANAGED_KEYS = [
  'Label',
  'Program',
  'ProgramArguments',
  'RunAtLoad',
  'KeepAlive',
  'WatchPaths',
  'StartCalendarInterval',
  'StartInterval',
  'EnvironmentVariables',
  'WorkingDirectory',
  'StandardOutPath',
  'StandardErrorPath',
  'StandardInPath',
  'Nice',
  'ThrottleInterval',
  'ProcessType',
  'UserName',
  'Disabled',
  'EnableTransactions'
] as const

/** 无 UI 的往返白名单(见上方说明):保存时从磁盘字典原样搬回 */
export const ROUND_TRIP_KEYS = ['Disabled', 'EnableTransactions'] as const

const SCI_KEYS: (keyof SciEntry)[] = ['Minute', 'Hour', 'Day', 'Weekday', 'Month']
// KeepAlive 字典里表单能表达的条件;其余子键(AfterInitialDemand / NetworkState / PathState / …)
// 语义各异且部分未文档化 → 进不兼容清单,交给 XML 编辑,避免保存时被静默丢弃
const KA_DICT_KEYS = ['Crashed', 'SuccessfulExit'] as const

export interface FormFromPlist {
  form: AgentForm
  unsupportedKeys: string[]
}

function str(v: PlistValue | undefined): string {
  return typeof v === 'string' ? v : ''
}
function num(v: PlistValue | undefined): number {
  return typeof v === 'number' ? v : 0
}
/** 只给「缺省 ≠ 0」的数值键用(ThrottleInterval 默认 10 秒,0 是合法值) */
function numOrNull(v: PlistValue | undefined): number | null {
  return typeof v === 'number' ? v : null
}
function isDict(v: PlistValue | undefined): v is PlistDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 表单不展示的顶层键。它们是 XML-only B 类配置：可以在页面中看到摘要，
 * 但不能通过表单保存，避免未来模型变更时静默改变服务语义。
 */
export function unmanagedKeys(value: PlistDict): string[] {
  return Object.keys(value)
    .filter((k) => !(MANAGED_KEYS as readonly string[]).includes(k))
    .sort()
}

export function programShapeOf(value: PlistDict): ProgramShape {
  // 形态取决于键是否存在，而非数组是否有元素；Program + 空 ProgramArguments 同样不能由表单无损表达。
  const hasProgram = Object.hasOwn(value, 'Program')
  const hasArgs = Object.hasOwn(value, 'ProgramArguments')
  if (hasProgram && hasArgs) return 'both'
  if (hasProgram) return 'program'
  if (hasArgs) return 'arguments'
  return 'none'
}

const SCI_RANGES: Record<(typeof SCI_KEYS)[number], [number, number]> = {
  Minute: [0, 59],
  Hour: [0, 23],
  Day: [1, 31],
  Weekday: [0, 7], // 0 与 7 都是周日
  Month: [1, 12]
}

/** 类型必须为 boolean 的托管键(异常类型 → B 类锁定) */
const BOOL_KEYS = ['RunAtLoad'] as const
/** 类型必须为 string 的托管键 */
const STRING_KEYS = ['WorkingDirectory', 'StandardOutPath', 'StandardErrorPath', 'StandardInPath', 'UserName', 'ProcessType'] as const
/** 类型必须为整数的托管键(key → 合法区间) */
const INT_KEYS: Record<string, [number, number]> = {
  Nice: [-20, 20],
  ThrottleInterval: [0, Number.MAX_SAFE_INTEGER],
  StartInterval: [1, Number.MAX_SAFE_INTEGER]
}

/**
 * 全键兼容性扫描(P1-2 / P1-3)。UI 横幅与保存守卫共用同一份输出。
 * - unsupportedPaths:表单拥有父键、无法无损表达 → 锁表单(非托管顶层键不在此列,它们按值保留)
 * - preservedTopLevelKeys:兼容旧 IPC 字段,当前未建模顶层键统一归 B 类并锁定表单
 * - warnings:不锁但需说明的运行效果
 */
export function scanCompatibility(value: PlistDict, sourceXml = ''): FormCompatibility {
  const out: string[] = []
  const warnings: string[] = []
  const warningKeys: string[] = []

  // ── KeepAlive:bool,或仅含可表达且为 boolean 的条件字典 ──
  const ka = value.KeepAlive
  if (ka !== undefined && typeof ka !== 'boolean' && !isDict(ka)) {
    out.push('KeepAlive')
  } else if (isDict(ka)) {
    for (const [k, v] of Object.entries(ka)) {
      if (!(KA_DICT_KEYS as readonly string[]).includes(k)) out.push(`KeepAlive.${k}`)
      else if (typeof v !== 'boolean') out.push(`KeepAlive.${k}`)
    }
  }

  // ── Program / ProgramArguments:同存时 argv 语义无法无损表达(P1-2) ──
  if (programShapeOf(value) === 'both') out.push('ProgramArguments(与 Program 同存)')
  if (value.ProgramArguments !== undefined) {
    if (!Array.isArray(value.ProgramArguments)) out.push('ProgramArguments')
    else if (value.ProgramArguments.some((x) => typeof x !== 'string')) out.push('ProgramArguments')
  }
  if (value.Program !== undefined && typeof value.Program !== 'string') out.push('Program')

  // ── 布尔/字符串/整数型托管键 ──
  for (const k of BOOL_KEYS) {
    if (value[k] !== undefined && typeof value[k] !== 'boolean') out.push(k)
  }
  for (const k of STRING_KEYS) {
    if (value[k] !== undefined && typeof value[k] !== 'string') out.push(k)
  }
  for (const [k, [min, max]] of Object.entries(INT_KEYS)) {
    const v = value[k]
    if (v === undefined) continue
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) out.push(k)
  }

  // ── WatchPaths:string 数组 ──
  if (value.WatchPaths !== undefined) {
    if (!Array.isArray(value.WatchPaths) || value.WatchPaths.some((x) => typeof x !== 'string')) out.push('WatchPaths')
  }

  // ── EnvironmentVariables:dictionary of strings(非 dict 同样锁定,不能只查 dict 内元素) ──
  if (value.EnvironmentVariables !== undefined && !isDict(value.EnvironmentVariables)) {
    out.push('EnvironmentVariables')
  } else if (isDict(value.EnvironmentVariables)) {
    for (const [k, v] of Object.entries(value.EnvironmentVariables)) {
      if (typeof v !== 'string') out.push(`EnvironmentVariables.${k}`)
    }
  }

  // ── StartCalendarInterval:dict 或 dict 数组,仅 5 个整数键且在范围内 ──
  if (value.StartCalendarInterval !== undefined) {
    for (const entry of Array.isArray(value.StartCalendarInterval) ? value.StartCalendarInterval : [value.StartCalendarInterval]) {
      if (!isDict(entry)) {
        out.push('StartCalendarInterval')
        continue
      }
      for (const [k, v] of Object.entries(entry)) {
        const range = SCI_RANGES[k as (typeof SCI_KEYS)[number]]
        if (!range) out.push(`StartCalendarInterval.${k}`)
        else if (typeof v !== 'number' || !Number.isInteger(v) || v < range[0] || v > range[1]) {
          out.push(`StartCalendarInterval.${k}`)
        }
      }
    }
  }

  // ── Disabled / EnableTransactions:仅往返保留,类型必须为 boolean ──
  for (const k of ROUND_TRIP_KEYS) {
    if (value[k] !== undefined && typeof value[k] !== 'boolean') out.push(k)
  }

  // ── 节点级补丁的适用性:结构必须能安全扫描 ──
  // 注释 / <data> / <date> / <real> / 键序 现在都由补丁逐字节保留(只改写被改动的键),
  // 因此不再按内容锁文件;只有「扫描不了」的结构(顶层 CDATA、键缺值、根异常)才锁。
  if (sourceXml !== '') {
    const scan = scanTopLevelDict(sourceXml)
    if (!scan.ok) out.push(`文件结构无法安全增量改写(${scan.reason}):请用 XML 编辑`)
  }

  // ── plist 里的 Disabled(只读可见,不改写):启停实际由 launchctl 覆盖位决定 ──
  if (value.Disabled === true) {
    warnings.push('plist 中 Disabled = true(文件默认不加载);实际启停以 launchctl 覆盖位为准,保存时原值保留')
    warningKeys.push('cfg.compat.disabledWarning')
  }

  // ── 运行效果提示(不锁表单,只说明) ──
  if ((ka === true || isDict(ka)) && (value.StartInterval !== undefined || value.StartCalendarInterval !== undefined || value.WatchPaths !== undefined)) {
    warnings.push('KeepAlive 与定时/监视触发同时存在:任务已运行时,到点触发不会创建额外实例(两者独立评估)')
    warningKeys.push('cfg.keepAlive.conflict')
  }
  if (isDict(value.StartCalendarInterval) && Object.keys(value.StartCalendarInterval).length === 0) {
    warnings.push('StartCalendarInterval 为空字典 = 每分钟触发')
    warningKeys.push('cfg.compat.emptySciWarning')
  }
  if (Array.isArray(value.StartCalendarInterval) && value.StartCalendarInterval.some((e) => isDict(e) && Object.keys(e).length === 0)) {
    warnings.push('StartCalendarInterval 含空规则 = 每分钟触发')
    warningKeys.push('cfg.compat.emptySciWarning')
  }

  // 未建模的顶层键属于 B 类：XML 通道保留原文，表单保存必须锁定。
  out.push(...unmanagedKeys(value))
  const unsupportedPaths = [...new Set(out)].sort()
  const preservedTopLevelKeys: string[] = []
  const entries: CompatibilityEntry[] = [
    ...unsupportedPaths.map((pathKey) => ({
      path: pathKey,
      type: valueAtPath(value, pathKey) === undefined ? '(表达式)' : plistTypeOf(valueAtPath(value, pathKey)),
      summary: valueAtPath(value, pathKey) === undefined ? '' : summarizeValue(valueAtPath(value, pathKey)),
      reason: '该配置属于 XML-only B 类:表单无法无损表达,请用 XML 编辑',
      reasonKey: 'cfg.compat.reason',
      preservation: 'unsupported' as const
    }))
  ]

  return {
    unsupportedPaths,
    preservedTopLevelKeys,
    warnings,
    warningKeys,
    entries,
    sourceShape: { program: programShapeOf(value) }
  }
}

/** plist 值的类型名(与 XML 里的写法对齐:integer/real/string/boolean/array/dict) */
function plistTypeOf(v: PlistValue | undefined): string {
  if (v === undefined) return 'missing'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'real'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'string') return 'string'
  return 'dict'
}

/** 值摘要(截断,供页面列表用) */
function summarizeValue(v: PlistValue | undefined): string {
  if (v === undefined) return ''
  const text = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)
  return text.length > 48 ? `${text.slice(0, 45)}…` : text
}

/** 兼容性路径支持 KeepAlive.PathState / EnvironmentVariables.PORT 等嵌套键。 */
function valueAtPath(value: PlistDict, path: string): PlistValue | undefined {
  if (Object.hasOwn(value, path)) return value[path]
  const parts = path.split('.')
  let current: PlistValue | undefined = value
  for (const part of parts) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as PlistDict)[part]
  }
  return current
}

/** 锁定判据(供保存守卫与既有调用点使用):scanCompatibility 的 unsupportedPaths 别名 */
export function formIncompatibilities(value: PlistDict): string[] {
  return scanCompatibility(value).unsupportedPaths
}

/**
 * 新建 / 改名时的输入约束(P1-2「约束优先」;既有配置的异常形态走 B 类锁定,不在这里静默修正)。
 * 返回问题列表(空数组 = 通过);不依赖 UI 的 input min/max。
 */
export interface FormValidationOptions {
  requireExecutable?: boolean
  validateNice?: boolean
  validateThrottle?: boolean
  validateSchedule?: boolean
  validatePaths?: boolean
  validateUserName?: boolean
}

export function validateNewAgentInput(form: AgentForm, opts: FormValidationOptions = {}): string[] {
  const problems: string[] = []
  const enabled = (key: keyof FormValidationOptions): boolean => opts[key] ?? true
  // 新建/改名必须可启动；既有任务编辑其它字段时不因历史空 Program 被强制改写。
  if (enabled('requireExecutable') && form.program.trim() === '' && form.args.filter((a) => a !== '').length === 0) {
    problems.push('必须提供 Program 或至少一个参数(launchd 拒载没有可执行体的任务)')
  }
  if (enabled('validateNice') && (!Number.isInteger(form.nice) || form.nice < -20 || form.nice > 20)) {
    problems.push('Nice 必须是 -20~20 的整数')
  }
  if (enabled('validateThrottle') && form.throttleInterval !== null && (!Number.isInteger(form.throttleInterval) || form.throttleInterval < 0)) {
    problems.push('ThrottleInterval 必须是 ≥ 0 的整数(留空 = 使用系统默认 10 秒)')
  }
  // 0 表示未设置；任何其他值都必须是正整数，避免负数被 plistFromForm 静默省略。
  // presence 建模:null = plist 里没有该键(未设置);任何给出的值都必须是正整数(0 不再是「未设置」)
  if (
    enabled('validateSchedule') &&
    form.triggers.startInterval !== null &&
    (!Number.isInteger(form.triggers.startInterval) || form.triggers.startInterval < 1)
  ) {
    problems.push('StartInterval 必须是正整数秒（留空 = 未设置）')
  }
  if (enabled('validateSchedule') && form.triggers.startCalendarInterval) {
    if (form.sciEntries.length === 0) problems.push('已启用 StartCalendarInterval 但没有规则')
    form.sciEntries.forEach((e, i) => {
      const keys = Object.keys(e) as (keyof SciEntry)[]
      if (keys.length === 0) {
        // 空规则 = 全通配(每分钟触发):「新建时不得隐式生成」由渲染层的新建确认弹窗把关(P1-4)
        return
      }
      for (const k of keys) {
        const range = SCI_RANGES[k]
        const v = e[k]
        if (!range || typeof v !== 'number' || !Number.isInteger(v) || v < range[0] || v > range[1]) {
          problems.push(`第 ${i + 1} 条日历规则的 ${k} 超出范围 ${range ? `${range[0]}~${range[1]}` : '(非法字段)'}`)
        }
      }
    })
  }
  if (enabled('validatePaths')) {
    for (const [name, p] of [
      ['WorkingDirectory', form.workingDir],
      ['StandardOutPath', form.stdout],
      ['StandardErrorPath', form.stderr],
      ['StandardInPath', form.stdin]
    ] as const) {
      if (p !== '' && !p.startsWith('/')) problems.push(`${name} 必须是绝对路径`)
    }
  }
  if (enabled('validateUserName') && form.userName !== '' && /[\s\x00-\x1f]/.test(form.userName)) {
    problems.push('UserName 不能包含空白或控制字符')
  }
  return problems
}

/** StartCalendarInterval(dict 或 dict 数组)→ SCI 条目 */
function sciFromValue(v: PlistValue | undefined): SciEntry[] {
  const one = (d: PlistValue): SciEntry => {
    const out: SciEntry = {}
    if (typeof d === 'object' && d !== null && !Array.isArray(d)) {
      for (const k of SCI_KEYS) {
        const n = (d as PlistDict)[k]
        if (typeof n === 'number') out[k] = n
      }
    }
    return out
  }
  if (Array.isArray(v)) return v.map(one)
  if (v !== undefined && typeof v === 'object' && v !== null) return [one(v)]
  return []
}

export function formFromPlist(value: PlistDict, desc: string): FormFromPlist {
  const unsupportedKeys = formIncompatibilities(value)

  const ka = value.KeepAlive
  const kaDict = isDict(ka) ? ka : null
  const kaCrashed = typeof kaDict?.Crashed === 'boolean' ? kaDict.Crashed : null
  const kaSuccessfulExit = typeof kaDict?.SuccessfulExit === 'boolean' ? kaDict.SuccessfulExit : null
  const sci = sciFromValue(value.StartCalendarInterval)
  const watch = Array.isArray(value.WatchPaths) ? value.WatchPaths.map((x) => String(x)) : []
  const env = typeof value.EnvironmentVariables === 'object' && value.EnvironmentVariables !== null && !Array.isArray(value.EnvironmentVariables)
    ? Object.fromEntries(Object.entries(value.EnvironmentVariables as PlistDict).map(([k, v]) => [k, String(v)]))
    : {}
  // null = 未设置(与「显式 0」区分开,后者是非法值,已由兼容扫描锁定)
  const startInterval = numOrNull(value.StartInterval)

  // argv 约定:Program 在场 → ProgramArguments 即 argv[1..];否则其 [0] 为可执行文件
  const progArgs = Array.isArray(value.ProgramArguments) ? value.ProgramArguments.map((x) => String(x)) : []
  const programKey = str(value.Program)
  const form: AgentForm = {
    label: str(value.Label),
    desc,
    processType: str(value.ProcessType),
    program: programKey !== '' ? programKey : (progArgs[0] ?? ''),
    args: programKey !== '' ? progArgs : progArgs.slice(1),
    workingDir: str(value.WorkingDirectory),
    userName: str(value.UserName),
    nice: num(value.Nice),
    throttleInterval: numOrNull(value.ThrottleInterval),
    env,
    triggers: {
      runAtLoad: value.RunAtLoad === true,
      // KeepAlive:{} 无任何条件 → 视为关闭(man:找不到重启理由即回落按需调用)
      keepAlive: ka === true || kaCrashed !== null || kaSuccessfulExit !== null,
      watchPaths: watch.length > 0,
      startCalendarInterval: sci.length > 0,
      startInterval
    },
    keepAliveMode: kaDict !== null ? 'dict' : 'bool',
    keepAliveDict: {
      crashed: kaCrashed,
      successfulExit: kaSuccessfulExit
    },
    watchPaths: watch,
    sciEntries: sci,
    stdout: str(value.StandardOutPath),
    stderr: str(value.StandardErrorPath),
    stdin: str(value.StandardInPath)
  }
  return { form, unsupportedKeys }
}

/** 表单 → plist 字典。base = 本次编辑所基于的磁盘字典(表单不产出的键从中原样搬回) */
export function plistFromForm(form: AgentForm, base?: PlistDict, dirtyFields?: readonly string[]): PlistDict {
  const out: PlistDict = { Label: form.label }
  // 规范形态:ProgramArguments = [可执行文件, ...args](launchd 以 [0] 为程序;单独写 Program 易与 args 脱节)
  if (form.program !== '') out.ProgramArguments = [form.program, ...form.args]
  else if (form.args.length > 0) out.ProgramArguments = form.args
  if (form.triggers.runAtLoad) out.RunAtLoad = true
  // 触发卡关掉、或条件全未设置 → 不写该键(空 dict 仍隐含 RunAtLoad,是无效产物)
  if (form.triggers.keepAlive) {
    if (form.keepAliveMode === 'bool') {
      out.KeepAlive = true
    } else {
      const d: PlistDict = {}
      if (form.keepAliveDict.crashed !== null) d.Crashed = form.keepAliveDict.crashed
      if (form.keepAliveDict.successfulExit !== null) d.SuccessfulExit = form.keepAliveDict.successfulExit
      if (Object.keys(d).length > 0) out.KeepAlive = d
    }
  }
  if (typeof form.triggers.startInterval === 'number' && form.triggers.startInterval > 0) {
    out.StartInterval = form.triggers.startInterval
  }
  if (form.triggers.startCalendarInterval && form.sciEntries.length > 0) {
    const entries = form.sciEntries.map((e) => ({ ...e }))
    out.StartCalendarInterval = entries.length === 1 ? entries[0] : entries
  }
  if (form.triggers.watchPaths && form.watchPaths.length > 0) out.WatchPaths = form.watchPaths
  if (form.workingDir !== '') out.WorkingDirectory = form.workingDir
  if (form.userName !== '') out.UserName = form.userName
  const envEntries = Object.entries(form.env).filter(([k]) => k !== '')
  if (envEntries.length > 0) out.EnvironmentVariables = Object.fromEntries(envEntries)
  if (form.stdout !== '') out.StandardOutPath = form.stdout
  if (form.stderr !== '') out.StandardErrorPath = form.stderr
  if (form.stdin !== '') out.StandardInPath = form.stdin
  if (form.nice !== 0) out.Nice = form.nice
  // 0 是合法值(launchd 默认 10 秒),只有 null/未设置才不写
  if (typeof form.throttleInterval === 'number') out.ThrottleInterval = form.throttleInterval
  if (form.processType !== '') out.ProcessType = form.processType
  // 已有文件保存时，只允许用户明确触碰的字段改变。表单模型会把
  // 「显式 false/0/Program 形态」归一化为默认值，因此这里必须把未触碰的
  // managed key 从本次保存的磁盘快照恢复回来，否则只改描述也会删键或改形。
  if (base && dirtyFields !== undefined) {
    const dirty = new Set(dirtyFields)
    const touched = (field: string): boolean => dirty.has(field)
    const touchedTop = (key: string): boolean => {
      if (key === 'Label') return touched('label')
      if (key === 'Program' || key === 'ProgramArguments') return touched('program') || touched('args')
      if (key === 'RunAtLoad' || key === 'KeepAlive' || key === 'WatchPaths' || key === 'StartCalendarInterval' || key === 'StartInterval') {
        return touched('triggers') ||
          (key === 'KeepAlive' && (touched('keepAliveMode') || touched('keepAliveDict'))) ||
          (key === 'WatchPaths' && touched('watchPaths')) ||
          (key === 'StartCalendarInterval' && touched('sciEntries'))
      }
      const fields: Record<string, string> = {
        WorkingDirectory: 'workingDir',
        UserName: 'userName',
        Nice: 'nice',
        ThrottleInterval: 'throttleInterval',
        EnvironmentVariables: 'env',
        StandardOutPath: 'stdout',
        StandardErrorPath: 'stderr',
        StandardInPath: 'stdin',
        ProcessType: 'processType'
      }
      return fields[key] ? touched(fields[key]) : false
    }
    for (const key of MANAGED_KEYS) {
      if (touchedTop(key)) continue
      if (Object.hasOwn(base, key)) out[key] = base[key]
      else delete out[key]
    }
  }
  // 原样搬回(取自本次编辑所基于的磁盘字典):
  // ① 所有非托管键(表单不展示的第三方键,如 MachServices / Sockets)② 往返白名单(无 UI 的托管键,如 Disabled)
  // —— 表单既不展示也不改动它们,覆盖即数据损失;Program 属托管键(已由 ProgramArguments 规范化),不在此列
  if (base) {
    for (const [k, v] of Object.entries(base)) {
      if (!(MANAGED_KEYS as readonly string[]).includes(k)) out[k] = v
    }
    for (const k of ROUND_TRIP_KEYS) {
      if (k in base) out[k] = base[k]
    }
  }
  return out
}
