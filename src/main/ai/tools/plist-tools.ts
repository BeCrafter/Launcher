// plist 类工具:读取 / 校验 / 生成草稿 / 写入 / 装卸
//
// 写入刻意走 PlistService(带作用域路径围栏 + 提权),而不是编辑器那条 CAS 通道:
// 编辑器的 revision/CAS 是给「人对着文档改」设计的;AI 生成的是整份新文件,没有可比对的旧版本。
// 但覆盖守卫照旧 —— 目标已存在时一律要求显式 overwrite,不静默清掉别人的文件。
import type { AgentScope } from '../../../shared/models'
import { Type } from '@earendil-works/pi-ai'
import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { parsePlistXml, toPlistXml, type PlistDict, type PlistValue } from '../../domains/plist-xml'
import { assertValidAgentLabel } from '../../domains/agent-label'
import type { AgentService } from '../../services/agent-service'
import type { PlistService } from '../../services/plist-service'
import type { ProcessDiscovery } from '../../services/process-discovery'
import { matchBrewService, type BrewAgentService } from '../../services/brew-agent-service'
import type { ToolDef, ToolOutputLine } from '../tool-types'
import { agentLine, cap, line, locateAgent, omittedLine, scopeLabel, SCOPES } from './shared'

/** 摘要里最值得先看的键(launchd 语义上决定「跑什么、何时跑、怎么活」) */
const KEY_ORDER = [
  'Label', 'Program', 'ProgramArguments', 'RunAtLoad', 'KeepAlive', 'StartInterval',
  'StartCalendarInterval', 'WatchPaths', 'WorkingDirectory', 'StandardOutPath', 'StandardErrorPath',
  'EnvironmentVariables', 'ProcessType', 'ThrottleInterval', 'Disabled', 'UserName'
]

function brief(v: PlistValue): string {
  if (Array.isArray(v)) return `[${v.map((x) => brief(x)).join(', ')}]`
  if (v !== null && typeof v === 'object') return `{${Object.keys(v).join(', ')}}`
  return String(v)
}

/** 字典 → 可读行:已知键按语义顺序在前,其余键补在后面(不丢键,但也不喧宾夺主) */
function dictLines(value: PlistDict, maxKeys = 24): ToolOutputLine[] {
  const known = KEY_ORDER.filter((k) => k in value)
  const rest = Object.keys(value).filter((k) => !KEY_ORDER.includes(k))
  const out: ToolOutputLine[] = known.map((k) => line('', `  ${k} = ${brief(value[k])}`))
  const { shown, omitted } = cap(rest, Math.max(0, maxKeys - known.length))
  out.push(...shown.map((k) => line('', `  ${k} = ${brief(value[k])}`)))
  out.push(...omittedLine(omitted))
  return out
}

