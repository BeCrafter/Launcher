import { spawn, type ChildProcess } from 'node:child_process'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { ELEVATION_CANCELLED } from '../../shared/ipc'
import type { ElevationExecutor } from './elevation'
import { createTermination } from './termination'
import type { ShellRunner, ShellRunResult } from './shell-runner'

const ok = (stdout = ''): ShellRunResult => ({ code: 0, signal: null, stdout, stderr: '', timedOut: false, error: null })

const realCwd = process.cwd()
const fakeRunner = (): ShellRunner => ({
  run: async () => ok(`n${realCwd}\n`) // lsof -d cwd 应答(用真实存在目录,spawn cwd 才有效)
})

const fakeElevate = (result: { ok: boolean; cancelled?: boolean; stderr?: string }): ElevationExecutor & { run: ReturnType<typeof vi.fn> } => {
  const run = vi.fn(async () => ({
    ok: result.ok,
    cancelled: result.cancelled ?? false,
    code: result.ok ? 0 : 1,
    stderr: result.stderr ?? null
  }))
  return { run }
}

const children: ChildProcess[] = []
afterAll(() => {
  for (const c of children) {
    try {
      if (c.pid) process.kill(c.pid, 'SIGKILL')
    } catch {
      /* 已退出 */
    }
  }
})
function spawnSleep(script = 'sleep 5'): ChildProcess {
  const c = spawn('/bin/sh', ['-c', script], { stdio: 'ignore' })
  children.push(c)
  return c
}
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('termination.kill', () => {
  it('不存在的 pid → alreadyGone', async () => {
    const term = createTermination({ runner: fakeRunner(), elevate: fakeElevate({ ok: true }) })
    expect(await term.kill(999_999)).toBe('alreadyGone')
  })

  it('普通进程:SIGTERM 即终止 → ok', async () => {
    const term = createTermination({ runner: fakeRunner(), elevate: fakeElevate({ ok: true }), graceMs: 2000 })
    const child = spawnSleep()
    await new Promise((r) => setTimeout(r, 150))
    expect(await term.kill(child.pid!)).toBe('ok')
    expect(alive(child.pid!)).toBe(false)
  })

  it('忽略 SIGTERM → 宽限后 SIGKILL → ok', async () => {
    const term = createTermination({ runner: fakeRunner(), elevate: fakeElevate({ ok: true }), graceMs: 300 })
    const child = spawnSleep('trap "" TERM; sleep 5')
    await new Promise((r) => setTimeout(r, 150))
    expect(await term.kill(child.pid!)).toBe('ok')
    expect(alive(child.pid!)).toBe(false)
  })

  it('他人进程(pid 1)→ EPERM → denied(不实际发信号)', async () => {
    const term = createTermination({ runner: fakeRunner(), elevate: fakeElevate({ ok: true }) })
    expect(await term.kill(1)).toBe('denied')
  })

  it('privileged:提权命令成功且进程已不存在 → ok;取消 → ELEVATION_CANCELLED', async () => {
    const term = createTermination({ runner: fakeRunner(), elevate: fakeElevate({ ok: true }) })
    expect(await term.kill(999_999, { privileged: true })).toBe('ok')

    const cancelled = createTermination({ runner: fakeRunner(), elevate: fakeElevate({ ok: false, cancelled: true }) })
    await expect(cancelled.kill(999_999, { privileged: true })).rejects.toThrow(ELEVATION_CANCELLED)
  })
})

describe('termination.restart', () => {
  it('终止后按原命令行重新拉起(新 pid ≠ 旧 pid,cwd 经 lsof 还原)', async () => {
    const term = createTermination({ runner: fakeRunner(), elevate: fakeElevate({ ok: true }), graceMs: 2000 })
    const child = spawn('/usr/bin/python3', ['-m', 'http.server', '18777', '--bind', '127.0.0.1'], { stdio: 'ignore' })
    children.push(child)
    await new Promise((r) => setTimeout(r, 400))

    const r = await term.restart(child.pid!, '/usr/bin/python3 -m http.server 18777 --bind 127.0.0.1')
    expect(r.ok).toBe(true)
    expect(r.newPid).toBeTruthy()
    expect(r.newPid).not.toBe(child.pid)
    expect(alive(r.newPid!)).toBe(true)
    if (r.newPid) process.kill(r.newPid, 'SIGKILL')
  })

  it('命令不可执行 → ok=false 且带错误', async () => {
    const term = createTermination({ runner: fakeRunner(), elevate: fakeElevate({ ok: true }), graceMs: 2000 })
    const child = spawnSleep()
    await new Promise((r) => setTimeout(r, 150))
    const r = await term.restart(child.pid!, '/no/such/binary-e2e --x')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
})
