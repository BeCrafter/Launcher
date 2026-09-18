import { describe, expect, it, vi } from 'vitest'
import { ELEVATION_CANCELLED, ELEVATION_FAILED } from '../../shared/ipc'
import type { ElevationExecutor, ElevationRequest } from './elevation'
import { createLaunchctlService } from './launchctl-service'
import type { ShellRunner, ShellRunResult } from './shell-runner'

const res = (code: number, stderr = '', stdout = ''): ShellRunResult => ({
  code,
  signal: null,
  stdout,
  stderr,
  timedOut: false,
  error: null
})

const EPERM_STDERR = 'Could not kickstart service: 1: Operation not permitted'

function harness(opts: {
  local: ShellRunResult
  elevated?: { ok: boolean; cancelled?: boolean; stderr?: string }
}) {
  const localCalls: string[][] = []
  const elevatedCalls: string[] = []
  const runner: ShellRunner = {
    run: async (file, args = []) => {
      localCalls.push([file, ...args])
      return opts.local
    }
  }
  const elevate: ElevationExecutor & { run: ReturnType<typeof vi.fn> } = {
    run: vi.fn(async (req: ElevationRequest) => {
      elevatedCalls.push(renderElevation(req))
      const e = opts.elevated ?? { ok: true }
      return { ok: e.ok, cancelled: e.cancelled ?? false, code: e.ok ? 0 : 1, stderr: e.stderr ?? null }
    })
  }
  const svc = createLaunchctlService({ runner, elevate, uid: 501 })
  return { svc, localCalls, elevatedCalls, elevate }
}

// 域映射:user 与 system 都在用户 gui 域;仅 daemon 落到 system 域。
// 提权策略(2026-09-17 实测后改为「先试无提权,被系统拒绝才升级」):这组用例锁住该决策边界,
// 尤其是「业务错误不得被包装成一次授权弹窗」——那会让真实失败看起来像权限问题。
/** 断言用:把提权请求渲染成一行(argv 步骤按空格连接,逃生舱原样) */
const renderElevation = (req: ElevationRequest): string =>
  req.steps
    .map((s) => ('script' in s ? s.script : [s.command, ...(s.args ?? [])].join(' ')))
    .join(' && ')

describe('launchctl-service 提权判定', () => {
  it('daemon(system 域)直接提权,不先在本地试跑', async () => {
    const h = harness({ local: res(0) })
    await h.svc.bootstrap('/Library/LaunchDaemons/x.plist', 'daemon')
    expect(h.localCalls).toHaveLength(0)
    expect(h.elevatedCalls).toEqual(['launchctl bootstrap system /Library/LaunchDaemons/x.plist'])
  })

  it('system 落在用户 gui 域:本地成功则不弹授权', async () => {
    const h = harness({ local: res(0) })
    await h.svc.kickstart('com.x.y', 'system')
    expect(h.localCalls).toEqual([['launchctl', 'kickstart', 'gui/501/com.x.y']])
    expect(h.elevate.run).not.toHaveBeenCalled()
  })

  it('system 本地被系统拒绝(EPERM)→ 升级为提权重试', async () => {
    const h = harness({ local: res(1, EPERM_STDERR) })
    await h.svc.kickstart('com.x.y', 'system')
    expect(h.elevate.run).toHaveBeenCalledTimes(1)
    expect(h.elevatedCalls[0]).toBe('launchctl kickstart gui/501/com.x.y')
  })

  it('业务错误(非权限)不重试,直接抛出', async () => {
    const h = harness({ local: res(113, 'Could not find service "x" in domain for user gui: 501') })
    await expect(h.svc.kickstart('com.x.y', 'system')).rejects.toThrow(/Could not find service/)
    expect(h.elevate.run).not.toHaveBeenCalled()
  })

  it('bootout 对「本就不在」容错:不抛错也不提权', async () => {
    const h = harness({ local: res(3, 'Boot-out failed: 3: No such process') })
    await expect(h.svc.bootout('/Library/LaunchAgents/x.plist', 'system')).resolves.toBeUndefined()
    expect(h.elevate.run).not.toHaveBeenCalled()
  })

  it('user 域同样先本地试跑', async () => {
    const h = harness({ local: res(0) })
    await h.svc.enable('com.x.y', 'user')
    expect(h.localCalls).toEqual([['launchctl', 'enable', 'gui/501/com.x.y']])
    expect(h.elevate.run).not.toHaveBeenCalled()
  })

  it('升级路径的取消与失败如实上报(不被误吞成「成功」)', async () => {
    const cancelled = harness({
      local: res(1, EPERM_STDERR),
      elevated: { ok: false, cancelled: true, stderr: '(-128)' }
    })
    await expect(cancelled.svc.bootstrap('/Library/LaunchAgents/x.plist', 'system')).rejects.toThrow(
      ELEVATION_CANCELLED
    )

    const failed = harness({
      local: res(1, EPERM_STDERR),
      elevated: { ok: false, stderr: 'authorization failed' }
    })
    await expect(failed.svc.bootstrap('/Library/LaunchAgents/x.plist', 'system')).rejects.toThrow(
      ELEVATION_FAILED
    )
  })
})
