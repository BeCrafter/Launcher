// 定时任务执行层(阶段 2):真实 crontab 读写
// - user scope:`crontab -l` / `crontab -`(stdin 整表写回)/ `crontab -r`(空表移除)
// - system scope:/etc/crontab(fs 读;写走 osascript 提权,base64 载荷 + chown/chmod;不存在时受 SIP 限制无法创建)
// - mutation 全部「现读 → 现解析 → 定位 → 写回」,不缓存文件内容(外部改动安全)
// - 不新增存储:状态即 crontab 文件;日志文件是日志功能自身产物

import { promises as fs } from 'node:fs'
import { cronLogDir, cronLogSegmentOf, cronLogTemplate, matchCronLogFile } from '../../shared/cron-log'
import { ELEVATION_CANCELLED, ELEVATION_FAILED, type CronUpdateResult } from '../../shared/ipc'
import type { CronJob, CronListPayload, CronLogFileInfo, CronScope, LogLine } from '../../shared/models'
import {
  hashJobId,
  headerRawOf,
  parseCrontab,
  renderDescLine,
  renderJobLine,
  replaceHeader,
  serializeCrontab,
  type ParsedCrontab
} from '../domains/crontab'
import { formatLogTs, parseLogText } from '../domains/log-lines'
import type { ElevationExecutor } from './elevation'
import type { ShellRunner } from './shell-runner'

// 系统级 crontab 路径。实测(SIP 开启的 macOS):/etc 下"新建"文件即使 root 也被拒(EPERM),
// 但修改既有文件不受限(如 /etc/hosts);因此仅当文件已存在时系统级任务可用(读取不受限)。
const DEFAULT_SYSTEM_CRONTAB = '/etc/crontab'
const LOG_TAIL_BYTES = 256 * 1024
const CLEANUP_INTERVAL_MS = 3600_000

export interface CrontabServiceDeps {
  runner: ShellRunner
  elevate: ElevationExecutor
  home: string
  username: string
  /** cronLogRetainDays 设置(经 getter 注入) */
  getRetainDays(): number
  /** /etc/crontab 路径(测试注入;默认系统路径) */
  systemCrontabPath?: string
}

export interface CrontabService {
  list(): Promise<CronListPayload>
  create(input: Omit<CronJob, 'id'>): Promise<CronJob>
  update(job: CronJob, patch: Partial<CronJob>): Promise<CronUpdateResult>
  remove(job: CronJob): Promise<void>
  /** 该任务已有的日志文件(新 → 旧;含迁移前的历史单文件),供日志抽屉的文件列表 */
  listLogs(id: string): Promise<CronLogFileInfo[]>
  /** 读取**单个**日志文件(name 省略 → 最新非空段);跨小时段不再拼接,由调用方按段切换 */
  readLog(id: string, name?: string): Promise<LogLine[]>
  /** 删除单个日志文件(文件名必须属于该任务;文件已不存在按成功处理) */
  deleteLog(id: string, name: string): Promise<void>
  writeHeader(scope: CronScope, text: string): Promise<void>
  /** 清理超过保留期的日志文件,返回删除数量(定时触发 + 抽屉「清理过期段」按钮共用) */
  cleanupLogs(): Promise<number>
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}

