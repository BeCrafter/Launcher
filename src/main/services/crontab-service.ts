// 定时任务执行层(阶段 2):真实 crontab 读写
// - user scope:`crontab -l` / `crontab -`(stdin 整表写回)/ `crontab -r`(空表移除)
// - system scope:/etc/crontab(fs 读;写走 osascript 提权,base64 载荷 + chown/chmod;不存在时受 SIP 限制无法创建)
// - mutation 全部「现读 → 现解析 → 定位 → 写回」,不缓存文件内容(外部改动安全)
// - 不新增存储:状态即 crontab 文件;日志文件是日志功能自身产物

import { promises as fs } from 'node:fs'
import { cronLogDir, cronLogTemplate, matchCronLogFile } from '../../shared/cron-log'
import { ELEVATION_CANCELLED, ELEVATION_FAILED, type CronUpdateResult } from '../../shared/ipc'
import type { CronJob, CronListPayload, CronScope, LogLine } from '../../shared/models'
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
  readLog(id: string): Promise<LogLine[]>
  writeHeader(scope: CronScope, text: string): Promise<void>
  cleanupLogs(): Promise<void>
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
async function listLogFiles(id: string): Promise<{ path: string; size: number; mtimeMs: number }[]> {
  let names: string[]
  try {
    names = await fs.readdir(cronLogDir(deps.home))
  } catch {
    return []
  }
  const out: { path: string; size: number; mtimeMs: number }[] = []
  for (const n of names.filter((f) => matchCronLogFile(id, f))) {
    const p = `${cronLogDir(deps.home)}/${n}`
    try {
      const st = await fs.stat(p)
      if (st.isFile()) out.push({ path: p, size: st.size, mtimeMs: st.mtimeMs })
    } catch {
      /* 单个文件失败不影响其余 */
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/**
 * 模板态任务(`logTemplate`)的 logPath 解析为该任务**最新的非空**文件(供抽屉显示/复制/访达揭示)。
 * 一次 readdir 后按 id 归组,不做逐任务的目录扫描。
 */
async function resolveLogPaths(jobs: CronJob[]): Promise<CronJob[]> {
  if (!jobs.some((j) => j.logTemplate)) return jobs
  const resolved = new Map<string, string>()
  for (const j of jobs) {
    if (!j.logTemplate) continue
    const files = (await listLogFiles(j.id)).find((f) => f.size > 0)
    if (files) resolved.set(j.id, files.path)
  }
  return jobs.map((j) => (j.logTemplate && resolved.has(j.id) ? { ...j, logPath: resolved.get(j.id) } : j))
}

  async function cleanupLogsInternal(): Promise<void> {
    const dir = cronLogDir(deps.home)
    const cutoff = Date.now() - deps.getRetainDays() * 86400_000
    let files: string[]
    try {
      files = await fs.readdir(dir)
    } catch {
      return
    }
    for (const f of files) {
      const p = `${dir}/${f}`
      try {
        const st = await fs.stat(p)
        if (st.isFile() && st.mtimeMs < cutoff) await fs.unlink(p)
      } catch {
        /* 单个文件失败不影响其余 */
      }
    }
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

    async readLog(id) {
      const [user, system] = await Promise.all([parseScope('user'), parseScope('system')])
      const job = [...user.doc.jobs, ...system.doc.jobs].map((e) => e.job).find((j) => j.id === id)
      if (!job?.log) return [] // 模板态无 logPath(实际文件按 id 归组),判 log 而非 logPath
      const files = await listLogFiles(id)
      if (files.length === 0) return []
      // 从新到旧累积,受 LOG_TAIL_BYTES 预算约束 —— 得到的是「最近的日志尾部」,跨小时段不丢连续性
      const chunks: string[] = []
      let budget = LOG_TAIL_BYTES
      for (const f of files) {
        if (budget <= 0 || f.size === 0) continue
        try {
          const take = Math.min(budget, f.size)
          const start = f.size - take
          const fh = await fs.open(f.path, 'r')
          try {
            const buf = Buffer.alloc(take)
            await fh.read(buf, 0, take, start)
            let part = buf.toString('utf8')
            if (start > 0) part = part.slice(part.indexOf('\n') + 1) // 丢弃截断的半行
            if (part !== '') {
              chunks.unshift(part) // 保持时间先后
              budget -= take
            }
          } finally {
            await fh.close()
          }
        } catch {
          /* 跳过单个文件 */
        }
      }
      const text = chunks.join('')
      if (text.trim() === '') return []
      return parseLogText(text, formatLogTs(new Date(files[0].mtimeMs)))
    },

    async writeHeader(scope, text) {
      const { doc } = await parseScope(scope)
      const lines = replaceHeader(doc, text)
      await writeScope(scope, serializeCrontab({ ...doc, lines }))
    },

    cleanupLogs: cleanupLogsInternal
  }
}
