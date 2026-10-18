// 日志工具:tail_log(launchd 任务的文件/stdout 日志,或 cron 任务的日志)
//
// 日志是诊断的证据来源,所以这里只做「取出来 + 过滤 + 截断」,不做任何推断 ——
// 让模型看到真实行,而不是我们替它总结过的转述。
import { Type } from '@earendil-works/pi-ai'
import { promises as fs } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import type { AgentService } from '../../services/agent-service'
import type { CrontabService } from '../../services/crontab-service'
import type { ToolDef, ToolExecResult, ToolOutputLine } from '../tool-types'
import { cap, line, locateAgent, omittedLine } from './shared'

/** 自定义日志只读尾部,避免把超大文件读进内存 */
const LOG_TAIL_BYTES = 512 * 1024

function inside(root: string, p: string): boolean {
  const r = resolve(root)
  const q = resolve(p)
  return q === r || q.startsWith(r + sep)
}

export function createLogTools(deps: {
  agents: AgentService
  cron: CrontabService
  home: string
  /** 测试注入:额外允许的日志根目录(生产不传) */
  allowedLogRoots?: string[]
}): ToolDef[] {
  /**
   * 程序自己管理日志时,允许按绝对路径读取尾部。为了避免把「读日志」变成任意文件读取:
   * 只允许标准日志目录下的 .log,或该任务 plist 里已配置的 stdout/stderr 路径。
   */
  async function readCustomLog(
    rawPath: string,
    agentPaths: { stdout: string; stderr: string },
    limit: number,
    keyword: string
  ): Promise<ToolExecResult> {
    if (!isAbsolute(rawPath)) {
      return { lines: [line('err', `path 必须是绝对路径：${rawPath}`)], isError: true }
    }
    const p = resolve(rawPath)
    let realP: string
    try {
      realP = await fs.realpath(p)
    } catch {
      return { lines: [line('err', `日志文件不存在或不可读：${p}`)], isError: true }
    }
    const configured = [agentPaths.stdout, agentPaths.stderr].filter((x) => x !== '')
    const realConfigured: string[] = []
    for (const c of configured) {
      try {
        realConfigured.push(await fs.realpath(c))
      } catch {
        realConfigured.push(resolve(c))
      }
    }
    const roots = [
      join(deps.home, 'Library/Logs'),
      '/Library/Logs',
      '/var/log',
      ...(deps.allowedLogRoots ?? [])
    ]
    // 根目录也要 realpath:macOS 的 /var 是指向 /private/var 的符号链接,
    // 只对文件 realpath 会让「/var/folders/... 的文件」与「/private/var/... 的根」永远不匹配。
    const realRoots: string[] = []
    for (const root of roots) {
      try {
        realRoots.push(await fs.realpath(root))
      } catch {
        realRoots.push(resolve(root))
      }
    }
    const isConfigured = realConfigured.includes(realP)
    if (!isConfigured && !p.endsWith('.log')) {
      return { lines: [line('err', '自定义日志只允许 .log 文件（或该任务 plist 里已配置的日志路径）')], isError: true }
    }
    if (!isConfigured && !realRoots.some((root) => inside(root, realP))) {
      return {
        lines: [
          line('err', `不允许读取该路径：${p}`),
          line('', `只允许 ${roots.join(' / ')} 下的 .log，或该任务已配置的 StandardOutPath / StandardErrorPath`)
        ],
        isError: true
      }
    }
    let st: Awaited<ReturnType<typeof fs.stat>>
    try {
      st = await fs.stat(realP)
    } catch {
      return { lines: [line('err', `日志文件不可读：${p}`)], isError: true }
    }
    if (!st.isFile()) return { lines: [line('err', `不是普通文件：${p}`)], isError: true }
    const start = Math.max(0, st.size - LOG_TAIL_BYTES)
    const fh = await fs.open(realP, 'r')
    let text = ''
    try {
      const buf = Buffer.alloc(st.size - start)
      await fh.read(buf, 0, buf.length, start)
      text = buf.toString('utf8')
    } finally {
      await fh.close()
    }
    if (start > 0) {
      // 丢掉被截断的第一行(它可能只是半行)
      const nl = text.indexOf('\n')
      text = nl >= 0 ? text.slice(nl + 1) : ''
    }
    let lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l !== '')
    if (keyword !== '') lines = lines.filter((l) => l.toLowerCase().includes(keyword))
    const { shown, omitted } = cap(lines.slice(-limit), limit)
    const out: ToolOutputLine[] = [
      line('', `自定义日志 ${p}（共 ${lines.length} 行${keyword ? `，已按关键词「${keyword}」过滤` : ''}）：`)
    ]
    if (shown.length === 0) out.push(line('warn', '  该文件暂无内容或没有匹配行'))
    else out.push(...shown.map((l) => line('', `  ${l}`)))
    out.push(...omittedLine(omitted))
    return { lines: out }
  }

  return [
    {
      name: 'tail_log',
      label: '查看日志',
      description:
        '查看任务最近的日志。launchd 任务用它的 Label；cron 任务用它的 id 或说明。程序自己管理日志时，内置聊天可传 path 读取指定日志文件（MCP 需要 full 权限；仅限标准日志目录或该任务已配置的路径）。可用 keyword 只保留包含关键词的行。',
      parameters: Type.Object({
        label: Type.Optional(Type.String({ description: 'launchd 的 Label，或 cron 任务的 id / 说明；只读自定义日志时可省略' })),
        scope: Type.Optional(
          Type.Union([Type.Literal('user'), Type.Literal('system'), Type.Literal('daemon')], {
            description: '同名 Label 在多个作用域下都存在时用来消歧'
          })
        ),
        path: Type.Optional(
          Type.String({
            description:
              '自定义日志文件的绝对路径（内置聊天或 MCP full 权限可用；readOnly 会拒绝）。仅允许 ~/Library/Logs、/Library/Logs、/var/log 下的 .log，或该任务 plist 已配置的 StandardOutPath / StandardErrorPath'
          })
        ),
        source: Type.Optional(
          Type.Union([Type.Literal('file'), Type.Literal('system')], {
            description: 'launchd:file = plist 里配置的 stdout/stderr 文件（默认），system = 统一日志 log show；传 path 时忽略'
          })
        ),
        lines: Type.Optional(Type.Number({ description: '最多返回多少行（默认 60，上限 300）' })),
        keyword: Type.Optional(Type.String({ description: '只保留包含该关键词的行（大小写不敏感）' }))
      }),
      write: false,
      execute: async (args, ctx) => {
        const target = String(args['label'] ?? '').trim()
        const customPath = String(args['path'] ?? '').trim()
        if (target === '' && customPath === '') {
          return { lines: [line('err', '缺少 label 或 path')], isError: true }
        }
        if (customPath !== '' && ctx.allowCustomLogPath !== true) {
          return {
            lines: [line('err', '自定义日志路径仅在内置聊天或 MCP full 权限下可用；readOnly 不允许读取任意文件')],
            isError: true
          }
        }
        const limit = Math.min(300, Math.max(1, Math.trunc(Number(args['lines'] ?? 60) || 60)))
        const source = (args['source'] as 'file' | 'system' | undefined) ?? 'file'
        const keyword = String(args['keyword'] ?? '').trim().toLowerCase()

        // 先按 launchd 任务找;找不到再按 cron 找 —— 两类资源的标识形态不同(id 是内容哈希)
        const lookup = target === '' ? ({ kind: 'not-found', message: '' } as const) : await locateAgent(deps.agents, target, args['scope'] as never)
        let agentPaths = { stdout: '', stderr: '' }
        if (lookup.kind === 'found') {
          agentPaths = await deps.agents.logPaths(lookup.hit.agent.id)
        }
        if (customPath !== '') {
          if (lookup.kind === 'ambiguous') {
            return {
              lines: [
                line('warn', `${target} 在多个作用域下都存在，请指明（日志按任务分开）：`),
                ...lookup.hits.map((h) => line('', `  · scope=${h.scope}`))
              ],
              isError: true
            }
          }
          return readCustomLog(customPath, agentPaths, limit, keyword)
        }
        if (lookup.kind === 'found') {
          const { agent } = lookup.hit
          if (agent.isNotTask || agent.parseError) {
            return { lines: [line('err', `${target} 不是可运行的任务，没有日志`)], isError: true }
          }
          // 未配置日志路径 ≠ 日志为空:前者无法通过文件日志验证,后者只说明任务可能没执行。
          // 这两类给模型的结论完全不同,不能都落到「没有日志行」。
          if (source === 'file') {
            const paths = await deps.agents.logPaths(agent.id)
            if (paths.stdout === '' && paths.stderr === '') {
              return {
                lines: [
                  line('warn', `${agent.label} 未配置 StandardOutPath / StandardErrorPath，无法通过文件日志验证`),
                  line('', '可在 plist 里补日志路径后重新载入；source=system 可读统一日志')
                ]
              }
            }
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
              out.push(
                ...shown.map((l) =>
                  line(
                    l.type === 'err' ? 'err' : l.type === 'warn' ? 'warn' : '',
                    `  ${l.source ? `[${l.source}] ` : ''}${l.ts} ${l.text}`
                  )
                )
              )
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
