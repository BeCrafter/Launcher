// crontab 文本 ↔ 模型 纯函数层(阶段 2 核心)
// 往返保真:未改动行原样透传(序列化 = lines.join('\n'));只有被编辑的任务行会被重写
// 文件格式约定(记入 demo-react-migration-map 差异表):
//   - 禁用 = 行首 `# [disabled] ` 前缀(应用自有标记,与用户手写注释区分)
//   - 任务描述 = 紧邻上方的注释行(通用约定,不引入私有语法)
//   - 日志包裹 = `<expr> ( <cmd> ) >> <logPath> 2>&1`(仅识别本应用日志目录内的路径)
//   - user scope 5 字段;system scope(/etc/crontab)6 字段(第 6 字段 user)
//   - 无法解析的行原样保留(不展示、不丢弃)

import { isLauncherCronLogPath } from '../../shared/cron-log'
import type { CronJob, CronScope } from '../../shared/models'

export interface CrontabEnvVar {
  name: string
  value: string
  raw: string
}

export interface CrontabJobEntry {
  job: CronJob
  lineIndex: number
  descLineIndex: number | null
}

export interface ParsedCrontab {
  /** 原始行(\n 切分);序列化即 join('\n'),未改动行字节级保真 */
  lines: string[]
  /** 文件头 = 首个任务前的连续注释/env/空行块(不含首个任务的 desc 注释行) */
  header: { env: CrontabEnvVar[]; endLine: number }
  jobs: CrontabJobEntry[]
  /** 判定不了的行(保留在 lines 中但不可编辑) */
  unparsed: { lineIndex: number; raw: string }[]
}

const DISABLED_PREFIX = '# [disabled] '
const ENV_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/
const SPECIAL_RE = /^@(reboot|yearly|annually|monthly|weekly|daily|midnight|hourly)\s+(.+)$/

