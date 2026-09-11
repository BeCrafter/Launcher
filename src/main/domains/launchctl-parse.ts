// launchctl 输出解析纯函数(阶段 1;机制对齐开源 LaunchManager 的 LaunchctlService)
// - list:三列制表符(PID / Status=上次退出码 / Label),"-" 表示无
// - print-disabled:带 `=> enabled|disabled` 的引号 label 行
// - print:key = value 行 + arguments/environment 块(补 pid/runs/last exit code/路径/环境)

export interface LaunchctlEntry {
  label: string
  pid: number | null
  lastExitCode: number | null
}

export function parseLaunchctlList(output: string): Map<string, LaunchctlEntry> {
  const out = new Map<string, LaunchctlEntry>()
  const lines = output.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '')
    if (line.trim() === '') continue
    if (i === 0 && /^PID\s/.test(line)) continue // 表头
    const cols = line.split('\t')
    if (cols.length < 3) continue
    const label = cols[2].trim()
    if (label === '') continue
    out.set(label, {
      label,
      pid: cols[0].trim() === '-' ? null : Number.parseInt(cols[0].trim(), 10) || null,
      lastExitCode: cols[1].trim() === '-' ? null : Number.parseInt(cols[1].trim(), 10)
    })
  }
  return out
}

/** 返回被 disable 的 label 集合(print-disabled;<domain> 输出) */
export function parsePrintDisabled(output: string): Set<string> {
  const disabled = new Set<string>()
  for (const raw of output.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line.includes('=>')) continue
    const m = line.match(/"([^"]+)"\s*=>\s*(\w+)/)
    if (!m) continue
    if (m[2] === 'disabled') disabled.add(m[1])
  }
  return disabled
}

export interface LaunchctlPrintInfo {
  state: string | null
  path: string | null
  program: string | null
  arguments: string[]
  workingDirectory: string | null
  stdoutPath: string | null
  stderrPath: string | null
  environment: Record<string, string>
  runs: number | null
  lastExitCode: number | null
  pid: number | null
  found: boolean
}

const EMPTY_PRINT: LaunchctlPrintInfo = {
  state: null,
  path: null,
  program: null,
  arguments: [],
  workingDirectory: null,
  stdoutPath: null,
  stderrPath: null,
  environment: {},
  runs: null,
  lastExitCode: null,
  pid: null,
  found: false
}

/** 解析 `launchctl print <domain>/<label>` 输出(字段行 + 两处块) */
export function parseLaunchctlPrint(output: string): LaunchctlPrintInfo {
  if (/Could not find service|No such process/.test(output)) return { ...EMPTY_PRINT }
  const info: LaunchctlPrintInfo = { ...EMPTY_PRINT, found: true, environment: {}, arguments: [] }
  const lines = output.split('\n')
  let block: 'arguments' | 'environment' | null = null
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    if (block) {
      if (/^\s*\}\s*$/.test(line)) {
        block = null
        continue
      }
      const item = line.trim()
      if (item === '') continue
      if (block === 'arguments') info.arguments.push(item)
      else {
        const m = item.match(/^(\S+)\s*=>\s*(.*)$/)
        if (m) info.environment[m[1]] = m[2]
      }
      continue
    }
    const kv = line.match(/^\s*([a-z][a-z0-9 _-]*?)\s*=\s*(.*)$/)
    if (!kv) continue
    const key = kv[1].trim()
    const value = kv[2].trim()
    switch (key) {
      case 'state':
        info.state = value
        break
      case 'path':
        info.path = value
        break
      case 'program':
        info.program = value
        break
      case 'arguments':
        block = 'arguments'
        break
      case 'environment':
        block = 'environment'
        break
      case 'working directory':
        info.workingDirectory = value
        break
      case 'stdout path':
        info.stdoutPath = value
        break
      case 'stderr path':
        info.stderrPath = value
        break
      case 'runs':
        info.runs = Number.parseInt(value, 10)
        break
      case 'pid':
        info.pid = Number.parseInt(value, 10)
        break
      case 'last exit code':
        info.lastExitCode = /^\(never exited\)$/.test(value) ? null : Number.parseInt(value, 10)
        break
      default:
        break
    }
  }
  return info
}
