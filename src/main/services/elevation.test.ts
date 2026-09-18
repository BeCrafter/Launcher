import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { spawn } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { createElevationExecutor, shQuote, type ElevationRequest } from './elevation'

interface FakeBehavior {
  code?: number
  stderr?: string
  neverClose?: boolean
}

/** 抓取 fake spawn 收到的 osascript 参数,并同步读取提权脚本正文(脚本在 settle 后被清理) */
function fakeSpawn(behavior: FakeBehavior = {}): {
  spawnImpl: typeof spawn
  calls: { file: string; args: string[]; scriptPath: string | null; scriptBody: string | null }[]
  killed: boolean[]
} {
  const calls: { file: string; args: string[]; scriptPath: string | null; scriptBody: string | null }[] = []
  const killed: boolean[] = []
  const spawnImpl = ((file: string, args: string[]) => {
    const m = String(args[1] ?? '').match(/^do shell script "sh '([^']+)'" with administrator privileges$/)
    const scriptPath = m ? m[1] : null
    let scriptBody: string | null = null
    if (scriptPath) {
      try {
        scriptBody = readFileSync(scriptPath, 'utf8')
      } catch {
        scriptBody = null
      }
    }
    calls.push({ file, args, scriptPath, scriptBody })
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

const tmpDirs: string[] = []
function tempParent(): string {
  const d = mkdtempSync(join(tmpdir(), 'elev-test-'))
  tmpDirs.push(d)
  return d
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('shQuote', () => {
  it('POSIX 单引号编码:空白/分号/单引号/命令替换都成为字面量', () => {
    expect(shQuote('/a b/c')).toBe("'/a b/c'")
    expect(shQuote('a;rm -rf /')).toBe("'a;rm -rf /'")
    expect(shQuote("it's")).toBe("'it'\\''s'")
    expect(shQuote('$(whoami)`id`')).toBe("'$(whoami)`id`'")
  })
})

describe('createElevationExecutor', () => {
  it('成功:code 0 → ok,cancelled=false;脚本执行后临时目录被清理', async () => {
    const { spawnImpl, calls } = fakeSpawn({ code: 0 })
    const exec = createElevationExecutor({ spawnImpl, tmpParent: tempParent() })
    const r = await exec.run({ steps: [{ command: 'printf', args: ['%s', 'abc'] }] })
    expect(r).toEqual({ ok: true, cancelled: false, code: 0, stderr: null })
    expect(calls[0].scriptBody).toBe("#!/bin/sh\nprintf '%s' 'abc'\n")
    expect(existsSync(calls[0].scriptPath!)).toBe(false)
  })

  it('用户取消:非 0 + stderr 含 (-128)→ cancelled=true', async () => {
    const { spawnImpl } = fakeSpawn({ code: 1, stderr: 'execution error: User canceled. (-128)' })
    const exec = createElevationExecutor({ spawnImpl, tmpParent: tempParent() })
    const r = await exec.run({ steps: [{ command: 'kill', args: ['-TERM', '123'] }] })
    expect(r.ok).toBe(false)
    expect(r.cancelled).toBe(true)
  })

  it('其他失败:stderr 回传,cancelled=false', async () => {
    const { spawnImpl } = fakeSpawn({ code: 1, stderr: 'chown: Operation not permitted' })
    const exec = createElevationExecutor({ spawnImpl, tmpParent: tempParent() })
    const r = await exec.run({ steps: [{ command: 'chown', args: ['root:wheel', '/etc/crontab'] }] })
    expect(r.ok).toBe(false)
    expect(r.cancelled).toBe(false)
    expect(r.stderr).toContain('Operation not permitted')
  })

  it('超时:硬上限到点 kill 并返回 timeout', async () => {
    const { spawnImpl, killed } = fakeSpawn({ neverClose: true })
    const exec = createElevationExecutor({ spawnImpl, hardTimeoutMs: 30, tmpParent: tempParent() })
    const r = await exec.run({ steps: [{ command: 'sleep', args: ['1'] }] })
    expect(r.ok).toBe(false)
    expect(r.stderr).toBe('elevation timeout')
    expect(killed[0]).toBe(true)
  })

  it('用户数据永不进入 AppleScript:提权串只含临时脚本路径', async () => {
    const { spawnImpl, calls } = fakeSpawn({ code: 0 })
    const exec = createElevationExecutor({ spawnImpl, tmpParent: tempParent() })
    const nasty = '/Library/LaunchDaemons/a b;"$(whoami)";rm -rf ~'
    await exec.run({
      steps: [
        { command: 'mv', args: ['/tmp/t', nasty] },
        { command: 'chown', args: ['root:wheel', nasty] }
      ]
    })
    const sh = calls[0].args[1]
    expect(sh).not.toContain(nasty)
    expect(sh).not.toContain('rm -rf')
    expect(sh).toMatch(/^do shell script "sh '\/.*run\.sh'" with administrator privileges$/)
    // 危险路径只以单引号字面量形式出现在脚本正文里
    expect(calls[0].scriptBody).toContain(`mv '/tmp/t' '${nasty}' && chown 'root:wheel' '${nasty}'`)
  })

  it('步骤编码:argv 逐项单引号;join=";" 用于「前一步可失败仍继续」;逃生舱原样插入', async () => {
    const { spawnImpl, calls } = fakeSpawn({ code: 0 })
    const exec = createElevationExecutor({ spawnImpl, tmpParent: tempParent() })
    const req: ElevationRequest = {
      steps: [
        { command: 'launchctl', args: ['bootout', 'system', '/x/y.plist'] },
        { command: 'rm', args: ['-f', '/x/y.plist'] }
      ],
      join: ';'
    }
    await exec.run(req)
    expect(calls[0].scriptBody).toBe(
      "#!/bin/sh\nlaunchctl 'bootout' 'system' '/x/y.plist' ; rm '-f' '/x/y.plist'\n"
    )

    const { spawnImpl: s2, calls: c2 } = fakeSpawn({ code: 0 })
    const exec2 = createElevationExecutor({ spawnImpl: s2, tmpParent: tempParent() })
    await exec2.run({ steps: [{ script: "printf '%s' 'QUJD' | openssl base64 -d -A > /etc/crontab" }] })
    expect(c2[0].scriptBody).toBe(
      "#!/bin/sh\nprintf '%s' 'QUJD' | openssl base64 -d -A > /etc/crontab\n"
    )
  })

  it('纵深防御:临时脚本路径含引号(异常环境)时直接拒绝且不 spawn', async () => {
    const quoted = join(tempParent(), 'has"quote')
    mkdirSync(quoted, { recursive: true })
    const { spawnImpl, calls } = fakeSpawn()
    const exec = createElevationExecutor({ spawnImpl, tmpParent: quoted })
    const r = await exec.run({ steps: [{ command: 'ls' }] })
    expect(r.ok).toBe(false)
    expect(r.stderr).toContain('unsafe elevated command')
    expect(calls).toHaveLength(0)
  })
})