export function createCrontabService(deps: CrontabServiceDeps): CrontabService {
  const systemPath = deps.systemCrontabPath ?? DEFAULT_SYSTEM_CRONTAB
  const systemBak = `${systemPath}.bak`
  let lastCleanup = 0

  async function readScope(scope: CronScope): Promise<{ text: string; exists: boolean }> {
    if (scope === 'system') {
      try {
        return { text: await fs.readFile(systemPath, 'utf8'), exists: true }
      } catch (err) {
        if (isEnoent(err)) return { text: '', exists: false }
        throw err
      }
    }
    const r = await deps.runner.run('crontab', ['-l'])
    if (r.code === 0) return { text: r.stdout, exists: true }
    if (/no crontab/.test(r.stderr ?? '')) return { text: '', exists: false }
    throw new Error(`crontab -l failed: ${r.stderr || r.code}`)
  }

  async function writeScope(scope: CronScope, text: string): Promise<void> {
    const normalized = text !== '' && !text.endsWith('\n') ? `${text}\n` : text
    if (scope === 'system') {
      // 固定模板 + base64 载荷:无引号/反斜杠/换行,经 elevate 安全校验;先备份再写,重建属主权限
      const b64 = Buffer.from(normalized, 'utf8').toString('base64')
      const sh =
        `cp ${systemPath} ${systemBak} 2>/dev/null; ` +
        `printf '%s' '${b64}' | /usr/bin/openssl base64 -d -A > ${systemPath}` +
        ` && chown root:wheel ${systemPath} && chmod 644 ${systemPath}`
      const r = await deps.elevate.run(sh)
      if (!r.ok) {
        throw new Error(r.cancelled ? ELEVATION_CANCELLED : `${ELEVATION_FAILED}: ${r.stderr ?? ''}`)
      }
      return
    }
    if (normalized.trim() === '') {
      const r = await deps.runner.run('crontab', ['-r'])
      if (r.code !== 0 && !/no crontab/.test(r.stderr ?? '')) {
        throw new Error(`crontab -r failed: ${r.stderr || r.code}`)
      }
      return
    }
    const r = await deps.runner.run('crontab', ['-'], { input: normalized })
    if (r.code !== 0) throw new Error(`crontab - failed: ${r.stderr || r.code}`)
  }

  async function parseScope(scope: CronScope): Promise<{ doc: ParsedCrontab; exists: boolean }> {
    const raw = await readScope(scope)
    return { doc: parseCrontab(raw.text, scope, deps.username, deps.home), exists: raw.exists }
  }

  /** 在原文末尾追加行(保持尾随换行在最后) */
  function appendLines(lines: string[], added: string[]): string[] {
    const out = [...lines]
    const last = out[out.length - 1]
    if (last === '') out.splice(out.length - 1, 0, ...added)
    else out.push(...added)
    return out
  }

/**
 * 某任务的日志文件(新式 `<id>-YYYYMMDDHH.log` 与旧式 `<id>.log` 并存),按 mtime 降序。
 * 按 mtime 排序对两种形态都成立:每段只在它所属的小时内被写入。
 */
async function listLogFiles(id: string): Promise<{ name: string; path: string; size: number; mtimeMs: number }[]> {
  let names: string[]
  try {
    names = await fs.readdir(cronLogDir(deps.home))
  } catch {
    return []
  }
  const out: { name: string; path: string; size: number; mtimeMs: number }[] = []
  for (const n of names.filter((f) => matchCronLogFile(id, f))) {
    const p = `${cronLogDir(deps.home)}/${n}`
    try {
      const st = await fs.stat(p)
      if (st.isFile()) out.push({ name: n, path: p, size: st.size, mtimeMs: st.mtimeMs })
    } catch {
      /* 单个文件失败不影响其余 */
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/**
 * 模板态任务(`logTemplate`)的派生信息:`logPath` 解析为该任务**当前该看的那份文件**、`segmentCount` 为分段数。
 * 优先指向最新的**分段文件** —— 刚迁移完时分段文件还没产生,此时才回落到历史整份;
 * 否则卡片会一直显示老的整份路径,看起来像"迁移没生效"。一次 readdir 后按 id 归组。
 */
async function resolveLogPaths(jobs: CronJob[]): Promise<CronJob[]> {
  if (!jobs.some((j) => j.logTemplate)) return jobs
  const resolved = new Map<string, { path?: string; count: number }>()
  for (const j of jobs) {
    if (!j.logTemplate) continue
    const files = await listLogFiles(j.id)
    const segments = files.filter((f) => cronLogSegmentOf(j.id, f.name)?.kind === 'hour')
    const current = segments.find((f) => f.size > 0) ?? files.find((f) => f.size > 0)
    resolved.set(j.id, { path: current?.path, count: segments.length })
  }
  return jobs.map((j) => {
    const r = j.logTemplate ? resolved.get(j.id) : undefined
    if (!r) return j
    return { ...j, segmentCount: r.count, ...(r.path ? { logPath: r.path } : {}) }
  })
}

  async function cleanupLogsInternal(): Promise<number> {
    const dir = cronLogDir(deps.home)
    const cutoff = Date.now() - deps.getRetainDays() * 86400_000
    let files: string[]
    try {
      files = await fs.readdir(dir)
    } catch {
      return 0
    }
    let removed = 0
    for (const f of files) {
      const p = `${dir}/${f}`
      try {
        const st = await fs.stat(p)
        if (st.isFile() && st.mtimeMs < cutoff) {
          await fs.unlink(p)
          removed += 1
        }
      } catch {
        /* 单个文件失败不影响其余 */
      }
    }
    return removed
  }

  return {
    async list() {
      const [user, system] = await Promise.all([parseScope('user'), parseScope('system')])
      if (Date.now() - lastCleanup > CLEANUP_INTERVAL_MS) {
        lastCleanup = Date.now()
        void cleanupLogsInternal()
      }
      return {
        jobs: await resolveLogPaths([...user.doc.jobs.map((e) => e.job), ...system.doc.jobs.map((e) => e.job)]),
        headers: {
          user: { headerRaw: headerRawOf(user.doc), exists: user.exists },
          system: { headerRaw: headerRawOf(system.doc), exists: system.exists }
        }
      }
    },

    async create(input) {
      const scope: CronScope = input.system ? 'system' : 'user'
      const { doc } = await parseScope(scope)
      const base = hashJobId(scope, input.expr, input.cmd)
      const existing = new Set(doc.jobs.map((e) => e.job.id))
      let id = base
      let n = 1
      while (existing.has(id)) {
        n += 1
        id = `${base}-${n}`
      }
      const job: CronJob = { ...input, id }
      const logTarget = cronLogTemplate(deps.home, id)
      if (job.log) await fs.mkdir(cronLogDir(deps.home), { recursive: true })
      const added: string[] = []
      if (job.desc !== '') added.push(renderDescLine(job.desc))
      added.push(renderJobLine(job, logTarget))
      await writeScope(scope, appendLines(doc.lines, added).join('\n'))
      // 模板态不返回 logPath(文件可能尚未产生);由 list() 的 resolveLogPaths 按 id 解析最新文件
      return { ...job, ...(job.log ? { logTemplate: true as const } : {}) }
    },

    async update(job, patch) {
      const scope: CronScope = job.system ? 'system' : 'user'
      const { doc } = await parseScope(scope)
      let entry = doc.jobs.find((e) => e.job.id === job.id)
      let stale = false
      if (!entry) {
        // 外部改动过文件 → 原 id 失配,按 (expr, cmd) 降级匹配
        entry = doc.jobs.find((e) => e.job.id === hashJobId(scope, job.expr, job.cmd))
        if (entry) stale = true
      }
      if (!entry) throw new Error(`cron job not found: ${job.id}`)

      // 编辑可能改变内容身份(expr/cmd)→ 重算 id(与其他任务去重)
      const merged: CronJob = { ...entry.job, ...patch }
      const otherIds = new Set(doc.jobs.filter((e) => e !== entry).map((e) => e.job.id))
      const newBase = hashJobId(scope, merged.expr, merged.cmd)
      let newId = newBase
      let n = 1
      while (otherIds.has(newId)) {
        n += 1
        newId = `${newBase}-${n}`
      }
      const next: CronJob = { ...merged, id: newId }
      const logTarget = cronLogTemplate(deps.home, newId)
      if (next.log) await fs.mkdir(cronLogDir(deps.home), { recursive: true })

      const lines = [...doc.lines]
      let idx = entry.lineIndex
      if (next.desc !== entry.job.desc) {
        if (entry.descLineIndex !== null) {
          if (next.desc === '') {
            lines.splice(entry.descLineIndex, 1)
            idx -= 1
          } else {
            lines[entry.descLineIndex] = renderDescLine(next.desc)
          }
        } else if (next.desc !== '') {
          lines.splice(idx, 0, renderDescLine(next.desc))
          idx += 1
        }
      }
      lines[idx] = renderJobLine(next, logTarget)
      await writeScope(scope, lines.join('\n'))
      return { job: { ...next, ...(next.log ? { logTemplate: true as const } : {}) }, stale }
    },

    async remove(job) {
      const scope: CronScope = job.system ? 'system' : 'user'
      const { doc } = await parseScope(scope)
      const entry =
        doc.jobs.find((e) => e.job.id === job.id) ??
        doc.jobs.find((e) => e.job.id === hashJobId(scope, job.expr, job.cmd))
      if (!entry) throw new Error(`cron job not found: ${job.id}`)
      const lines = [...doc.lines]
      const removeIdx = [
        entry.lineIndex,
        ...(entry.descLineIndex !== null ? [entry.descLineIndex] : [])
      ].sort((a, b) => b - a)
      for (const i of removeIdx) lines.splice(i, 1)
      await writeScope(scope, lines.join('\n'))
    },

    async listLogs(id) {
      const files = await listLogFiles(id)
      return files.map((f) => {
        const seg = cronLogSegmentOf(id, f.name)
        return {
          name: f.name,
          size: f.size,
          mtimeMs: f.mtimeMs,
          legacy: seg?.kind === 'legacy',
          stamp: seg?.kind === 'hour' ? seg.stamp : undefined
        }
      })
    },

    async readLog(id, name) {
      const [user, system] = await Promise.all([parseScope('user'), parseScope('system')])
      const job = [...user.doc.jobs, ...system.doc.jobs].map((e) => e.job).find((j) => j.id === id)
      if (!job?.log) return [] // 模板态无 logPath(实际文件按 id 归组),判 log 而非 logPath
      const files = await listLogFiles(id)
      // name 省略 → 最新非空段;显式 name 只在**已扫描到的列表**里查找(从不拼接调用方给的字符串 → 无目录穿越面)
      const target = name === undefined ? files.find((f) => f.size > 0) : files.find((f) => f.name === name)
      if (!target) return []
      // 单文件尾读(256KB 预算);fallback 时间戳取**该文件自己的 mtime** —— 跨小时才不会把 18:00 的行标成 22:56
      try {
        const take = Math.min(LOG_TAIL_BYTES, target.size)
        const start = target.size - take
        const fh = await fs.open(target.path, 'r')
        try {
          const buf = Buffer.alloc(take)
          await fh.read(buf, 0, take, start)
          let text = buf.toString('utf8')
          if (start > 0) text = text.slice(text.indexOf('\n') + 1) // 丢弃截断的半行
          if (text.trim() === '') return []
          return parseLogText(text, formatLogTs(new Date(target.mtimeMs)))
        } finally {
          await fh.close()
        }
      } catch {
        return []
      }
    },

    async deleteLog(id, name) {
      // 只接受「属于该任务」的文件名(10 位时间戳段或旧式单文件);该正则不含 `/` → 天然无目录穿越
      if (cronLogSegmentOf(id, name) === null) throw new Error(`不是该任务的日志文件: ${name}`)
      try {
        await fs.unlink(`${cronLogDir(deps.home)}/${name}`)
      } catch (err) {
        if (!isEnoent(err)) throw err // 已不存在(保留期清理/外部删过)按成功处理,保证幂等
      }
    },

    async writeHeader(scope, text) {
      const { doc } = await parseScope(scope)
      const lines = replaceHeader(doc, text)
      await writeScope(scope, serializeCrontab({ ...doc, lines }))
    },

    cleanupLogs: cleanupLogsInternal
  }
}
