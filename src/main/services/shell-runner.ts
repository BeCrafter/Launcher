// 执行层:命令执行 + 统一超时(cmdTimeout 设置经 getter 注入;超时 SIGTERM → 宽限后 SIGKILL)
// 阶段 1 LaunchctlService 是首个消费方;本轮为地基建好(无运行时调用方)

import { spawn, type ChildProcess } from 'node:child_process'

export interface ShellRunResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  error: string | null
}

export interface ShellRunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  /** 写入子进程 stdin 后关闭(如 crontab - 的整表写回) */
  input?: string
}

export interface ShellRunner {
  run(file: string, args?: string[], opts?: ShellRunOptions): Promise<ShellRunResult>
}

export function createShellRunner(deps: {
  getTimeoutMs(): number
  spawnImpl?: typeof spawn
  killGraceMs?: number
}): ShellRunner {
  const spawnImpl = deps.spawnImpl ?? spawn
  const killGraceMs = deps.killGraceMs ?? 2000

  return {
    run(file, args = [], opts = {}) {
      return new Promise<ShellRunResult>((resolve) => {
        const timeoutMs = opts.timeoutMs ?? deps.getTimeoutMs()
        const child: ChildProcess = spawnImpl(file, args, {
          cwd: opts.cwd,
          env: opts.env,
          stdio: [opts.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe']
        })

        let stdout = ''
        let stderr = ''
        let timedOut = false
        let settled = false
        let killTimer: NodeJS.Timeout | null = null

        const settle = (result: ShellRunResult): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (killTimer) clearTimeout(killTimer)
          resolve(result)
        }

        const timer = setTimeout(() => {
          timedOut = true
          child.kill('SIGTERM')
          killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs)
        }, timeoutMs)

        if (opts.input !== undefined) {
          child.stdin?.on('error', () => {
            /* EPIPE:子进程提前退出(如 timeout kill);忽略,结果由 close 决定 */
          })
          child.stdin?.end(opts.input)
        }

        child.stdout?.setEncoding('utf8')
        child.stderr?.setEncoding('utf8')
        child.stdout?.on('data', (chunk: string) => {
          stdout += chunk
        })
        child.stderr?.on('data', (chunk: string) => {
          stderr += chunk
        })
        child.on('error', (err) => {
          settle({ code: null, signal: null, stdout, stderr, timedOut, error: err.message })
        })
        child.on('close', (code, signal) => {
          settle({ code, signal, stdout, stderr, timedOut, error: null })
        })
      })
    }
  }
}
