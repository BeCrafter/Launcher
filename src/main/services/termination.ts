// 进程终止/重启(阶段 3)
// kill:同用户直接信号(SIGTERM → 宽限 → SIGKILL);EPERM → 'denied'(renderer 引导提权);
//        privileged 路径走 osascript(纯数字 token 命令模板)
// restart:终止(复用 kill 管线)→ 按原 argv + cwd(detached)重新拉起;失败只提示不回滚

import { spawn, type ChildProcess } from 'node:child_process'
import { ELEVATION_CANCELLED, ELEVATION_FAILED, type KillOutcome, type RestartOutcome } from '../../shared/ipc'
import type { ElevationExecutor } from './elevation'
import type { ShellRunner } from './shell-runner'

export interface TerminationService {
  kill(pid: number, opts?: { privileged?: boolean }): Promise<KillOutcome>
  restart(pid: number, cmd: string): Promise<RestartOutcome>
}

const POLL_MS = 250

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM = 进程存在但无权限;ESRCH = 已不存在
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function needsShell(cmd: string): boolean {
  return /[|&;<>()$`"\\]/.test(cmd)
}

export function createTermination(deps: {
  runner: ShellRunner
  elevate: ElevationExecutor
  spawnImpl?: typeof spawn
  graceMs?: number
}): TerminationService {
  const graceMs = deps.graceMs ?? 5000
  const spawnImpl = deps.spawnImpl ?? spawn

  async function waitGone(pid: number): Promise<boolean> {
    const deadline = Date.now() + graceMs
    while (Date.now() < deadline) {
      if (!processAlive(pid)) return true
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
    return !processAlive(pid)
  }

  async function kill(pid: number, opts?: { privileged?: boolean }): Promise<KillOutcome> {
    if (opts?.privileged) {
      const term = await deps.elevate.run(`kill -TERM ${pid}`)
      if (!term.ok) {
        if (term.cancelled) throw new Error(ELEVATION_CANCELLED)
        if (/No such process|not found/i.test(term.stderr ?? '')) return 'alreadyGone'
        throw new Error(`${ELEVATION_FAILED}: ${term.stderr ?? ''}`)
      }
      if (await waitGone(pid)) return 'ok'
      const kill9 = await deps.elevate.run(`kill -9 ${pid}`)
      if (!kill9.ok) {
        if (kill9.cancelled) throw new Error(ELEVATION_CANCELLED)
        throw new Error(`${ELEVATION_FAILED}: ${kill9.stderr ?? ''}`)
      }
      return (await waitGone(pid)) ? 'ok' : 'timeout'
    }

    try {
      process.kill(pid, 'SIGTERM')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ESRCH') return 'alreadyGone'
      if (code === 'EPERM') return 'denied'
      throw err
    }
    if (await waitGone(pid)) return 'ok'
    try {
      process.kill(pid, 'SIGKILL')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ESRCH') return 'ok'
      if (code === 'EPERM') return 'denied'
      throw err
    }
    return (await waitGone(pid)) ? 'ok' : 'timeout'
  }

  async function restart(pid: number, cmd: string): Promise<RestartOutcome> {
    // cwd 尽力还原(lsof -d cwd);失败则以应用 cwd 启动并在失败时提示
    let cwd: string | undefined
    const cwdRes = await deps.runner.run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
    const m = cwdRes.stdout.match(/^n(.+)$/m)
    if (m) cwd = m[1]

    const killed = await kill(pid)
    if (killed === 'denied') return { ok: false, newPid: null, error: 'denied' }
    if (killed !== 'ok' && killed !== 'alreadyGone') {
      return { ok: false, newPid: null, error: killed }
    }

    try {
      let child: ChildProcess
      const args = needsShell(cmd) ? ['-lc', cmd] : cmd.trim().split(/\s+/)
      const file = needsShell(cmd) ? '/bin/zsh' : args.shift()!
      child = spawnImpl(file, args, { cwd, detached: true, stdio: 'ignore' })
      child.unref()
      // 短暂观察:立即失败(ENOENT 等)视为重启失败
      const err = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 400)
        child.once('error', (e) => {
          clearTimeout(timer)
          resolve((e as NodeJS.ErrnoException).message)
        })
      })
      if (err) return { ok: false, newPid: null, error: err }
      return { ok: true, newPid: child.pid ?? null, error: null }
    } catch (err) {
      return { ok: false, newPid: null, error: err instanceof Error ? err.message : String(err) }
    }
  }

  return { kill, restart }
}
