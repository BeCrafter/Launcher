import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createShellRunner } from './shell-runner'

const runner = createShellRunner({ getTimeoutMs: () => 5000 })

describe('createShellRunner', () => {
  it('成功命令:code 0 + stdout 原样(含尾换行)', async () => {
    const r = await runner.run('/bin/echo', ['hello'])
    expect(r.code).toBe(0)
    expect(r.signal).toBeNull()
    expect(r.stdout).toBe('hello\n')
    expect(r.timedOut).toBe(false)
    expect(r.error).toBeNull()
  })

  it('非零退出:code 1 透传', async () => {
    const r = await runner.run('/usr/bin/false')
    expect(r.code).toBe(1)
    expect(r.error).toBeNull()
  })

  it('命令不存在:resolve 且 error 含 ENOENT(不 reject)', async () => {
    const r = await runner.run('/no/such/binary-becrafter-e2e')
    expect(r.code).toBeNull()
    expect(r.error).toContain('ENOENT')
  })

  it('超时:SIGTERM 终止,timedOut=true,耗时远小于命令时长', async () => {
    const start = Date.now()
    const r = await runner.run('/bin/sleep', ['5'], { timeoutMs: 150 })
    expect(r.timedOut).toBe(true)
    expect(r.signal).toBe('SIGTERM')
    expect(Date.now() - start).toBeLessThan(2000)
  })

  it('未传 timeoutMs 时使用 getTimeoutMs 注入值(设置契约)', async () => {
    const fast = createShellRunner({ getTimeoutMs: () => 120 })
    const timedOut = await fast.run('/bin/sleep', ['5'])
    expect(timedOut.timedOut).toBe(true)

    const slow = createShellRunner({ getTimeoutMs: () => 3000 })
    const ok = await slow.run('/bin/sleep', ['0.1'])
    expect(ok.timedOut).toBe(false)
    expect(ok.code).toBe(0)
  })

  it('cwd 透传', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'shellrunner-')))
    try {
      const r = await runner.run('/bin/pwd', [], { cwd: dir })
      expect(r.stdout.trim()).toBe(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('大输出完整回收不截断', async () => {
    const r = await runner.run('/bin/sh', ['-c', 'yes hello | head -c 200000'])
    expect(r.code).toBe(0)
    expect(r.stdout.length).toBe(200000)
  })

  it('stderr 与 stdout 分离', async () => {
    const r = await runner.run('/bin/sh', ['-c', 'echo out; echo err 1>&2'])
    expect(r.stdout).toBe('out\n')
    expect(r.stderr).toBe('err\n')
  })

  it('input:写入 stdin 后关闭(供 crontab - 整表写回)', async () => {
    const r = await runner.run('/bin/cat', [], { input: 'line1\nline2\n' })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('line1\nline2\n')
  })

  it('input + 超时:大输入阻塞时仍按超时终止', async () => {
    // cat 读取全部输入后结束;用 sleep 忽略输入并等待超时
    const r = await runner.run('/bin/sleep', ['5'], { input: 'x'.repeat(1024), timeoutMs: 150 })
    expect(r.timedOut).toBe(true)
    expect(r.signal).toBe('SIGTERM')
  })
})