/** 从 XML 里取 Label(生成/写入两处都要用它做身份校验) */
function labelOf(xml: string): string | null {
  const parsed = parsePlistXml(xml)
  if (!parsed.ok) return null
  const v = parsed.value['Label']
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

export function createPlistTools(deps: {
  agents: AgentService
  plists: PlistService
  discovery: ProcessDiscovery
  brew: BrewAgentService
  getXmlIndent: () => string
}): ToolDef[] {
  /**
   * `~` 展开的 home 从 plists.dirs() 反推,而不是读 process.env.HOME ——
   * 两者在异常环境(如 GUI 启动、HOME 被改写)下会不一致,那时"路径不在 launchd 目录内"
   * 就会把用户自己的 plist 拒之门外。目录列表是这套代码里的权威来源。
   */
  const homeDir = (): string => {
    const userDir = deps.plists.dirs().find((d) => d.scope === 'user')?.dir ?? ''
    return userDir.replace(/\/Library\/LaunchAgents$/, '')
  }

  /** plist 里的路径必须写成绝对路径:launchd 不展开 ~,这里只负责把用户输入里的 ~ 展开后再校验 */
  const expandHome = (p: string): string => (p === '~' ? homeDir() : p.startsWith('~/') ? `${homeDir()}${p.slice(1)}` : p)

  const isDirectory = (p: string): boolean => {
    try {
      return statSync(p).isDirectory()
    } catch {
      return false
    }
  }

  /** 把 target 解析成「要读哪些文件」:label / 绝对或 ~ 路径 / launchd 目录下的通配 */
  async function resolveTargets(target: string): Promise<
    { kind: 'files'; files: { scope: AgentScope; path: string }[] } | { kind: 'error'; message: string }
  > {
    const dirs = deps.plists.dirs()
    const expand = (p: string): string => (p.startsWith('~/') ? `${homeDir()}${p.slice(1)}` : p)

    if (target.includes('/')) {
      const abs = expand(target)
      const isGlob = abs.endsWith('/*') || abs.endsWith('*')
      const dir = isGlob ? abs.replace(/\/?\*$/, '') : abs.replace(/\/[^/]+$/, '')
      const scope = dirs.find((d) => d.dir === dir)?.scope
      if (!scope) {
        return { kind: 'error', message: `路径不在 launchd 目录内（只支持 ${dirs.map((d) => d.dir).join(' / ')}）：${target}` }
      }
      if (!isGlob) return { kind: 'files', files: [{ scope, path: abs }] }
      const files = (await deps.plists.scanAll())
        .filter((f) => f.scope === scope)
        .map((f) => ({ scope, path: f.path }))
      return { kind: 'files', files }
    }

    const lookup = await locateAgent(deps.agents, target)
    if (lookup.kind === 'not-found') return { kind: 'error', message: lookup.message }
    if (lookup.kind === 'ambiguous') {
      return { kind: 'error', message: `${target} 在多个作用域下都存在（${lookup.hits.map((h) => h.scope).join('、')}），请用 read_plist 传路径或先指明 scope` }
    }
    const { agent, scope } = lookup.hit
    if (agent.isNotTask || agent.parseError) {
      return { kind: 'error', message: `${target} 不是可读的 launchd 任务（${agent.isNotTask ? '非任务文件' : agent.parseError}）` }
    }
    return { kind: 'files', files: [{ scope, path: deps.plists.pathFor(scope, agent.label) }] }
  }

  return [
    {
      name: 'read_plist',
      label: '读取 plist',
      description:
        '读取 launchd plist 的配置内容。target 可以是任务的 Label、plist 的绝对/~ 路径,或 launchd 目录下的通配(如 ~/Library/LaunchAgents/*)。',
      parameters: Type.Object({
        target: Type.String({ description: 'Label / plist 路径 / 目录通配' })
      }),
      write: false,
      execute: async (args) => {
        const target = String(args['target'] ?? '').trim()
        if (target === '') return { lines: [line('err', '缺少 target')], isError: true }
        const resolved = await resolveTargets(target)
        if (resolved.kind === 'error') return { lines: [line('err', resolved.message)], isError: true }
        const { shown, omitted } = cap(resolved.files, 10)
        const out: ToolOutputLine[] = []
        for (const f of shown) {
          try {
            const pf = await deps.plists.readFresh(f.scope, f.path)
            out.push(line('', `${f.path}（${f.scope}）`))
            if (pf.isTask) {
              // Label 不单独打一行 —— dictLines 的 KEY_ORDER 首位就是它,否则会打印两次
              out.push(...dictLines(pf.value))
            } else if (pf.parseError) {
              out.push(line('err', `  无法解析：${pf.parseError}（这是损坏文件，需要按 XML 修复）`))
            } else {
              out.push(line('warn', '  非任务文件：plist 未定义 Label，launchd 会忽略它'))
              out.push(...dictLines(pf.value, 4))
            }
          } catch (err) {
            out.push(line('err', `  ${f.path} 读取失败：${err instanceof Error ? err.message : String(err)}`))
          }
        }
        out.push(...omittedLine(omitted))
        return { lines: out }
      }
    },

    {
      name: 'validate_plist',
      label: '校验 plist',
      description: '用 plutil -lint 校验 plist XML 是否合法。生成或修改 plist 后必须用它确认,不要凭格式目测。',
      parameters: Type.Object({ xml: Type.String({ description: '完整的 plist XML 文本' }) }),
      write: false,
      execute: async (args) => {
        const xml = String(args['xml'] ?? '')
        const r = await deps.agents.validateXml(xml)
        if (r.ok) {
          const label = labelOf(xml)
          return { lines: [line('ok', `plutil -lint 通过${label ? `（Label = ${label}）` : '（注意：没有 Label，launchd 不会加载它）'}`)] }
        }
        return { lines: [line('err', `plutil -lint 失败：${r.error ?? '未知错误'}`)], isError: true }
      }
    },

    {
      name: 'prepare_agent',
      label: '准备 Agent 创建计划',
      description:
        '只读预检并生成 Agent 创建计划：检查程序、工作目录、同名任务、日志默认路径与可选端口占用，返回风险、待确认事项和应用后的验证步骤。不会写入、建目录、载入或启动任务。',
      parameters: Type.Object({
        label: Type.String({ description: '任务 Label，如 com.user.my-service' }),
        scope: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('system'), Type.Literal('daemon')])),
        program: Type.String({ description: '可执行文件绝对路径' }),
        args: Type.Optional(Type.Array(Type.String())),
        workingDirectory: Type.Optional(Type.String()),
        runAtLoad: Type.Optional(Type.Boolean()),
        keepAlive: Type.Optional(Type.Boolean()),
        startInterval: Type.Optional(Type.Number()),
        calendar: Type.Optional(Type.Array(Type.Object({}))),
        watchPaths: Type.Optional(Type.Array(Type.String())),
        logs: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('none')])),
        logDir: Type.Optional(Type.String()),
        stdout: Type.Optional(Type.String()),
        stderr: Type.Optional(Type.String()),
        port: Type.Optional(Type.Number({ description: '服务预期监听端口；传入后检查是否已被占用' }))
      }),
      write: false,
      execute: async (args) => {
        const label = String(args['label'] ?? '').trim()
        const scopeRaw = args['scope']
        const scope: AgentScope = scopeRaw === 'system' || scopeRaw === 'daemon' ? scopeRaw : 'user'
        const risks: string[] = []
        const questions: string[] = []
        const verification: string[] = []
        let blocked = false
        try {
          assertValidAgentLabel(label)
        } catch (err) {
          return { lines: [line('err', `Label 不合法：${err instanceof Error ? err.message : String(err)}`)], isError: true, cardOnly: true }
        }

        const program = expandHome(String(args['program'] ?? '').trim())
        if (!isAbsolute(program) || !existsSync(program) || isDirectory(program)) {
          const reason = !isAbsolute(program) ? '必须是绝对路径' : !existsSync(program) ? '文件不存在' : '指向的是目录'
          return { lines: [line('err', `program 无法使用：${program}（${reason}）`)], isError: true, cardOnly: true }
        }
        try {
          accessSync(program, constants.X_OK)
        } catch {
          return { lines: [line('err', `program 不可执行：${program}`)], isError: true, cardOnly: true }
        }

        const workRaw = String(args['workingDirectory'] ?? '').trim()
        const workingDirectory = workRaw === '' ? '' : expandHome(workRaw)
        if (workingDirectory !== '' && (!isAbsolute(workingDirectory) || !isDirectory(workingDirectory))) {
          return { lines: [line('err', `workingDirectory 不存在、不是目录或不是绝对路径：${workingDirectory}`)], isError: true, cardOnly: true }
        }

        const logsMode = args['logs'] === 'none' ? 'none' : 'auto'
        const requestedLogDir = String(args['logDir'] ?? '').trim()
        const baseLogDir = requestedLogDir !== ''
          ? expandHome(requestedLogDir)
          : logsMode === 'auto'
            ? scope === 'user' ? `${homeDir()}/Library/Logs/${label}` : `/Library/Logs/${label}`
            : ''
        const stdout = String(args['stdout'] ?? '').trim() || (baseLogDir !== '' ? `${baseLogDir}/stdout.log` : '')
        const stderr = String(args['stderr'] ?? '').trim() || (baseLogDir !== '' ? `${baseLogDir}/stderr.log` : '')
        if (logsMode === 'none') risks.push('按 logs=none 不自动配置日志；自动验证只能读取运行状态，除非后续显式提供日志路径')
        else risks.push(`默认日志将写入 ${stdout} / ${stderr}（写入阶段才会创建 user 目录）`)

        const hasKeepAlive = args['keepAlive'] === true
        const hasInterval = typeof args['startInterval'] === 'number'
        const hasCalendar = Array.isArray(args['calendar']) && args['calendar'].length > 0
        const hasWatch = Array.isArray(args['watchPaths']) && args['watchPaths'].length > 0
        const trigger = hasKeepAlive
          ? 'KeepAlive 常驻服务'
          : args['runAtLoad'] === true && !hasInterval && !hasCalendar && !hasWatch
            ? 'RunAtLoad 一次性任务'
            : hasInterval
              ? `StartInterval ${Math.trunc(Number(args['startInterval']))}s`
              : hasCalendar
                ? 'StartCalendarInterval 定时任务'
                : hasWatch
                  ? 'WatchPaths 监视任务'
                  : '仅手动启动'
        if (hasKeepAlive && (hasInterval || hasCalendar || hasWatch)) risks.push('KeepAlive 与定时/监视触发同时存在，任务已运行时不会再创建额外实例')
        if (hasKeepAlive) verification.push('确认任务保持 running；检查 pid、exit code 与 stderr 日志')
        else if (hasInterval || hasCalendar || hasWatch) verification.push('确认触发规则与日志；等待触发期间未运行是正常状态')
        else verification.push('确认本次运行的 exit code 为 0；完成后未运行是正常状态')
        verification.push('写入并载入后读取任务状态与最近日志')

        const agents = (await deps.agents.list()).agents
        const same = agents.filter((a) => a.label === label && !a.isNotTask)
        const local = same.find((a) => a.scope === scope)
        if (local?.isBrew) {
          blocked = true
          risks.push('目标由 Homebrew 管理，不能手工改写 plist；请使用 brew services')
        } else if (local) {
          blocked = true
          questions.push(`当前 ${scope} 作用域已存在同名任务：选择覆盖、改 Label 或取消`)
        }
        for (const hit of same.filter((a) => a.scope !== scope)) {
          risks.push(`Label 同时存在于 ${hit.scope} 作用域；后续状态/日志查询必须带 scope`)
        }

        let portCard: { value: number; state: 'free' | 'occupied'; detail: string } | undefined
        if (args['port'] !== undefined) {
          const port = Number(args['port'])
          if (!Number.isInteger(port) || port < 1 || port > 65535) {
            return { lines: [line('err', `port 必须是 1–65535 的整数：${String(args['port'])}`)], isError: true, cardOnly: true }
          }
          const scan = await deps.discovery.scanOnce()
          const hit = scan.services.find((s) => s.port === port)
          portCard = hit
            ? { value: port, state: 'occupied', detail: `已被 ${hit.name || hit.cmd || '未知进程'}（pid ${hit.pid ?? '—'}）占用` }
            : { value: port, state: 'free', detail: '当前空闲' }
          if (hit) {
            blocked = true
            questions.push(`端口 ${port} 已占用：选择停止旧进程、换端口或取消`)
          } else verification.push(`确认端口 ${port} 已监听，且 pid 与任务状态一致`)
        } else questions.push('若这是 HTTP/TCP 服务，请确认预期监听端口以便载入前后验证')

        const command = [program, ...(Array.isArray(args['args']) ? args['args'].map(String) : [])].join(' ')
        const card = {
          kind: 'agentPreparation' as const,
          readiness: blocked ? 'blocked' as const : 'ready' as const,
          label,
          scope,
          command,
          trigger,
          logs: [stdout, stderr].filter((p) => p !== ''),
          ...(portCard ? { port: portCard } : {}),
          risks,
          questions,
          verification
        }
        const lines: ToolOutputLine[] = [
          line(blocked ? 'warn' : 'ok', blocked ? '创建计划需要先处理冲突/确认项；尚未写入任何内容' : '创建计划已就绪；尚未写入任何内容'),
          line('', `目标 ${label}（${scope}） · ${trigger}`),
          line('', `命令 ${command}`),
          ...risks.map((text) => line('warn', text)),
          ...questions.map((text) => line('info', text)),
          ...verification.map((text) => line('', `应用后：${text}`))
        ]
        return { lines, card, cardOnly: true, isError: false }
      }
    },

    {
      name: 'generate_plist',
      label: '生成 plist 草稿',
      description:
        '根据参数生成一份 launchd plist 草稿并自动校验。**只产出文本，不写任何文件**；用户确认后再用 write_plist 落盘。',
      parameters: Type.Object({
        label: Type.String({ description: '任务 Label，如 com.user.backup-nightly' }),
        desc: Type.Optional(Type.String({ description: '任务说明（写入 plist 注释，与页面「描述」一致）' })),
        scope: Type.Optional(
          Type.Union([Type.Literal('user'), Type.Literal('system'), Type.Literal('daemon')], {
            description: '任务作用域（默认 user）；用于派生默认日志目录与 UserName 校验'
          })
        ),
        logs: Type.Optional(
          Type.Union([Type.Literal('auto'), Type.Literal('none')], {
            description:
              'auto（默认）= 未显式给日志路径时按 scope 派生默认目录；none = 不配置日志（程序自己管理日志时用）'
          })
        ),
        program: Type.String({ description: '可执行文件绝对路径' }),
        args: Type.Optional(Type.Array(Type.String(), { description: '传给程序的参数（不含程序本身）' })),
        runAtLoad: Type.Optional(Type.Boolean({ description: '载入后立即运行一次' })),
        keepAlive: Type.Optional(Type.Boolean({ description: '保持存活（退出后自动重拉）；程序启动即退出时会形成重启循环，慎用' })),
        keepAliveDict: Type.Optional(
          Type.Object(
            {
              crashed: Type.Optional(Type.Boolean()),
              successfulExit: Type.Optional(Type.Boolean())
            },
            { description: 'KeepAlive 字典形态（与 keepAlive=true 互斥）；false 是合法的反向条件，未传的子键不写' }
          )
        ),
        startInterval: Type.Optional(Type.Number({ description: '每隔多少秒运行一次' })),
        calendar: Type.Optional(
          Type.Array(
            Type.Object({
              Minute: Type.Optional(Type.Number({ description: '0–59' })),
              Hour: Type.Optional(Type.Number({ description: '0–23' })),
              Weekday: Type.Optional(Type.Number({ description: '0 或 7 = 周日，1 = 周一 …' })),
              Day: Type.Optional(Type.Number({ description: '1–31' })),
              Month: Type.Optional(Type.Number({ description: '1–12' }))
            }),
            { description: 'StartCalendarInterval；可多条。键名与 launchd / 页面表单一致（大写开头）' }
          )
        ),
        watchPaths: Type.Optional(
          Type.Array(Type.String(), { description: 'WatchPaths：监听这些路径，有变化时启动任务（与 KeepAlive 同时存在时任务可能已在运行）' })
        ),
        workingDirectory: Type.Optional(Type.String()),
        userName: Type.Optional(
          Type.String({ description: 'UserName：仅 daemon 作用域生效；运行身份（不能含空白或控制字符）' })
        ),
        nice: Type.Optional(Type.Number({ description: 'Nice：进程优先级 -20~20（launchd 默认 0，0 不写键）' })),
        logDir: Type.Optional(
          Type.String({
            description:
              '日志目录（绝对路径或 ~/…）。会自动写 StandardOutPath=<dir>/stdout.log、StandardErrorPath=<dir>/stderr.log；stdout/stderr 显式传入时以显式值为准'
          })
        ),
        stdout: Type.Optional(Type.String({ description: '标准输出重定向到的绝对路径（launchd 不展开 ~，工具会先展开）' })),
        stderr: Type.Optional(Type.String({ description: '标准错误重定向到的绝对路径；启动失败/崩溃栈通常在这里' })),
        env: Type.Optional(
          Type.Record(Type.String(), Type.String(), {
            description:
              '环境变量。launchd 不加载 shell 配置(~/.zshrc 等):程序内部会调用外部命令(node/go 等)时,必须在此显式写入 PATH,否则找不到命令'
          })
        ),
        processType: Type.Optional(Type.String({ description: 'Background / Standard / Interactive / Adaptive' })),
        throttleInterval: Type.Optional(Type.Number({ description: '两次启动的最小间隔秒数' }))
      }),
      write: false,
      execute: async (args) => {
        const label = String(args['label'] ?? '').trim()
        try {
          assertValidAgentLabel(label)
        } catch (err) {
          return { lines: [line('err', `Label 不合法：${err instanceof Error ? err.message : String(err)}`)], isError: true }
        }
        const warnings: string[] = []
        const desc = String(args['desc'] ?? '').trim()
        const scopeRaw = args['scope']
        const scope: AgentScope | null =
          scopeRaw === 'user' || scopeRaw === 'system' || scopeRaw === 'daemon' ? scopeRaw : null
        if (scopeRaw !== undefined && scope === null) {
          return { lines: [line('err', `未知作用域 ${String(scopeRaw)}`)], isError: true }
        }
        const programRaw = String(args['program'] ?? '').trim()
        if (programRaw === '') return { lines: [line('err', '缺少 program（可执行文件路径）')], isError: true }
        const program = expandHome(programRaw)
        if (!isAbsolute(program)) {
          return { lines: [line('err', 'program 必须是绝对路径（launchd 不解析 PATH）')], isError: true }
        }
        if (!existsSync(program)) {
          return { lines: [line('err', `program 不存在：${program}（launchd 不会替你解析 PATH）`)], isError: true }
        }
        if (isDirectory(program)) {
          return { lines: [line('err', `program 指向的是目录：${program}`)], isError: true }
        }
        try {
          accessSync(program, constants.X_OK)
        } catch {
          return { lines: [line('err', `program 不可执行：${program}（检查 chmod +x）`)], isError: true }
        }
        // 脚本的 shebang 解释器同样不能依赖 PATH;readFileSync 失败(二进制/权限)不阻断,交给运行时
        try {
          const head = readFileSync(program, { encoding: 'utf8' }).slice(0, 512)
          if (head.startsWith('#!')) {
            const interp = head.slice(2).trim().split(/\s+/)[0] ?? ''
            if (interp !== '' && !isAbsolute(interp)) {
              warnings.push(`脚本 shebang 的解释器不是绝对路径（${interp}）：launchd 不会解析 PATH`)
            } else if (interp !== '' && !existsSync(interp)) {
              warnings.push(`脚本 shebang 的解释器不存在：${interp}`)
            }
          }
        } catch {
          /* 读不了就不阻断:二进制或权限问题留给运行时 */
        }

        // 包装器 / 版本管理器 / shell 形态的预检:这些写法在 launchd 的干净环境里最容易失效
        const programBase = program.split('/').pop() ?? ''
        const argList = Array.isArray(args['args']) ? (args['args'] as unknown[]).map(String) : []
        if (programBase === 'env') {
          warnings.push('program 是 env:它仍会用 process PATH 解析后面的命令;launchd 的 PATH 很短,建议直接写真实二进制的绝对路径')
        }
        if (['sh', 'bash', 'zsh'].includes(programBase) && argList.some((a) => /^-l?c$/.test(a))) {
          warnings.push('shell -c/-lc 会依赖 shell 环境;建议把命令写进一个带 exec 的 wrapper 脚本,再让 plist 调 wrapper')
        }
        if (['npm', 'npx', 'yarn', 'pnpm'].includes(programBase)) {
          warnings.push('包管理器启动会经过 shell/PATH;长期运行建议还原成 node + 真实入口文件,或先 build 后运行二进制')
        }
        if (programBase === 'go' && argList[0] === 'run') {
          warnings.push('go run 每次启动都会重新编译,且 launchd 跟踪的是 go 进程;长期运行建议 go build 后运行二进制')
        }

        const workingDirectoryRaw = String(args['workingDirectory'] ?? '').trim()
        const workingDirectory = workingDirectoryRaw === '' ? '' : expandHome(workingDirectoryRaw)
        if (workingDirectory !== '') {
          if (!isAbsolute(workingDirectory)) {
            return { lines: [line('err', 'workingDirectory 必须是绝对路径')], isError: true }
          }
          if (!isDirectory(workingDirectory)) {
            return { lines: [line('err', `workingDirectory 不存在或不是目录：${workingDirectory}`)], isError: true }
          }
        }

        // 日志:logDir / stdout / stderr 显式优先;否则 scope 可用时按作用域派生默认目录。
        const logsMode = args['logs'] === 'none' ? 'none' : 'auto'
        const logDirRaw = String(args['logDir'] ?? '').trim()
        const stdoutRaw = String(args['stdout'] ?? '').trim()
        const stderrRaw = String(args['stderr'] ?? '').trim()
        const hasExplicitLogs = logDirRaw !== '' || stdoutRaw !== '' || stderrRaw !== ''
        let autoLogs = false
        let logDir = logDirRaw === '' ? '' : expandHome(logDirRaw)
        if (logsMode === 'auto' && !hasExplicitLogs && scope !== null) {
          logDir = scope === 'user' ? `${homeDir()}/Library/Logs/${label}` : `/Library/Logs/${label}`
          autoLogs = true
        }
        if (logDir !== '' && !isAbsolute(logDir)) {
          return { lines: [line('err', 'logDir 必须是绝对路径或 ~/…')], isError: true }
        }
        if (autoLogs) {
          warnings.push(`已按 ${scope} 派生默认日志目录 ${logDir}；若程序自己管理日志，请传 logs='none' 重新生成`)
        }
        const stdout = stdoutRaw !== '' ? expandHome(stdoutRaw) : logDir !== '' ? `${logDir}/stdout.log` : ''
        const stderr = stderrRaw !== '' ? expandHome(stderrRaw) : logDir !== '' ? `${logDir}/stderr.log` : ''
        for (const [name, p] of [
          ['stdout', stdout],
          ['stderr', stderr]
        ] as const) {
          if (p === '') continue
          if (!isAbsolute(p)) return { lines: [line('err', `${name} 必须是绝对路径（launchd 不展开 ~）`)], isError: true }
          if (isDirectory(p)) return { lines: [line('err', `${name} 指向的是目录：${p}`)], isError: true }
        }
        if (stdout !== '' && stdout === stderr) {
          return { lines: [line('err', 'stdout 与 stderr 不能是同一个文件（会互相覆盖/交错）')], isError: true }
        }

        if (stdout === '' && stderr === '') {
          if (logsMode === 'none') {
            warnings.push('按 logs=none 跳过日志配置：自动验证只能看运行状态；请把程序自己的日志路径告诉用户')
          } else {
            warnings.push(
              '未配置日志路径：自动验证将拿不到文件日志；传 scope 可按作用域派生默认目录，或显式传 logDir / stdout / stderr'
            )
          }
        }
        const logDirs = new Set<string>()
        if (logDir !== '') logDirs.add(logDir)
        for (const p of [stdout, stderr]) if (p !== '') logDirs.add(dirname(p))
        for (const dir of logDirs) {
          if (!existsSync(dir)) {
            warnings.push(`日志目录不存在：${dir}（launchd 会尝试创建；权限不足时任务会启动失败，建议先建好）`)
          }
        }
        if (scope === 'user') {
          for (const p of [stdout, stderr]) {
            if (p !== '' && !p.startsWith(`${homeDir()}/Library/Logs/`) && !p.startsWith('/tmp/')) {
              warnings.push(`user 作用域的日志路径不在 ~/Library/Logs 下：${p}（确认当前用户可写）`)
            }
          }
        } else if (scope === 'system' || scope === 'daemon') {
          for (const p of [stdout, stderr]) {
            if (p !== '' && p.startsWith(`${homeDir()}/Library/Logs/`)) {
              warnings.push(`system/daemon 使用用户 home 下的日志目录：${p}（运行身份可能不同，确认属主/可写）`)
            }
          }
        }

        const processType = String(args['processType'] ?? '').trim()
        if (processType !== '' && !['Background', 'Standard', 'Interactive', 'Adaptive'].includes(processType)) {
          return {
            lines: [line('err', `processType 不合法：${processType}（可选 Background / Standard / Interactive / Adaptive）`)],
            isError: true
          }
        }

        const startInterval =
          typeof args['startInterval'] === 'number' ? Math.max(1, Math.trunc(args['startInterval'])) : null
        if (startInterval !== null && startInterval < 10) {
          warnings.push('StartInterval < 10 秒会被 launchd 提升到 10 秒')
        }

        const CAL_KEYS = ['Minute', 'Hour', 'Day', 'Weekday', 'Month'] as const
        const CAL_RANGES: Record<(typeof CAL_KEYS)[number], [number, number]> = {
          Minute: [0, 59],
          Hour: [0, 23],
          Day: [1, 31],
          Weekday: [0, 7], // 0 与 7 都是周日
          Month: [1, 12]
        }
        const calendarRaw = Array.isArray(args['calendar']) ? (args['calendar'] as Record<string, unknown>[]) : []
        const calendar: PlistDict[] = []
        for (const c of calendarRaw) {
          const entry: PlistDict = {}
          for (const [rawKey, rawVal] of Object.entries(c)) {
            // 兼容模型可能写的小写键;存储时统一成 launchd / 页面表单的大写形态
            const key = CAL_KEYS.find((k) => k.toLowerCase() === rawKey.toLowerCase())
            if (key === undefined) {
              return { lines: [line('err', `calendar 不支持的字段：${rawKey}（可用 ${CAL_KEYS.join(' / ')}）`)], isError: true }
            }
            if (rawVal === undefined) continue
            const [min, max] = CAL_RANGES[key]
            if (typeof rawVal !== 'number' || !Number.isFinite(rawVal) || !Number.isInteger(rawVal) || rawVal < min || rawVal > max) {
              return { lines: [line('err', `calendar.${key} 取值不合法：${String(rawVal)}（应在 ${min}–${max} 之间）`)], isError: true }
            }
            entry[key] = rawVal
          }
          // 空条目 = 每分钟触发;新建时不允许隐式生成(页面在新建确认框里也会拦)
          if (Object.keys(entry).length === 0) {
            return { lines: [line('err', 'calendar 条目不能为空（空字典 = 每分钟触发）')], isError: true }
          }
          calendar.push(entry)
        }

        const watchPathsRaw = args['watchPaths']
        const watchPaths = Array.isArray(watchPathsRaw)
          ? watchPathsRaw.map((p) => String(p).trim()).filter((p) => p !== '')
          : []
        if (Array.isArray(watchPathsRaw) && watchPaths.length === 0) {
          warnings.push('watchPaths 传了但没有有效路径,已忽略')
        }
        for (const p of watchPaths) {
          if (!isAbsolute(p)) warnings.push(`WatchPaths 建议使用绝对路径：${p}`)
        }

        const niceRaw = args['nice']
        let nice: number | null = null
        if (niceRaw !== undefined) {
          if (typeof niceRaw !== 'number' || !Number.isInteger(niceRaw) || niceRaw < -20 || niceRaw > 20) {
            return { lines: [line('err', `Nice 必须是 -20~20 的整数：${String(niceRaw)}`)], isError: true }
          }
          nice = niceRaw
        }

        const userName = String(args['userName'] ?? '').trim()
        if (userName !== '' && /[\s\x00-\x1f]/.test(userName)) {
          return { lines: [line('err', 'UserName 不能包含空白或控制字符')], isError: true }
        }

        const dict: PlistDict = { Label: label }
        // argv 规范形态 = ProgramArguments[0] 是可执行文件本身;单独写 Program + -c 会被 launchd 当程序名
        const argv = [program, ...(Array.isArray(args['args']) ? (args['args'] as string[]).map(String) : [])]
        dict['ProgramArguments'] = argv.length > 1 ? argv : [program]
        if (args['runAtLoad'] === true) dict['RunAtLoad'] = true
        const keepAliveDictRaw = args['keepAliveDict']
        let keepAliveDict: PlistDict | null = null
        if (keepAliveDictRaw && typeof keepAliveDictRaw === 'object' && !Array.isArray(keepAliveDictRaw)) {
          const o: PlistDict = {}
          for (const [pageKey, plistKey] of [
            ['crashed', 'Crashed'],
            ['successfulExit', 'SuccessfulExit']
          ] as const) {
            const raw = keepAliveDictRaw as Record<string, unknown>
            // 页面字段名是小写;也接受 launchd 的大写形态,避免模型两种写法只生效一半
            const v = raw[pageKey] ?? raw[plistKey]
            if (typeof v === 'boolean') o[plistKey] = v
          }
          if (Object.keys(o).length > 0) keepAliveDict = o
          else warnings.push('keepAliveDict 没有有效条件（crashed / successfulExit），已忽略')
        }
        if (args['keepAlive'] === true && keepAliveDict !== null) {
          warnings.push('keepAlive 与 keepAliveDict 同时存在：使用字典形态')
        }
        if (keepAliveDict !== null) dict['KeepAlive'] = keepAliveDict
        else if (args['keepAlive'] === true) dict['KeepAlive'] = true
        if (startInterval !== null) dict['StartInterval'] = startInterval
        if (calendar.length > 0) dict['StartCalendarInterval'] = calendar.length === 1 ? calendar[0] : calendar
        if (watchPaths.length > 0) dict['WatchPaths'] = watchPaths
        if (workingDirectory !== '') dict['WorkingDirectory'] = workingDirectory
        if (userName !== '') {
          dict['UserName'] = userName
          if (scope !== 'daemon') {
            warnings.push('UserName 仅 daemon 作用域生效；user/system 作用域会被 launchd 忽略')
          }
        }
        if (nice !== null && nice !== 0) dict['Nice'] = nice
        if (stdout !== '') dict['StandardOutPath'] = stdout
        if (stderr !== '') dict['StandardErrorPath'] = stderr
        if (args['env'] && typeof args['env'] === 'object') dict['EnvironmentVariables'] = { ...(args['env'] as Record<string, string>) }
        if (processType !== '') dict['ProcessType'] = processType
        if (typeof args['throttleInterval'] === 'number') dict['ThrottleInterval'] = Math.max(0, Math.trunc(args['throttleInterval']))

        if (dict['KeepAlive'] && (startInterval !== null || calendar.length > 0 || watchPaths.length > 0)) {
          warnings.push('KeepAlive 与 StartInterval/StartCalendarInterval/WatchPaths 同时存在时,任务保持运行,触发不会创建额外实例')
        }
        if (!dict['RunAtLoad'] && !dict['KeepAlive'] && startInterval === null && calendar.length === 0 && watchPaths.length === 0) {
          warnings.push('没有任何触发条件（RunAtLoad / KeepAlive / StartInterval / StartCalendarInterval / WatchPaths）:载入后不会自动运行')
        }

        const xml = toPlistXml(dict, { indent: deps.getXmlIndent(), ...(desc !== '' ? { desc } : {}) })
        const lint = await deps.agents.validateXml(xml)
        const out: ToolOutputLine[] = []
        if (lint.ok) out.push(line('ok', 'plutil -lint 通过'))
        else out.push(line('err', `plutil -lint 失败：${lint.error ?? ''}（请修正参数后重试）`))
        for (const w of warnings) out.push(line('warn', w))

        out.push(line('', '关键键说明：'))
        out.push(line('', '  ProgramArguments = 可执行文件 + 参数（launchd 直接 exec，不经 shell）'))
        if (dict['RunAtLoad']) out.push(line('', '  RunAtLoad = 载入时立即运行一次'))
        if (dict['KeepAlive']) {
          out.push(
            line(
              'warn',
              typeof dict['KeepAlive'] === 'object'
                ? '  KeepAlive(dict) = 按 Crashed / SuccessfulExit 条件重启；程序启动即失败时可能形成重启循环'
                : '  KeepAlive = 退出后自动重拉；若程序启动即失败会形成重启循环'
            )
          )
        }
        if (dict['StartInterval']) out.push(line('', `  StartInterval = 每 ${dict['StartInterval']} 秒运行一次`))
        if (dict['StartCalendarInterval']) out.push(line('', '  StartCalendarInterval = 按日历定时'))
        if (Array.isArray(dict['WatchPaths'])) {
          out.push(line('', `  WatchPaths = 监听 ${(dict['WatchPaths'] as string[]).join(' / ')}`))
        }
        if (typeof dict['Nice'] === 'number') out.push(line('', `  Nice = 进程优先级 ${dict['Nice']}`))
        if (typeof dict['UserName'] === 'string') out.push(line('', `  UserName = 以 ${dict['UserName']} 身份运行（仅 daemon）`))
        if (dict['StandardOutPath']) out.push(line('', `  StandardOutPath = 输出写入 ${dict['StandardOutPath']}`))
        if (dict['StandardErrorPath']) out.push(line('', `  StandardErrorPath = 错误输出写入 ${dict['StandardErrorPath']}`))

        const card = { kind: 'plist' as const, xml }
        return { lines: [...out, ...omittedLine(0), line('', '草稿未写入磁盘；确认后调用 write_plist'), line('', xml)], card, isError: !lint.ok }
      }
    },

    {
      name: 'write_plist',
      label: '写入 plist',
      description:
        '把 plist 写入 launchd 目录。目标已存在时必须显式 overwrite=true（避免静默覆盖别人的任务）。写入不等于载入,需要生效再调用 load_plist。',
      parameters: Type.Object({
        label: Type.String({ description: '任务 Label，必须与 XML 里的 Label 一致' }),
        xml: Type.String({ description: '完整的 plist XML' }),
        scope: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('system'), Type.Literal('daemon')])),
        overwrite: Type.Optional(Type.Boolean({ description: '目标已存在时是否覆盖' }))
      }),
      write: true,
      summarize: (a) => {
        const scope = (a['scope'] as string | undefined) ?? 'user'
        const label = String(a['label'] ?? '')
        const xml = String(a['xml'] ?? '')
        const parsed = parsePlistXml(xml)
        if (!parsed.ok) {
          return {
            detail: `写入 ${label}.plist 到 ${scope} 作用域（XML 无法解析，执行会被拒绝）`,
            command: `写入 ${label}.plist`,
            dangerous: true
          }
        }
        const v = parsed.value
        const argv = Array.isArray(v['ProgramArguments'])
          ? (v['ProgramArguments'] as unknown[]).map(String)
          : typeof v['Program'] === 'string'
            ? [v['Program']]
            : []
        const triggers: string[] = []
        if (v['RunAtLoad'] === true) triggers.push('RunAtLoad')
        if (v['KeepAlive'] !== undefined) triggers.push('KeepAlive')
        if (typeof v['StartInterval'] === 'number') triggers.push(`StartInterval ${v['StartInterval']}s`)
        if (v['StartCalendarInterval'] !== undefined) triggers.push('StartCalendarInterval')
        if (Array.isArray(v['WatchPaths'])) triggers.push(`WatchPaths ${v['WatchPaths'].length} 个`)
        const logs = [v['StandardOutPath'], v['StandardErrorPath']].filter(
          (p): p is string => typeof p === 'string' && p !== ''
        )
        const outside = logs.some(
          (p) =>
            !p.startsWith(`${homeDir()}/Library/Logs/`) &&
            !p.startsWith('/Library/Logs/') &&
            !p.startsWith('/var/log/')
        )
        const cwd = typeof v['WorkingDirectory'] === 'string' ? v['WorkingDirectory'] : ''
        const runAs = typeof v['UserName'] === 'string' ? v['UserName'] : ''
        const envKeys =
          v['EnvironmentVariables'] && typeof v['EnvironmentVariables'] === 'object' && !Array.isArray(v['EnvironmentVariables'])
            ? Object.keys(v['EnvironmentVariables'] as Record<string, unknown>)
            : []
        return {
          detail:
            `写入 ${label}.plist 到 ${scope} 作用域${a['overwrite'] ? '（覆盖，旧配置会备份为 .bak）' : ''}` +
            ` · 触发：${triggers.length > 0 ? triggers.join(' / ') : '无（仅手动启动）'}` +
            (cwd !== '' ? ` · 工作目录：${cwd}` : '') +
            (runAs !== '' ? ` · 以用户 ${runAs} 运行` : '') +
            (envKeys.length > 0 ? ` · 环境变量：${envKeys.join(', ')}` : '') +
            (logs.length > 0 ? ` · 日志：${logs.join(' / ')}` : ' · 日志：未配置') +
            (outside ? ' · ⚠ 日志路径不在标准目录' : ''),
          command: argv.length > 0 ? argv.join(' ') : `写入 ${label}.plist`,
          dangerous: a['overwrite'] === true || outside || runAs !== ''
        }
      },
      execute: async (args) => {
        const xml = String(args['xml'] ?? '')
        const scope = ((args['scope'] as AgentScope | undefined) ?? 'user') as AgentScope
        if (!SCOPES.includes(scope)) return { lines: [line('err', `未知作用域 ${scope}`)], isError: true }

        const lint = await deps.agents.validateXml(xml)
        if (!lint.ok) return { lines: [line('err', `plist 校验失败：${lint.error ?? ''}`)], isError: true }

        const xmlLabel = labelOf(xml)
        const declared = String(args['label'] ?? '').trim()
        if (!xmlLabel) return { lines: [line('err', 'XML 里没有 Label —— launchd 不会加载这样的任务')], isError: true }
        if (xmlLabel !== declared) {
          return { lines: [line('err', `参数 label（${declared}）与 XML 里的 Label（${xmlLabel}）不一致`)], isError: true }
        }
        try {
          assertValidAgentLabel(xmlLabel)
        } catch (err) {
          return { lines: [line('err', `Label 不合法：${err instanceof Error ? err.message : String(err)}`)], isError: true }
        }

        // 日志路径闸门:launchd 不展开 ~;相对路径/同一文件/目录都会让日志不可用
        const parsed = parsePlistXml(xml)
        if (!parsed.ok) return { lines: [line('err', `plist 无法解析：${parsed.error}`)], isError: true }
        const stdoutPath = typeof parsed.value['StandardOutPath'] === 'string' ? parsed.value['StandardOutPath'] : ''
        const stderrPath = typeof parsed.value['StandardErrorPath'] === 'string' ? parsed.value['StandardErrorPath'] : ''
        for (const [name, p] of [
          ['StandardOutPath', stdoutPath],
          ['StandardErrorPath', stderrPath]
        ] as const) {
          if (p === '') continue
          if (p.startsWith('~') || !isAbsolute(p)) {
            return { lines: [line('err', `${name} 必须是绝对路径（launchd 不展开 ~）：${p}`)], isError: true }
          }
          if (isDirectory(p)) return { lines: [line('err', `${name} 指向的是目录：${p}`)], isError: true }
        }
        if (stdoutPath !== '' && stdoutPath === stderrPath) {
          return { lines: [line('err', 'StandardOutPath 与 StandardErrorPath 不能是同一个文件')], isError: true }
        }
        const logNotes: string[] = []
        const logDirs = new Set(
          [stdoutPath, stderrPath].filter((p) => p !== '').map((p) => dirname(p))
        )
        for (const dir of logDirs) {
          if (scope === 'user') {
            if (!existsSync(dir)) {
              try {
                mkdirSync(dir, { recursive: true, mode: 0o700 })
              } catch (err) {
                return {
                  lines: [line('err', `创建日志目录失败：${dir}（${err instanceof Error ? err.message : String(err)}）`)],
                  isError: true
                }
              }
            }
            try {
              accessSync(dir, constants.W_OK)
            } catch {
              return { lines: [line('err', `日志目录不可写：${dir}`)], isError: true }
            }
          } else if (!existsSync(dir)) {
            logNotes.push(`日志目录不存在：${dir}（launchd 会尝试以 root 创建；应用可能无法读取）`)
          }
        }

        const path = deps.plists.pathFor(scope, xmlLabel)
        const existing = (await deps.plists.scanNow()).find((f) => f.path === path)
        // Homebrew 管理的 plist 不能手工改写:下次 brew 操作会覆盖,而且 brew 的启停路由会和应用打架
        let isBrew = false
        try {
          const [listed, brewServices] = await Promise.all([deps.agents.list(), deps.brew.list()])
          const agent = listed.agents.find((a) => a.scope === scope && a.label === xmlLabel)
          const existingProgram = agent?.program ?? ''
          // 优先按 brew --json 的 file 精确匹配:自定义 Label 的 brew 服务也必须受保护。
          isBrew =
            agent?.isBrew === true ||
            matchBrewService(xmlLabel, existingProgram, brewServices, path) !== null
        } catch {
          /* brew 清单读取失败不阻断本地写入;常规列表启发式守卫仍尽力可用 */
        }
        if (isBrew) {
          return {
            lines: [
              line('err', `${xmlLabel} 由 Homebrew 管理：请用 brew services start/stop,不要手工改写 plist`),
              line('warn', '下次 brew 操作会覆盖这份配置；如需纳入 Launcher 管理,先与用户确认 brew 的生命周期归属')
            ],
            isError: true
          }
        }
        let backupPath = ''
        let wroteWithBackup = false
        if (existing) {
          // 覆盖守卫:只允许覆盖「同名任务自身」;占位/损坏文件一律拒绝(它们属于别人,不能静默清掉)
          const sameTask = existing.isTask && existing.label === xmlLabel
          if (!sameTask) {
            return {
              lines: [
                line('err', `${path} 已存在，但它不是同名任务${existing.isTask ? `（Label = ${existing.label}）` : existing.parseError ? '（损坏文件）' : '（无 Label 的占位文件）'}`),
                line('warn', '为避免静默清掉别人的文件，请先人工确认该文件可删除')
              ],
              isError: true
            }
          }
          if (args['overwrite'] !== true) {
            return {
              lines: [line('warn', `${xmlLabel} 已存在于 ${scope} 作用域；如需替换请带 overwrite=true`)],
              isError: true
            }
          }
          // 覆盖前留一份 .bak:载入失败时 AI 可以 read_plist → write_plist 恢复旧配置。
          // 备份失败就中止覆盖 —— 不留「新配置坏掉、旧配置也没了」的状态。
          // 特权作用域用 writeWithBackup 把备份与主写入合并成一次提权(只弹一次授权)。
          if (existing.xml !== '') {
            backupPath = `${path}.bak`
            try {
              await deps.plists.writeWithBackup(scope, path, xml, backupPath, existing.xml)
              wroteWithBackup = true
            } catch (err) {
              return {
                lines: [
                  line('err', `备份/覆盖失败，已中止：${err instanceof Error ? err.message : String(err)}`),
                  line('warn', `旧配置仍在 ${path}，可先排查失败原因再重试`)
                ],
                isError: true
              }
            }
          } else {
            logNotes.push('旧 plist 原文为空，未能生成 .bak 备份')
          }
        }

        if (!wroteWithBackup) {
          try {
            await deps.plists.write(scope, path, xml)
          } catch (err) {
            return { lines: [line('err', `写入失败：${err instanceof Error ? err.message : String(err)}`)], isError: true }
          }
        }
        return {
          lines: [
            line('ok', `已写入 ${path}${existing ? '（覆盖）' : ''}`),
            ...(backupPath !== '' ? [line('', `旧配置已备份到 ${backupPath}；载入失败时可据此恢复`)] : []),
            ...logNotes.map((n) => line('warn', n)),
            line('', '写入后尚未载入；要让它生效请调用 load_plist')
          ]
        }
      }
    },

    {
      name: 'load_plist',
      label: '载入任务',
      description:
        '把 plist 载入 launchd（必要时先启用被停用的覆盖位）。**已载入的任务会先卸载再载入**，确保 launchd 读取磁盘上的最新配置。RunAtLoad 任务会立即运行；StartInterval / StartCalendarInterval / WatchPaths 任务按计划等待；仅手动任务会立即运行一次。',
      parameters: Type.Object({
        label: Type.String(),
        scope: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('system'), Type.Literal('daemon')]))
      }),
      write: true,
      summarize: (a) => ({
        detail: `载入 ${String(a['label'] ?? '')} 到 launchd（已载入时先卸载再载入；RunAtLoad 立即运行，定时/监视任务按计划等待，仅手动任务立即运行一次）`,
        command: `launchctl bootout <domain>/${String(a['label'] ?? '')}; launchctl bootstrap <domain> ${String(a['label'] ?? '')}.plist`
      }),
      execute: async (args) => {
        const label = String(args['label'] ?? '').trim()
        const lookup = await locateAgent(deps.agents, label, args['scope'] as never)
        if (lookup.kind === 'not-found') return { lines: [line('err', lookup.message)], isError: true }
        if (lookup.kind === 'ambiguous') {
          return { lines: [line('warn', `${label} 在多个作用域下都存在，请指明 scope`), ...lookup.hits.map((h) => line('', `  · scope=${h.scope}`))], isError: true }
        }
        const { agent } = lookup.hit
        if (agent.isNotTask) return { lines: [line('err', `${label} 是非任务文件，没有 Label 无法载入`)], isError: true }
        if (agent.parseError) return { lines: [line('err', `${label} 的 plist 无法解析，请先修复`)], isError: true }
        if (agent.isBrew) return { lines: [line('err', `${label} 由 Homebrew 管理，请用 brew services start ${agent.label} 而不是直接载入`)], isError: true }
        try {
          // reload 而不是 start:launchd 只在 bootstrap 时读 plist。
          // 修复流程是「覆盖同一个文件 → 再载入」,用 start 会在任务已载入时跳过 bootstrap,
          // 第二轮验证看到的仍是旧配置。
          const st = await deps.agents.ops(agent.id, 'reload')
          return {
            lines: [
              line('ok', `已载入 ${label}（loaded=${st.loaded} enabled=${st.enabled} running=${st.running}）`),
              line('', `作用域 ${scopeLabel(agent.scope)}；如需看日志用 tail_log label=${label}`)
            ]
          }
        } catch (err) {
          return { lines: [line('err', `载入失败：${err instanceof Error ? err.message : String(err)}`)], isError: true }
        }
      }
    },

    {
      name: 'unload_plist',
      label: '卸载任务',
      description: '从 launchd 卸载任务（plist 文件保留）。等价于界面上的「停止」。',
      parameters: Type.Object({
        label: Type.String(),
        scope: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('system'), Type.Literal('daemon')]))
      }),
      write: true,
      summarize: (a) => ({
        detail: `从 launchd 卸载 ${String(a['label'] ?? '')}（文件保留；停止运行并取消开机自启）`,
        command: `launchctl bootout <domain> ${String(a['label'] ?? '')}`
      }),
      execute: async (args) => {
        const label = String(args['label'] ?? '').trim()
        const lookup = await locateAgent(deps.agents, label, args['scope'] as never)
        if (lookup.kind === 'not-found') return { lines: [line('err', lookup.message)], isError: true }
        if (lookup.kind === 'ambiguous') {
          return { lines: [line('warn', `${label} 在多个作用域下都存在，请指明 scope`), ...lookup.hits.map((h) => line('', `  · scope=${h.scope}`))], isError: true }
        }
        const { agent } = lookup.hit
        if (agent.isBrew) return { lines: [line('err', `${label} 由 Homebrew 管理，请用 brew services stop ${agent.label}`)], isError: true }
        try {
          const st = await deps.agents.ops(agent.id, 'stop')
          return { lines: [line('ok', `已卸载 ${label}（loaded=${st.loaded} running=${st.running}）`)] }
        } catch (err) {
          return { lines: [line('err', `卸载失败：${err instanceof Error ? err.message : String(err)}`)], isError: true }
        }
      }
    },
  ]
}
