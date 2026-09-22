// 只读服务类工具:总览 / 单任务状态 / 检索 / 体检上下文 / 端口
import { Type } from '@earendil-works/pi-ai'
import type { Agent } from '../../../shared/models'
import type { AgentService } from '../../services/agent-service'
import type { CrontabService } from '../../services/crontab-service'
import type { ProcessDiscovery } from '../../services/process-discovery'
import type { LaunchctlService } from '../../services/launchctl-service'
import type { PlistService } from '../../services/plist-service'
import type { ToolDef, ToolOutputLine } from '../tool-types'
import { agentLine, cap, line, locateAgent, omittedLine, scopeLabel, SCOPES } from './shared'

export function createServiceTools(deps: {
  agents: AgentService
  cron: CrontabService
  discovery: ProcessDiscovery
  plists: PlistService
  launchctl: LaunchctlService
  home: string
}): ToolDef[] {
  /** 三个域的计数:任务 / 运行中 / 未运行 / 非任务占位 / 损坏 */
  function counts(list: Agent[]): ToolOutputLine[] {
    const tasks = list.filter((a) => !a.isNotTask && !a.parseError)
    const running = tasks.filter((a) => a.status === 'running').length
    const broken = list.filter((a) => a.parseError).length
    const notTask = list.filter((a) => a.isNotTask).length
    const lines: ToolOutputLine[] = [
      line('info', `launchd 任务 ${tasks.length} 项（运行中 ${running} · 未运行 ${tasks.length - running}）`)
    ]
    if (notTask > 0) lines.push(line('warn', `非任务文件 ${notTask} 个（plist 未定义 Label，launchd 会忽略）`))
    if (broken > 0) lines.push(line('err', `无法解析的 plist ${broken} 个`))
    return lines
  }

  return [
    {
      name: 'list_services',
      label: '列出本机服务',
      description:
        '汇总本机的 launchd 任务、cron 定时任务与监听端口。用于快速掌握整体状态;需要细节时再用 get_service_status / read_plist / tail_log。',
      parameters: Type.Object({
        domain: Type.Optional(
          Type.Union([Type.Literal('gui'), Type.Literal('system'), Type.Literal('all')], {
            description: "作用域:gui = 用户级(user+system 目录)与 daemon，system = 仅 daemon，all = 全部（默认）"
          })
        )
      }),
      write: false,
      execute: async (args) => {
        const domain = (args['domain'] as string | undefined) ?? 'all'
        const [{ agents }, cronPayload, scan] = await Promise.all([
          deps.agents.list(),
          deps.cron.list(),
          deps.discovery.scanOnce()
        ])
        const list = domain === 'system' ? agents.filter((a) => a.scope === 'daemon') : agents
        const jobs = domain === 'system' ? cronPayload.jobs.filter((j) => j.system) : cronPayload.jobs

        const out: ToolOutputLine[] = [...counts(list)]
        const byScope = SCOPES.map((s) => `${s} ${list.filter((a) => a.scope === s).length}`).join(' · ')
        out.push(line('', `按作用域：${byScope}`))
        out.push(
          line('info', `cron ${jobs.length} 条（启用 ${jobs.filter((j) => j.enabled).length}）· 监听端口 ${scan.services.length} 个`)
        )
        const running = scan.services.slice(0, 8).map((s) => `${s.port} ${s.name || s.cmd}`.trim())
        if (running.length > 0) out.push(line('', `端口：${running.join(' · ')}`))

        const bad = list.filter((a) => !a.isNotTask && !a.parseError && a.status !== 'running')
        const { shown, omitted } = cap(bad, 12)
        if (shown.length > 0) {
          out.push(line('', '未运行的任务：'))
          out.push(...shown.map((a) => line('', `  ${agentLine(a).text}`)))
          out.push(...omittedLine(omitted))
        }
        return { lines: out }
      }
    },

    {
      name: 'get_service_status',
      label: '查看单个任务状态',
      description:
        '查看某个 launchd 任务的运行态:pid、运行时长、退出码、重启次数、是否被停用、plist 路径与所属作用域。label 在两个作用域下同名时会要求指明 scope。',
      parameters: Type.Object({
        label: Type.String({ description: '任务的 Label（或非任务文件的原文件名）' }),
        scope: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('system'), Type.Literal('daemon')]))
      }),
      write: false,
      execute: async (args) => {
        const label = String(args['label'] ?? '').trim()
        if (label === '') return { lines: [line('err', '缺少 label')], isError: true }
        const lookup = await locateAgent(deps.agents, label, args['scope'] as never)
        if (lookup.kind === 'not-found') return { lines: [line('err', lookup.message)], isError: true }
        if (lookup.kind === 'ambiguous') {
          return { lines: [line('warn', `${label} 在多个作用域下都存在：`), ...lookup.hits.map((h) => line('', `  · scope=${h.scope}`))], isError: true }
        }
        const { agent, scope } = lookup.hit
        const out: ToolOutputLine[] = [agentLine(agent), line('', `作用域：${scopeLabel(scope)}`)]
        if (agent.isNotTask) {
          out.push(line('warn', '这是非任务文件，没有可查询的 launchd 状态；在编辑器里补上 Label 才会成为任务'))
          return { lines: out, isError: true }
        }
        if (agent.parseError) {
          out.push(line('err', `plist 无法解析：${agent.parseError}；需要按 XML 修复`))
          return { lines: out, isError: true }
        }
        try {
          const st = await deps.agents.readStatus(agent.id)
          out.push(
            line('', `pid ${st.pid ?? '—'} · uptime ${st.uptime ?? '—'} · CPU ${st.cpu} · 内存 ${st.mem}`),
            line('', `exit ${st.exitCode ?? '—'} · 重启 ${st.restarts} · 启动于 ${st.startTime || '—'}`),
            line('', `plist ${st.plistPath}`),
            line('', `工作目录 ${st.workDir || '—'}`)
          )
        } catch (err) {
          out.push(line('warn', `运行态读取失败：${err instanceof Error ? err.message : String(err)}`))
        }
        if (agent.isBrew) out.push(line('warn', '这是 Homebrew 管理的服务：启停请走 brew，直接改 plist 会被下次 brew 操作覆盖'))
        out.push(line('', `如需日志：tail_log 传 label=${agent.label}`))
        return { lines: out }
      }
    },

    {
      name: 'search_services',
      label: '检索任务',
      description: '按关键词在 launchd 任务、cron 任务与监听端口中检索,可用 source 限定来源。',
      parameters: Type.Object({
        keyword: Type.Optional(Type.String({ description: '匹配 Label / 描述 / 命令 / 程序路径 / 端口 / 进程名；留空表示列出全部' })),
        source: Type.Optional(
          Type.Union(
            [Type.Literal('all'), Type.Literal('launchd'), Type.Literal('cron'), Type.Literal('port'), Type.Literal('brew')],
            { description: '限定来源，默认 all' }
          )
        )
      }),
      write: false,
      execute: async (args) => {
        const kw = String(args['keyword'] ?? '').trim().toLowerCase()
        const source = (args['source'] as string | undefined) ?? 'all'
        const hit = (s: string): boolean => kw === '' || s.toLowerCase().includes(kw)
        const out: ToolOutputLine[] = []

        if (source === 'all' || source === 'launchd' || source === 'brew') {
          const { agents } = await deps.agents.list()
          let list = agents.filter(
            (a) => hit(a.label) || hit(a.desc ?? '') || hit(a.program ?? '') || hit(a.fileName ?? '')
          )
          if (source === 'brew') list = list.filter((a) => a.isBrew)
          const { shown, omitted } = cap(list, 15)
          out.push(line('', `launchd 命中 ${list.length} 项：`))
          out.push(...shown.map((a) => line('', `  ${agentLine(a).text}`)))
          out.push(...omittedLine(omitted))
        }
        if (source === 'all' || source === 'cron') {
          const { jobs } = await deps.cron.list()
          const list = jobs.filter((j) => hit(j.desc ?? '') || hit(j.cmd) || hit(j.expr))
          const { shown, omitted } = cap(list, 15)
          out.push(line('', `cron 命中 ${list.length} 条：`))
          out.push(
            ...shown.map((j) =>
              line('', `  ${j.desc || j.cmd} · ${j.expr} · ${j.enabled ? '已启用' : '已停用'}${j.system ? ' · 系统级' : ''}`)
            )
          )
          out.push(...omittedLine(omitted))
        }
        if (source === 'all' || source === 'port') {
          const scan = await deps.discovery.scanOnce()
          const list = scan.services.filter((s) => hit(String(s.port)) || hit(s.name ?? '') || hit(s.cmd ?? ''))
          const { shown, omitted } = cap(list, 15)
          out.push(line('', `端口命中 ${list.length} 个：`))
          out.push(...shown.map((s) => line('', `  ${s.port} ${s.name || s.cmd} · pid ${s.pid ?? '—'}`)))
          out.push(...omittedLine(omitted))
        }
        if (out.length === 0) out.push(line('', '没有匹配项'))
        return { lines: out }
      }
    },

    {
      name: 'check_port',
      label: '检查端口占用',
      description: '查询指定端口(不传则列出全部监听端口)是否被占用、被哪个进程占用。',
      parameters: Type.Object({
        ports: Type.Optional(Type.Array(Type.Number(), { description: '要检查的端口号；留空列出全部监听端口' }))
      }),
      write: false,
      execute: async (args) => {
        const wanted = Array.isArray(args['ports']) ? (args['ports'] as number[]) : []
        const scan = await deps.discovery.scanOnce()
        if (wanted.length === 0) {
          const { shown, omitted } = cap(scan.services, 25)
          return {
            lines: [
              line('info', `本机监听端口 ${scan.services.length} 个`),
              ...shown.map((s) => line('', `${s.port} · ${s.name || s.cmd || '—'} · pid ${s.pid ?? '—'}`)),
              ...omittedLine(omitted)
            ]
          }
        }
        const out = wanted.map((p) => {
          const hit = scan.services.find((s) => s.port === p)
          return hit
            ? line('warn', `${p} 已被占用：${hit.name || hit.cmd || '—'}（pid ${hit.pid ?? '—'}）`)
            : line('ok', `${p} 空闲`)
        })
        return { lines: out }
      }
    },

    {
      name: 'collect_diagnostic_context',
      label: '收集体检上下文',
      description:
        '一次性打包排查所需的全部上下文:三个域的计数、所有未运行/异常任务、被停用的任务与 cron、含未转义 % 的 cron、孤立任务(launchd 已载入但 plist 已不存在)、brew 服务与端口。做系统体检或全面诊断时优先用它,避免逐个工具反复调用。',
      parameters: Type.Object({}),
      write: false,
      execute: async () => {
        // ⚠ 孤儿任务(launchd 里还在、plist 已不存在)**不在本工具里报**:判定它需要逐 label 跑
        // `launchctl print` 拿 plist 路径,而 launchctl 的三张表里混着上千条系统自带服务
        // (它们本就不在我们扫描的三个目录里)。实测按「表里有、文件没有」粗判会报出 1344 条假孤儿 ——
        // 宁可不报,也不能给模型一个本身就错的信号。应用界面的孤儿横幅用的是有界候选集,那边仍然有效。
        const [{ agents }, cronPayload, scan] = await Promise.all([
          deps.agents.list(),
          deps.cron.list(),
          deps.discovery.scanOnce()
        ])
        const out: ToolOutputLine[] = [...counts(agents)]

        const abnormal = agents.filter(
          (a) => !a.isNotTask && !a.parseError && (a.status !== 'running' || (a.exitCode != null && a.exitCode !== 0))
        )
        const { shown, omitted } = cap(abnormal, 12)
        out.push(line('', `需要关注的任务 ${abnormal.length} 个：`))
        out.push(...shown.map((a) => line('', `  ${agentLine(a).text}`)))
        out.push(...omittedLine(omitted))

        const disabled = agents.filter((a) => a.isDisabledByOverride)
        if (disabled.length > 0) {
          out.push(line('warn', `被 launchctl 停用 ${disabled.length} 个：${disabled.slice(0, 6).map((a) => a.label).join('、')}`))
        }
        const offCrons = cronPayload.jobs.filter((j) => !j.enabled)
        if (offCrons.length > 0) {
          out.push(line('warn', `停用的 cron ${offCrons.length} 条：${offCrons.slice(0, 6).map((j) => j.desc || j.cmd).join('、')}`))
        }
        const badPercent = cronPayload.jobs.filter((j) => j.percentUnescaped)
        if (badPercent.length > 0) {
          out.push(
            line('err', `命令含未转义 % 的 cron ${badPercent.length} 条（会被 cron 截断成换行导致静默失败）：${badPercent.slice(0, 6).map((j) => j.desc || j.cmd).join('、')}`)
          )
        }
        const brewAgents = agents.filter((a) => a.isBrew)
        if (brewAgents.length > 0) out.push(line('', `brew 管理的服务 ${brewAgents.length} 个`))
        out.push(line('', `监听端口 ${scan.services.length} 个`))
        if (!scan.dockerAvailable && scan.dockerReason) out.push(line('warn', `Docker 不可用：${scan.dockerReason}`))
        return { lines: out }
      }
    }
  ]
}
