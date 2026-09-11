// launchd plist 键 ⇄ 抽屉表单(AgentForm)的双向映射(阶段 1;机制对齐开源 LaunchItem)
// 表单兼容守卫(开源行为):出现托管键之外的键 → xmlFallback=true,强制走 XML 模式编辑

import type { AgentForm, SciEntry } from '../../shared/models'
import type { PlistDict, PlistValue } from './plist-xml'

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
  'Nice',
  'ThrottleInterval',
  'ProcessType'
] as const

const SCI_KEYS: (keyof SciEntry)[] = ['Minute', 'Hour', 'Day', 'Weekday', 'Month']

export interface FormFromPlist {
  form: AgentForm
  xmlFallback: boolean
  unsupportedKeys: string[]
}

function str(v: PlistValue | undefined): string {
  return typeof v === 'string' ? v : ''
}
function num(v: PlistValue | undefined): number {
  return typeof v === 'number' ? v : 0
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
  const unsupportedKeys = Object.keys(value).filter(
    (k) => !(MANAGED_KEYS as readonly string[]).includes(k)
  )

  const ka = value.KeepAlive
  const kaDict = typeof ka === 'object' && ka !== null && !Array.isArray(ka) ? (ka as PlistDict) : null
  const sci = sciFromValue(value.StartCalendarInterval)
  const watch = Array.isArray(value.WatchPaths) ? value.WatchPaths.map((x) => String(x)) : []
  const env = typeof value.EnvironmentVariables === 'object' && value.EnvironmentVariables !== null && !Array.isArray(value.EnvironmentVariables)
    ? Object.fromEntries(Object.entries(value.EnvironmentVariables as PlistDict).map(([k, v]) => [k, String(v)]))
    : {}
  const startInterval = num(value.StartInterval)

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
    nice: num(value.Nice),
    throttleInterval: num(value.ThrottleInterval),
    env,
    triggers: {
      runAtLoad: value.RunAtLoad === true,
      keepAlive: ka === true || kaDict !== null,
      watchPaths: watch.length > 0,
      startCalendarInterval: sci.length > 0,
      startInterval
    },
    keepAliveMode: kaDict !== null ? 'dict' : 'bool',
    keepAliveDict: {
      crashed: kaDict?.Crashed === true,
      afterInitialDemand: kaDict?.AfterInitialDemand === true,
      successfulExit: kaDict?.SuccessfulExit === true
    },
    watchPaths: watch,
    sciEntries: sci,
    stdout: str(value.StandardOutPath),
    stderr: str(value.StandardErrorPath)
  }
  return { form, xmlFallback: unsupportedKeys.length > 0, unsupportedKeys }
}

export function plistFromForm(form: AgentForm): PlistDict {
  const out: PlistDict = { Label: form.label }
  // 规范形态:ProgramArguments = [可执行文件, ...args](launchd 以 [0] 为程序;单独写 Program 易与 args 脱节)
  if (form.program !== '') out.ProgramArguments = [form.program, ...form.args]
  else if (form.args.length > 0) out.ProgramArguments = form.args
  if (form.triggers.runAtLoad) out.RunAtLoad = true
  if (form.keepAliveMode === 'dict') {
    const d: PlistDict = {}
    if (form.keepAliveDict.crashed) d.Crashed = true
    if (form.keepAliveDict.afterInitialDemand) d.AfterInitialDemand = true
    if (form.keepAliveDict.successfulExit) d.SuccessfulExit = true
    out.KeepAlive = d
  } else if (form.triggers.keepAlive) {
    out.KeepAlive = true
  }
  if (form.triggers.startInterval > 0) out.StartInterval = form.triggers.startInterval
  if (form.triggers.startCalendarInterval && form.sciEntries.length > 0) {
    const entries = form.sciEntries.map((e) => ({ ...e }))
    out.StartCalendarInterval = entries.length === 1 ? entries[0] : entries
  }
  if (form.triggers.watchPaths && form.watchPaths.length > 0) out.WatchPaths = form.watchPaths
  if (form.workingDir !== '') out.WorkingDirectory = form.workingDir
  const envEntries = Object.entries(form.env).filter(([k]) => k !== '')
  if (envEntries.length > 0) out.EnvironmentVariables = Object.fromEntries(envEntries)
  if (form.stdout !== '') out.StandardOutPath = form.stdout
  if (form.stderr !== '') out.StandardErrorPath = form.stderr
  if (form.nice !== 0) out.Nice = form.nice
  if (form.throttleInterval !== 0) out.ThrottleInterval = form.throttleInterval
  if (form.processType !== '') out.ProcessType = form.processType
  return out
}
