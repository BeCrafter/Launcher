import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cronLogDir, cronLogPath } from '../../shared/cron-log'
import { ELEVATION_CANCELLED } from '../../shared/ipc'
import type { CronJob } from '../../shared/models'
import type { ElevationExecutor } from './elevation'
import { createCrontabService, type CrontabService, type CrontabServiceDeps } from './crontab-service'
import type { ShellRunner, ShellRunResult } from './shell-runner'

const USER = 'tester'
const okResult = (stdout = ''): ShellRunResult => ({
  code: 0,
  signal: null,
  stdout,
  stderr: '',
  timedOut: false,
  error: null
})
const noCrontab = (): ShellRunResult => ({
  code: 1,
  signal: null,
  stdout: '',
  stderr: `crontab: no crontab for ${USER}`,
  timedOut: false,
  error: null
})

interface Harness {
  service: CrontabService
  home: string
  systemPath: string
  runnerCalls: { args: string[]; input?: string }[]
  setUserCrontab(text: string): void
  setSystemCrontab(text: string | null): void
  elevateRun: ReturnType<typeof vi.fn>
  cleanup(): void
}

const harnesses: Harness[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})

function makeHarness(opts?: { elevateResult?: { ok: boolean; cancelled?: boolean; stderr?: string } }): Harness {
  const home = mkdtempSync(join(tmpdir(), 'cron-svc-home-'))
  const sysDir = mkdtempSync(join(tmpdir(), 'cron-svc-sys-'))
  const systemPath = join(sysDir, 'etc-crontab')
  let userText = ''
  let userExists = false

  const runnerCalls: { args: string[]; input?: string }[] = []
  const runner: ShellRunner = {
    async run(_file, args = [], o = {}) {
      runnerCalls.push({ args, input: o.input })
      if (args[0] === '-l') return userExists ? okResult(userText) : noCrontab()
      if (args[0] === '-') {
        userText = o.input ?? ''
        userExists = true
        return okResult()
      }
      if (args[0] === '-r') {
        if (!userExists) return noCrontab()
        userExists = false
        userText = ''
        return okResult()
      }
      return okResult()
    }
  }

  const elevateResult = opts?.elevateResult ?? { ok: true }
  const elevateRun = vi.fn(async (sh: string) => {
    void sh
    return {
      ok: elevateResult.ok,
      cancelled: elevateResult.cancelled ?? false,
      code: elevateResult.ok ? 0 : 1,
      stderr: elevateResult.stderr ?? null
    }
  })
  const elevate: ElevationExecutor = { run: elevateRun }

  const deps: CrontabServiceDeps = {
    runner,
    elevate,
    home,
    username: USER,
    getRetainDays: () => 3,
    systemCrontabPath: systemPath
  }

  const h: Harness = {
    service: createCrontabService(deps),
    home,
    systemPath,
    runnerCalls,
    setUserCrontab: (t) => {
      userText = t
      userExists = true
    },
    setSystemCrontab: (t) => {
      if (t === null) rmSync(systemPath, { force: true })
      else writeFileSync(systemPath, t)
    },
    elevateRun,
    cleanup: () => {
      rmSync(home, { recursive: true, force: true })
      rmSync(sysDir, { recursive: true, force: true })
    }
  }
  harnesses.push(h)
  return h
}

