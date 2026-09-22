// plist 类工具:读取 / 校验 / 生成草稿 / 写入 / 装卸
//
// 写入刻意走 PlistService(带作用域路径围栏 + 提权),而不是编辑器那条 CAS 通道:
// 编辑器的 revision/CAS 是给「人对着文档改」设计的;AI 生成的是整份新文件,没有可比对的旧版本。
// 但覆盖守卫照旧 —— 目标已存在时一律要求显式 overwrite,不静默清掉别人的文件。
import type { AgentScope } from '../../../shared/models'
import { Type } from '@earendil-works/pi-ai'
import { parsePlistXml, toPlistXml, type PlistDict, type PlistValue } from '../../domains/plist-xml'
import { assertValidAgentLabel } from '../../domains/agent-label'
import type { AgentService } from '../../services/agent-service'
import type { PlistService } from '../../services/plist-service'
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
      name: 'generate_plist',
      label: '生成 plist 草稿',
      description:
        '根据参数生成一份 launchd plist 草稿并自动校验。**只产出文本，不写任何文件**；用户确认后再用 write_plist 落盘。',
      parameters: Type.Object({
        label: Type.String({ description: '任务 Label，如 com.user.backup-nightly' }),
        program: Type.String({ description: '可执行文件绝对路径' }),
        args: Type.Optional(Type.Array(Type.String(), { description: '传给程序的参数（不含程序本身）' })),
        runAtLoad: Type.Optional(Type.Boolean({ description: '载入后立即运行一次' })),
        keepAlive: Type.Optional(Type.Boolean({ description: '保持存活（退出后自动重拉）；程序启动即退出时会形成重启循环，慎用' })),
        startInterval: Type.Optional(Type.Number({ description: '每隔多少秒运行一次' })),
        calendar: Type.Optional(
          Type.Array(
            Type.Object({
              hour: Type.Optional(Type.Number()),
              minute: Type.Optional(Type.Number()),
              weekday: Type.Optional(Type.Number({ description: '0 或 7 = 周日，1 = 周一 …' })),
              day: Type.Optional(Type.Number()),
              month: Type.Optional(Type.Number())
            }),
            { description: '定时规则，可多条（对应 StartCalendarInterval 数组）' }
          )
        ),
        workingDirectory: Type.Optional(Type.String()),
        stdout: Type.Optional(Type.String({ description: '标准输出重定向到的文件路径' })),
        stderr: Type.Optional(Type.String()),
        env: Type.Optional(Type.Record(Type.String(), Type.String(), { description: '环境变量' })),
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
        const program = String(args['program'] ?? '').trim()
        if (program === '') return { lines: [line('err', '缺少 program（可执行文件路径）')], isError: true }
        if (!program.startsWith('/')) {
          return { lines: [line('err', 'program 必须是绝对路径（launchd 不解析 PATH）')], isError: true }
        }

        const dict: PlistDict = { Label: label }
        // argv 规范形态 = ProgramArguments[0] 是可执行文件本身;单独写 Program + -c 会被 launchd 当程序名
        const argv = [program, ...(Array.isArray(args['args']) ? (args['args'] as string[]).map(String) : [])]
        dict['ProgramArguments'] = argv.length > 1 ? argv : [program]
        if (args['runAtLoad'] === true) dict['RunAtLoad'] = true
        if (args['keepAlive'] === true) dict['KeepAlive'] = true
        if (typeof args['startInterval'] === 'number') dict['StartInterval'] = Math.max(1, Math.trunc(args['startInterval']))
        const calendar = Array.isArray(args['calendar']) ? (args['calendar'] as Record<string, number>[]) : []
        if (calendar.length > 0) {
          const entries = calendar.map((c) => {
            const o: PlistDict = {}
            for (const k of ['hour', 'minute', 'weekday', 'day', 'month'] as const) {
              if (typeof c[k] === 'number') o[k] = Math.trunc(c[k])
            }
            return o
          })
          dict['StartCalendarInterval'] = calendar.length === 1 ? entries[0] : entries
        }
        if (typeof args['workingDirectory'] === 'string' && args['workingDirectory'] !== '') {
          dict['WorkingDirectory'] = String(args['workingDirectory'])
        }
        if (typeof args['stdout'] === 'string' && args['stdout'] !== '') dict['StandardOutPath'] = String(args['stdout'])
        if (typeof args['stderr'] === 'string' && args['stderr'] !== '') dict['StandardErrorPath'] = String(args['stderr'])
        if (args['env'] && typeof args['env'] === 'object') dict['EnvironmentVariables'] = { ...(args['env'] as Record<string, string>) }
        if (typeof args['processType'] === 'string' && args['processType'] !== '') dict['ProcessType'] = String(args['processType'])
        if (typeof args['throttleInterval'] === 'number') dict['ThrottleInterval'] = Math.trunc(args['throttleInterval'])

        const xml = toPlistXml(dict, { indent: deps.getXmlIndent() })
        const lint = await deps.agents.validateXml(xml)
        const out: ToolOutputLine[] = []
        if (lint.ok) out.push(line('ok', 'plutil -lint 通过'))
        else out.push(line('err', `plutil -lint 失败：${lint.error ?? ''}（请修正参数后重试）`))

        out.push(line('', '关键键说明：'))
        out.push(line('', '  ProgramArguments = 可执行文件 + 参数（launchd 直接 exec，不经 shell）'))
        if (dict['RunAtLoad']) out.push(line('', '  RunAtLoad = 载入时立即运行一次'))
        if (dict['KeepAlive']) out.push(line('warn', '  KeepAlive = 退出后自动重拉；若程序启动即失败会形成重启循环'))
        if (dict['StartInterval']) out.push(line('', `  StartInterval = 每 ${dict['StartInterval']} 秒运行一次`))
        if (dict['StartCalendarInterval']) out.push(line('', '  StartCalendarInterval = 按日历定时'))
        if (dict['StandardOutPath']) out.push(line('', `  StandardOutPath = 输出写入 ${dict['StandardOutPath']}`))

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
        return {
          detail: `写入 ${label}.plist 到 ${scope} 作用域的 launchd 目录（不会自动载入）`,
          command: `写入 ${label}.plist（${scope}）${a['overwrite'] ? '，目标已存在将被覆盖' : ''}`,
          dangerous: a['overwrite'] === true
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

        const path = deps.plists.pathFor(scope, xmlLabel)
        const existing = (await deps.plists.scanNow()).find((f) => f.path === path)
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
        }

        try {
          await deps.plists.write(scope, path, xml)
        } catch (err) {
          return { lines: [line('err', `写入失败：${err instanceof Error ? err.message : String(err)}`)], isError: true }
        }
        return {
          lines: [
            line('ok', `已写入 ${path}${existing ? '（覆盖）' : ''}`),
            line('', '写入后尚未载入；要让它生效请调用 load_plist')
          ]
        }
      }
    },

    {
      name: 'load_plist',
      label: '载入任务',
      description: '把 plist 载入 launchd（必要时先启用被停用的覆盖位）。等价于界面上的「启动」。',
      parameters: Type.Object({
        label: Type.String(),
        scope: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('system'), Type.Literal('daemon')]))
      }),
      write: true,
      summarize: (a) => ({
        detail: `载入 ${String(a['label'] ?? '')} 到 launchd（会启动该任务并按 RunAtLoad/触发条件运行）`,
        command: `launchctl bootstrap ${(a['scope'] as string) ?? 'user'}/<label> ${String(a['label'] ?? '')}.plist`
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
          const st = await deps.agents.ops(agent.id, 'start')
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