/** FNV-1a 32bit → 8 位 hex(作用域内内容身份;不含包裹/禁用渲染) */
export function hashJobId(scope: CronScope, expr: string, cmd: string): string {
  const s = `${scope}\u001f${expr}\u001f${cmd}`
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** 取前 n 个空白分隔 token,返回剩余原文(命令段,保留内部空格与引号) */
function takeTokens(s: string, n: number): { tokens: string[]; rest: string } | null {
  const tokens: string[] = []
  let i = 0
  while (tokens.length < n) {
    while (i < s.length && /\s/.test(s[i])) i++
    if (i >= s.length) return null
    const start = i
    while (i < s.length && !/\s/.test(s[i])) i++
    tokens.push(s.slice(start, i))
  }
  return { tokens, rest: s.slice(i).trim() }
}

/** 剥掉应用日志包裹;返回 null 表示非应用包裹(用户自有重定向原样保留) */
export function unwrapLogCmd(cmdRaw: string, home: string): { cmd: string; logPath: string } | null {
  const m = cmdRaw.match(/^(.*\S)\s+>>\s*(\S+)\s+2>&1$/)
  if (!m) return null
  const path = m[2]
  if (!isLauncherCronLogPath(home, path)) return null
  let inner = m[1].trim()
  if (inner.startsWith('(') && inner.endsWith(')')) inner = inner.slice(1, -1).trim()
  return { cmd: inner, logPath: path }
}

function parseJobLine(
  content: string,
  scope: CronScope,
  username: string,
  home: string,
  enabled: boolean
): Omit<CronJob, 'id' | 'desc'> | null {
  const special = content.match(SPECIAL_RE)
  let expr: string
  let rest: string
  let user: string
  if (special) {
    expr = `@${special[1]}`
    rest = special[2].trim()
    user = scope === 'system' ? '' : username
  } else {
    const take = takeTokens(content, scope === 'system' ? 6 : 5)
    if (!take) return null
    const [m, h, dom, mon, dow, sysUser] = take.tokens
    expr = `${m} ${h} ${dom} ${mon} ${dow}`
    rest = take.rest
    user = scope === 'system' ? (sysUser ?? '') : username
  }
  if (rest === '') return null
  if (scope === 'system' && user === '' && !special) return null

  const unwrapped = unwrapLogCmd(rest, home)
  const cmd = unwrapped ? unwrapped.cmd : rest
  if (cmd === '') return null

  return {
    user,
    expr,
    cmd,
    enabled,
    log: unwrapped !== null,
    logPath: unwrapped?.logPath,
    special: special !== null,
    system: scope === 'system' ? true : undefined
  }
}

function extractDesc(line: string): string | null {
  const m = line.match(/^\s*#\s?(.*)$/)
  if (!m) return null
  const text = m[1].trim()
  if (text.startsWith('[disabled]')) return null // 禁用任务行不是描述
  return text
}

export function parseCrontab(text: string, scope: CronScope, username: string, home: string): ParsedCrontab {
  const lines = text.split('\n')
  const jobs: CrontabJobEntry[] = []
  const unparsed: { lineIndex: number; raw: string }[] = []
  const usedIds = new Map<string, number>()

  // 头部 = 首个任务(启用或禁用)行之前的连续块;紧邻首个任务行的注释计为该任务 desc
  let firstJobLine = -1

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (raw.trim() === '') continue

    const disabledMatch = raw.match(/^\s*#\s*\[disabled\]\s+(.*)$/)
    const isDisabledJobLine = disabledMatch !== null
    const content = isDisabledJobLine ? disabledMatch[1] : raw

    if (!isDisabledJobLine && /^\s*#/.test(raw)) continue // 普通注释(desc 在任务行处理时回看)
    if (!isDisabledJobLine && ENV_RE.test(raw)) continue // 环境变量行

    const parsed = parseJobLine(
      isDisabledJobLine ? content : raw,
      scope,
      username,
      home,
      !isDisabledJobLine
    )
    if (!parsed) {
      unparsed.push({ lineIndex: i, raw })
      continue
    }
    if (firstJobLine === -1) firstJobLine = i

    // id 分配(同内容重复出现时按顺序加后缀,保证会话内稳定唯一)
    const base = hashJobId(scope, parsed.expr, parsed.cmd)
    const n = (usedIds.get(base) ?? 0) + 1
    usedIds.set(base, n)
    const id = n === 1 ? base : `${base}-${n}`

    // 描述 = 紧邻上方注释行
    let desc = ''
    let descLineIndex: number | null = null
    if (i > 0) {
      const prev = extractDesc(lines[i - 1])
      if (prev !== null) {
        desc = prev
        descLineIndex = i - 1
      }
    }

    jobs.push({ job: { id, ...parsed, desc }, lineIndex: i, descLineIndex })
  }

  // 头部范围:到首个任务行(含其 desc 行则排除 desc 行);无任务 → 整文件
  const headerEnd = firstJobLine === -1 ? lines.length : (jobs[0]?.descLineIndex ?? firstJobLine)
  const env: CrontabEnvVar[] = []
  for (let i = 0; i < headerEnd; i++) {
    const m = lines[i].match(ENV_RE)
    if (m && !/^\s*#/.test(lines[i])) env.push({ name: m[1], value: m[2].trim(), raw: lines[i] })
  }

  return { lines, header: { env, endLine: headerEnd }, jobs, unparsed }
}

export function serializeCrontab(doc: ParsedCrontab): string {
  return doc.lines.join('\n')
}

/** 渲染任务行(编辑写回用;canonical 单空格格式);logPath 由调用方按 id 解析 */
export function renderJobLine(job: CronJob, logPath: string): string {
  const withUser = job.system ? `${job.expr} ${job.user}` : job.expr
  const body = job.log ? `( ${job.cmd} ) >> ${logPath} 2>&1` : job.cmd
  const line = `${withUser} ${body}`
  return job.enabled ? line : `${DISABLED_PREFIX}${line}`
}

export function renderDescLine(desc: string): string {
  return `# ${desc}`
}

/** 头部块的原文(供文件头面板编辑) */
export function headerRawOf(doc: ParsedCrontab): string {
  return doc.lines.slice(0, doc.header.endLine).join('\n')
}

/** 替换头部块(保留其余行原样) */
export function replaceHeader(doc: ParsedCrontab, newHeaderText: string): string[] {
  const rest = doc.lines.slice(doc.header.endLine)
  const head = newHeaderText === '' ? [] : newHeaderText.split('\n')
  return [...head, ...rest]
}
