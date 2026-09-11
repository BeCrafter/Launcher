import { EventEmitter } from 'node:events'
import type { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createElevationExecutor } from './elevation'

interface FakeBehavior {
  code?: number
  stderr?: string
  neverClose?: boolean
}

function fakeSpawn(behavior: FakeBehavior = {}): {
  spawnImpl: typeof spawn
  calls: { file: string; args: string[] }[]
  killed: boolean[]
} {
  const calls: { file: string; args: string[] }[] = []
  const killed: boolean[] = []
  const spawnImpl = ((file: string, args: string[]) => {
    calls.push({ file, args })
    const child = new EventEmitter() as unknown as {
      stderr: EventEmitter & { setEncoding?: () => void }
      kill: () => void
    }
    const idx = killed.push(false) - 1
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: (): void => {} })
    child.kill = (): void => {
      killed[idx] = true
    }
    if (!behavior.neverClose) {
      setTimeout(() => {
        if (behavior.stderr) child.stderr.emit('data', behavior.stderr)
        ;(child as unknown as EventEmitter).emit('close', behavior.code ?? 0)
      }, 5)
    }
    return child
  }) as unknown as typeof spawn
  return { spawnImpl, calls, killed }
}

describe('createElevationExecutor', () => {
  it('成功:code 0 → ok,cancelled=false', async () => {
    const { spawnImpl } = fakeSpawn({ code: 0 })
    const exec = createElevationExecutor({ spawnImpl })
    const r = await exec.run('printf %s abc')
    expect(r).toEqual({ ok: true, cancelled: false, code: 0, stderr: null })
  })

  it('用户取消:非 0 + stderr 含 (-128)→ cancelled=true', async () => {
    const { spawnImpl } = fakeSpawn({
      code: 1,
      stderr: 'execution error: User canceled. (-128)'
    })
    const exec = createElevationExecutor({ spawnImpl })
    const r = await exec.run('kill -TERM 123')
    expect(r.ok).toBe(false)
    expect(r.cancelled).toBe(true)
  })

  it('其他失败:stderr 回传,cancelled=false', async () => {
    const { spawnImpl } = fakeSpawn({ code: 1, stderr: 'chown: Operation not permitted' })
    const exec = createElevationExecutor({ spawnImpl })
    const r = await exec.run('chown root:wheel /etc/crontab')
    expect(r.ok).toBe(false)
    expect(r.cancelled).toBe(false)
    expect(r.stderr).toContain('Operation not permitted')
  })

  it('超时:硬上限到点 kill 并返回 timeout', async () => {
    const { spawnImpl, killed } = fakeSpawn({ neverClose: true })
    const exec = createElevationExecutor({ spawnImpl, hardTimeoutMs: 30 })
    const r = await exec.run('sleep 1')
    expect(r.ok).toBe(false)
    expect(r.stderr).toBe('elevation timeout')
    expect(killed[0]).toBe(true)
  })

  it('安全校验:含双引号/反斜杠/换行的命令直接拒绝,不 spawn', async () => {
    const { spawnImpl, calls } = fakeSpawn()
    const exec = createElevationExecutor({ spawnImpl })
    for (const bad of ['echo "x"', 'echo \\x', 'echo a\nb']) {
      const r = await exec.run(bad)
      expect(r.ok).toBe(false)
    }
    expect(calls).toHaveLength(0)
  })

  it('命令模板固定:osascript -e do shell script "…" with administrator privileges', async () => {
    const { spawnImpl, calls } = fakeSpawn({ code: 0 })
    const exec = createElevationExecutor({ spawnImpl })
    await exec.run("printf '%s' 'QUJD' | openssl base64 -d -A > /etc/crontab")
    expect(calls[0].file).toBe('/usr/bin/osascript')
    expect(calls[0].args).toEqual([
      '-e',
      `do shell script "printf '%s' 'QUJD' | openssl base64 -d -A > /etc/crontab" with administrator privileges`
    ])
  })
})