describe('crontab-service(list/create/update/remove)', () => {
  it('list:合并 user/system 两个作用域 + 头部原文 + exists 标记', async () => {
    const h = makeHarness()
    h.setUserCrontab('SHELL=/bin/zsh\n# 问候\n0 9 * * * /usr/bin/hello\n')
    h.setSystemCrontab('*/5 * * * * root /usr/bin/ping\n')

    const payload = await h.service.list()
    expect(payload.jobs).toHaveLength(2)
    expect(payload.jobs[0].cmd).toBe('/usr/bin/hello')
    expect(payload.jobs[0].user).toBe(USER)
    expect(payload.jobs[0].desc).toBe('问候')
    expect(payload.jobs[1].user).toBe('root')
    expect(payload.jobs[1].system).toBe(true)
    expect(payload.headers.user.headerRaw).toBe('SHELL=/bin/zsh')
    expect(payload.headers.system.exists).toBe(true)
  })

  it('create(user, log=true):安装文本含包裹行与尾随换行,返回 logPath,日志目录被创建', async () => {
    const h = makeHarness()
    const job = await h.service.create({
      user: USER,
      expr: '* * * * *',
      cmd: 'echo hi',
      desc: '每分钟',
      enabled: true,
      log: true
    })
    const install = h.runnerCalls.find((c) => c.args[0] === '-')
    expect(install).toBeTruthy()
    expect(install!.input).toBe(
      `# 每分钟\n* * * * * ( echo hi ) >> ${cronLogPath(h.home, job.id)} 2>&1\n`
    )
    expect(job.logPath).toBe(cronLogPath(h.home, job.id))
    expect(existsSync(cronLogDir(h.home))).toBe(true)

    // 写回内容再 list → 解析一致
    h.setUserCrontab(install!.input!)
    const payload = await h.service.list()
    expect(payload.jobs[0]).toMatchObject({ id: job.id, cmd: 'echo hi', log: true, desc: '每分钟' })
  })

  it('create:无 crontab 时同样可装(user 空文件 → crontab -)', async () => {
    const h = makeHarness()
    const job = await h.service.create({
      user: USER,
      expr: '0 1 * * *',
      cmd: '/bin/true',
      desc: '',
      enabled: true
    })
    const install = h.runnerCalls.find((c) => c.args[0] === '-')
    expect(install!.input).toBe('0 1 * * * /bin/true\n')
    expect(job.id).toHaveLength(8)
  })

  it('update:仅重写目标行(desc 改写/命令替换/其余行不动),id 随内容变化', async () => {
    const h = makeHarness()
    h.setUserCrontab('SHELL=/bin/zsh\n# 旧描述\n0 9 * * * /usr/bin/a\n@daily /usr/bin/b\n')
    const before = await h.service.list()
    const target = before.jobs.find((j) => j.cmd === '/usr/bin/a')!

    const { job, stale } = await h.service.update(target, { expr: '30 9 * * *', desc: '新描述' })
    expect(stale).toBe(false)
    const install = h.runnerCalls.find((c) => c.args[0] === '-')
    expect(install!.input).toBe('SHELL=/bin/zsh\n# 新描述\n30 9 * * * /usr/bin/a\n@daily /usr/bin/b\n')
    expect(job.id).not.toBe(target.id) // 内容身份变化
  })

  it('update:外部改动导致 id 失配 → 按内容降级匹配,stale=true', async () => {
    const h = makeHarness()
    h.setUserCrontab('0 9 * * * /usr/bin/a\n')
    const before = await h.service.list()
    const target = before.jobs[0]
    // 模拟外部把注释行插入(改变行结构但任务内容不变 → id 仍同;构造真正失配:改掉文件后按旧 job 更新)
    h.setUserCrontab('# 外部注释\n0 9 * * * /usr/bin/a\n')
    const { stale } = await h.service.update(target, { cmd: '/usr/bin/a --v2' })
    expect(stale).toBe(false) // id 由 (scope,expr,cmd) 推导,内容未变 → 仍命中

    // 内容被外部改动(expr 变了)→ 原 id 与内容 id 均失配……按旧 job 的内容降级匹配
    h.setUserCrontab('0 19 * * * /usr/bin/zzz\n')
    await expect(h.service.update(target, { desc: 'x' })).rejects.toThrow(/not found/)
  })

  it('remove:任务行与其 desc 注释行一并删除;不存在报错', async () => {
    const h = makeHarness()
    h.setUserCrontab('# 描述\n0 9 * * * /usr/bin/a\n0 10 * * * /usr/bin/b\n')
    const payload = await h.service.list()
    const target = payload.jobs.find((j) => j.cmd === '/usr/bin/a')!
    await h.service.remove(target)
    const install = h.runnerCalls.filter((c) => c.args[0] === '-').pop()
    expect(install!.input).toBe('0 10 * * * /usr/bin/b\n')

    await expect(h.service.remove(target)).rejects.toThrow(/not found/)
  })

  it('remove 最后一任务 → crontab -r 移除整表', async () => {
    const h = makeHarness()
    h.setUserCrontab('0 9 * * * /usr/bin/only\n')
    const payload = await h.service.list()
    await h.service.remove(payload.jobs[0])
    expect(h.runnerCalls.some((c) => c.args[0] === '-r')).toBe(true)
  })

  it('writeHeader:只替换头部块,任务区原样', async () => {
    const h = makeHarness()
    h.setUserCrontab('SHELL=/bin/zsh\n0 9 * * * /usr/bin/a\n')
    await h.service.writeHeader('user', 'SHELL=/bin/bash\n# 新头部')
    const install = h.runnerCalls.find((c) => c.args[0] === '-')
    expect(install!.input).toBe('SHELL=/bin/bash\n# 新头部\n0 9 * * * /usr/bin/a\n')
  })

  it('readLog:尾读 + 时间戳/类型推断;未启用日志 → 空数组', async () => {
    const h = makeHarness()
    h.setUserCrontab('0 9 * * * /usr/bin/a\n')
    const payload = await h.service.list()
    const job = payload.jobs[0]
    expect(await h.service.readLog(job.id)).toEqual([]) // 未启用

    const logged = await h.service.update(job, { log: true })
    mkdirSync(cronLogDir(h.home), { recursive: true })
    writeFileSync(
      cronLogPath(h.home, logged.job.id),
      '2026-09-11 10:00:00 任务开始\n2026-09-11 10:00:01 error: boom\n2026-09-11 10:00:02 warn: slow\n2026-09-11 10:00:03 done\n'
    )
    const lines = await h.service.readLog(logged.job.id)
    expect(lines).toEqual([
      { ts: '2026-09-11 10:00:00', type: 'info', text: '任务开始' },
      { ts: '2026-09-11 10:00:01', type: 'err', text: 'error: boom' },
      { ts: '2026-09-11 10:00:02', type: 'warn', text: 'warn: slow' },
      { ts: '2026-09-11 10:00:03', type: 'ok', text: 'done' }
    ])
  })

  it('cleanupLogs:超过保留天数的日志被删,未超保留', async () => {
    const h = makeHarness()
    const dir = cronLogDir(h.home)
    mkdirSync(dir, { recursive: true })
    const oldFile = join(dir, 'old.log')
    const newFile = join(dir, 'new.log')
    writeFileSync(oldFile, 'x')
    writeFileSync(newFile, 'x')
    const past = Date.now() / 1000 - 10 * 86400
    utimesSync(oldFile, past, past)

    await h.service.cleanupLogs()
    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(newFile)).toBe(true)
  })
})

