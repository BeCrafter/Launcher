// cron 类工具:新增 / 删除定时任务
//
// 一律走 CrontabService,不自己拼 crontab 行 —— 那边有 % 转义、文件头保真、提权等一整套既成规则。
import { Type } from '@earendil-works/pi-ai'
import type { CrontabService } from '../../services/crontab-service'
import type { ToolDef, ToolOutputLine } from '../tool-types'
import { cap, line, omittedLine } from './shared'

const SPECIALS = ['@reboot', '@yearly', '@annually', '@monthly', '@weekly', '@daily', '@midnight', '@hourly']

/** 粗校验:5 段式或 @特殊串。真正的语义由 cron 自己决定,这里只挡住明显写错的输入 */
function looksLikeCronExpr(expr: string): string | null {
  const t = expr.trim()
  if (t === '') return '表达式为空'
  if (t.startsWith('@')) {
    return SPECIALS.includes(t) ? null : `未知的特殊表达式 ${t}（可用：${SPECIALS.join(' ')}）`
  }
  const parts = t.split(/\s+/)
  if (parts.length !== 5) return `需要 5 段式（分 时 日 月 周），当前是 ${parts.length} 段`
  return null
}

export function createCronTools(deps: { cron: CrontabService }): ToolDef[] {
  return [
    {
      name: 'add_cron',
      label: '新增定时任务',
      description:
        '向 crontab 新增一条定时任务。分 时 日 月 周 五段式（或 @daily 等特殊串）。系统级任务需要管理员授权。',
      parameters: Type.Object({
        expr: Type.String({ description: '五段式表达式，如 30 2 * * *；或 @daily / @reboot' }),
        cmd: Type.String({ description: '要执行的命令（可用 && 串联；命令里的 % 由系统侧负责转义）' }),
        desc: Type.Optional(Type.String({ description: '任务说明（写进 crontab 注释，便于日后识别）' })),
        system: Type.Optional(Type.Boolean({ description: 'true = 写入 /etc/crontab（需要管理员授权）；默认写入用户 crontab' }))
      }),
      write: true,
      summarize: (a) => {
        const sys = a['system'] === true
        return {
          detail: `${sys ? '系统级（/etc/crontab）' : '用户级'}新增定时任务：${String(a['expr'] ?? '')} → ${String(a['cmd'] ?? '')}`,
          command: `${sys ? '系统级' : '用户级'} crontab 写入：${String(a['expr'] ?? '')} ${String(a['cmd'] ?? '')}`,
          dangerous: sys
        }
      },
      execute: async (args) => {
        const expr = String(args['expr'] ?? '').trim()
        const cmd = String(args['cmd'] ?? '').trim()
        const bad = looksLikeCronExpr(expr)
        if (bad) return { lines: [line('err', bad)], isError: true }
        if (cmd === '') return { lines: [line('err', '命令为空')], isError: true }
        const system = args['system'] === true
        try {
          const job = await deps.cron.create({
            user: '',
            expr,
            cmd,
            desc: String(args['desc'] ?? '').trim(),
            enabled: true,
            system
          })
          return {
            lines: [
              line('ok', `已新增${system ? '系统级' : '用户级'}定时任务：${job.expr} → ${job.cmd}`),
              line('', '任务已启用；如需日志可用界面里的重定向设置(let log=true)')
            ]
          }
        } catch (err) {
          return { lines: [line('err', `新增失败：${err instanceof Error ? err.message : String(err)}`)], isError: true }
        }
      }
    },

    {
      name: 'remove_cron',
      label: '删除定时任务',
      description: '按 id 或说明/表达式/命令匹配删除定时任务。匹配到多条时会列出候选并要求指明 id。',
      parameters: Type.Object({
        id: Type.Optional(Type.String({ description: '任务 id（最精确，优先用它）' })),
        desc: Type.Optional(Type.String({ description: '按任务说明匹配' })),
        expr: Type.Optional(Type.String({ description: '按表达式匹配' })),
        cmd: Type.Optional(Type.String({ description: '按命令匹配（子串）' }))
      }),
      write: true,
      summarize: (a) => ({
        detail: `从 crontab 删除任务：${a['id'] ?? a['desc'] ?? a['expr'] ?? a['cmd'] ?? '(未指定)'}`,
        command: `crontab 删除：${a['id'] ?? a['desc'] ?? a['expr'] ?? a['cmd'] ?? ''}`,
        dangerous: true
      }),
      execute: async (args) => {
        const { jobs } = await deps.cron.list()
        const id = args['id'] ? String(args['id']) : ''
        const desc = args['desc'] ? String(args['desc']).toLowerCase() : ''
        const expr = args['expr'] ? String(args['expr']) : ''
        const cmd = args['cmd'] ? String(args['cmd']).toLowerCase() : ''

        const hits = jobs.filter((j) => {
          if (id !== '') return j.id === id
          let ok = true
          if (desc !== '') ok = ok && (j.desc ?? '').toLowerCase().includes(desc)
          if (expr !== '') ok = ok && j.expr === expr
          if (cmd !== '') ok = ok && j.cmd.toLowerCase().includes(cmd)
          return ok && (desc !== '' || expr !== '' || cmd !== '')
        })

        if (hits.length === 0) {
          return { lines: [line('err', '没有匹配的定时任务')], isError: true }
        }
        if (hits.length > 1) {
          const { shown, omitted } = cap(hits, 10)
          const out: ToolOutputLine[] = [line('warn', `匹配到 ${hits.length} 条，请用 id 指定要删的那一条：`)]
          out.push(...shown.map((j) => line('', `  id=${j.id} · ${j.desc || j.cmd} · ${j.expr}`)))
          out.push(...omittedLine(omitted))
          return { lines: out, isError: true }
        }
        const job = hits[0]
        try {
          await deps.cron.remove(job)
          return { lines: [line('ok', `已删除：${job.desc || job.cmd}（${job.expr}）`)] }
        } catch (err) {
          return { lines: [line('err', `删除失败：${err instanceof Error ? err.message : String(err)}`)], isError: true }
        }
      }
    }
  ]
}
