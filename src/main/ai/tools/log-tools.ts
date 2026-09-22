// 日志工具:tail_log(launchd 任务的文件/stdout 日志,或 cron 任务的日志)
//
// 日志是诊断的证据来源,所以这里只做「取出来 + 过滤 + 截断」,不做任何推断 ——
// 让模型看到真实行,而不是我们替它总结过的转述。
import { Type } from '@earendil-works/pi-ai'
import type { AgentService } from '../../services/agent-service'
import type { CrontabService } from '../../services/crontab-service'
import type { ToolDef, ToolOutputLine } from '../tool-types'
import { cap, line, locateAgent, omittedLine } from './shared'

export function createLogTools(deps: { agents: AgentService; cron: CrontabService }): ToolDef[] {
  return [
    {
      name: 'tail_log',
      label: '查看日志',
      description:
        '查看任务最近的日志。launchd 任务用它的 Label;cron 任务用它的 id 或说明。可用 keyword 只保留包含关键词的行。',
      parameters: Type.Object({
        label: Type.String({ description: 'launchd 的 Label,或 cron 任务的 id / 说明' }),
        source: Type.Optional(
          Type.Union([Type.Literal('file'), Type.Literal('system')], {
            description: 'launchd:file = plist 里配置的 stdout/stderr 文件（默认），system = 统一日志 log show'
          })
        ),
        lines: Type.Optional(Type.Number({ description: '最多返回多少行（默认 60，上限 300）' })),
        keyword: Type.Optional(Type.String({ description: '只保留包含该关键词的行（大小写不敏感）' }))
      }),
      write: false,
      execute: async (args) => {
        const target = String(args['label'] ?? '').trim()
        if (target === '') return { lines: [line('err', '缺少 label')], isError: true }
        const limit = Math.min(300, Math.max(1, Math.trunc(Number(args['lines'] ?? 60) || 60)))
        const source = (args['source'] as 'file' | 'system' | undefined) ?? 'file'
        const keyword = String(args['keyword'] ?? '').trim().toLowerCase()

        // 先按 launchd 任务找;找不到再按 cron 找 —— 两类资源的标识形态不同(id 是内容哈希)
        const lookup = await locateAgent(deps.agents, target)
        if (lookup.kind === 'found') {
          const { agent } = lookup.hit
          if (agent.isNotTask || agent.parseError) {
            return { lines: [line('err', `${target} 不是可运行的任务，没有日志`)], isError: true }
          }
          try {
            const all = await deps.agents.readLogs(agent.id, source)
            const filtered = keyword === '' ? all : all.filter((l) => l.text.toLowerCase().includes(keyword) || l.ts.includes(keyword))
            const { shown, omitted } = cap(filtered.slice(-limit), limit)
            const out: ToolOutputLine[] = [
              line('', `${agent.label} 日志（来源 ${source}，共 ${filtered.length} 行${keyword ? `，已按关键词「${keyword}」过滤` : ''}）：`)
            ]
            if (shown.length === 0) {
              out.push(line('warn', '  没有日志行。可能是任务从未执行，或没配置 StandardOutPath / StandardErrorPath'))
                out.push(line('', `  提示：source=system 可读统一日志；或先用 read_plist 看看有没有配置输出路径`))
            } else {
              out.push(...shown.map((l) => line(l.type === 'err' ? 'err' : l.type === 'warn' ? 'warn' : '', `  ${l.ts} ${l.text}`)))
              out.push(...omittedLine(omitted))
            }
            return { lines: out }
          } catch (err) {
            // 注意:文件名会被误当 label(常见),所以这里不直接报错,而是继续尝试 cron
            const msg = err instanceof Error ? err.message : String(err)
            if (!msg.includes('not found') && !msg.includes('找不到')) {
              return { lines: [line('err', `读取日志失败：${msg}`)], isError: true }
            }
          }
        } else if (lookup.kind === 'ambiguous') {
          return {
            lines: [
              line('warn', `${target} 在多个作用域下都存在，请指明（日志按任务分开）：`),
              ...lookup.hits.map((h) => line('', `  · scope=${h.scope}`))
            ],
            isError: true
          }
        }

        // cron 侧:按 id / 说明 / 命令匹配
        const { jobs } = await deps.cron.list()
        const low = target.toLowerCase()
        const job = jobs.find((j) => j.id === target) ?? jobs.find((j) => (j.desc ?? '').toLowerCase() === low) ?? jobs.find((j) => (j.desc ?? '').toLowerCase().includes(low))
        if (!job) {
          return { lines: [line('err', `找不到名为 ${target} 的 launchd 任务或 cron 任务`)], isError: true }
        }
        try {
          const all = await deps.cron.readLog(job.id)
          const filtered = keyword === '' ? all : all.filter((l) => l.text.toLowerCase().includes(keyword))
          const { shown, omitted } = cap(filtered.slice(-limit), limit)
          const out: ToolOutputLine[] = [line('', `cron「${job.desc || job.cmd}」日志（共 ${filtered.length} 行）：`)]
          if (shown.length === 0) {
            out.push(line('warn', '  该任务暂无日志：可能尚未执行，或未开启日志重定向，或日志已过保留期被清理'))
          } else {
            out.push(...shown.map((l) => line(l.type === 'err' ? 'err' : '', `  ${l.ts} ${l.text}`)))
            out.push(...omittedLine(omitted))
          }
          if (job.percentUnescaped) {
            out.push(line('err', '⚠ 该任务的命令含未转义 % —— 会被 cron 截断成换行导致静默失败,界面可一键修复'))
          }
          return { lines: out }
        } catch (err) {
          return { lines: [line('err', `读取 cron 日志失败：${err instanceof Error ? err.message : String(err)}`)], isError: true }
        }
      }
    }
  ]
}