describe('crontab-service(system scope 提权路径)', () => {
  it('system 写入:经 elevate 模板(base64 载荷,含备份/chown/chmod)', async () => {
    const h = makeHarness()
    const payload = await h.service.list()
    expect(payload.headers.system.exists).toBe(false)

    await h.service.create({
      user: 'root',
      expr: '0 3 * * *',
      cmd: '/usr/bin/clean',
      desc: '',
      enabled: true,
      system: true
    })
    expect(h.elevateRun).toHaveBeenCalledTimes(1)
    const sh = h.elevateRun.mock.calls[0][0] as string
    expect(sh).toContain(`cp ${h.systemPath} ${h.systemPath}.bak 2>/dev/null`)
    expect(sh).toContain('chown root:wheel')
    expect(sh).toContain('chmod 644')
    // base64 载荷可解回写入内容
    const b64 = sh.match(/'([A-Za-z0-9+/=]+)'/)?.[1] ?? ''
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('0 3 * * * root /usr/bin/clean\n')
    // 不写用户 crontab
    expect(h.runnerCalls.some((c) => c.args[0] === '-')).toBe(false)
  })

  it('system 提权取消 → 抛 ELEVATION_CANCELLED', async () => {
    const h = makeHarness({ elevateResult: { ok: false, cancelled: true } })
    await expect(
      h.service.create({
        user: 'root',
        expr: '0 3 * * *',
        cmd: '/usr/bin/x',
        desc: '',
        enabled: true,
        system: true
      })
    ).rejects.toThrow(ELEVATION_CANCELLED)
  })
})
