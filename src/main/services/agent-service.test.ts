import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { LaunchctlService } from './launchctl-service'
import { createAgentService } from './agent-service'
import type { PlistService } from './plist-service'

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-svc-'))
  const gonePath = join(dir, 'gone.plist')
  const herePath = join(dir, 'here.plist')
  writeFileSync(herePath, 'x')

  const print = vi.fn(async (label: string) => {
    if (label === 'com.a.gone') return { found: true, path: gonePath, pid: 42 }
    if (label === 'com.a.here') return { found: true, path: herePath, pid: 7 }
    if (label === 'com.a.sys') return { found: true, path: '/System/Library/LaunchAgents/com.a.sys.plist', pid: 1 }
    return { found: false, path: null, pid: null }
  })
  const launchctl = { print, domainOf: () => 'gui/501' } as unknown as LaunchctlService
  const plists = {
    dirs: () => [{ scope: 'user' as const, dir, privileged: false }]
  } as unknown as PlistService

  const svc = createAgentService({
    runner: {} as never,
    launchctl,
    plists,
    brew: {} as never,
    getXmlIndent: () => '  '
  })
  return { svc, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('agent-service.checkMissing(孤儿定向复核)', () => {
  it('目录内且文件已不存在 → 命中(带 path/pid)', async () => {
    const h = harness()
    try {
      const r = await h.svc.checkMissing([{ scope: 'user', label: 'com.a.gone' }])
      expect(r).toEqual([{ label: 'com.a.gone', scope: 'user', path: join(h.dir, 'gone.plist'), pid: 42 }])
    } finally {
      h.cleanup()
    }
  })

  it('文件仍在 / 路径在管理目录外 / 已不在 launchd → 均不命中', async () => {
    const h = harness()
    try {
      const r = await h.svc.checkMissing([
        { scope: 'user', label: 'com.a.here' },
        { scope: 'user', label: 'com.a.sys' },
        { scope: 'user', label: 'com.a.gone-but-unloaded' }
      ])
      expect(r).toEqual([])
    } finally {
      h.cleanup()
    }
  })
})

// ── 意图动作契约(顺序逻辑在 main:UI 不拼命令序列) ──
describe('agent-service 意图动作(start/stop/restart/autostart/runOnce)', () => {
  /** 可控 launchctl 假件:记录调用序列;disabled 覆盖位/域表由测试注入 */
  function opsHarness(opts: { disabledGui?: string[]; loadedPid?: number | null }) {
    const calls: string[] = []
    const tables = {
      gui: new Map<string, { label: string; pid: number | null; lastExitCode: number | null }>(),
      system: new Map<string, { label: string; pid: number | null; lastExitCode: number | null }>(),
      disabled: { gui: new Set(opts.disabledGui ?? []), system: new Set<string>() }
    }
    if (opts.loadedPid !== undefined) {
      tables.gui.set('com.heal.test', { label: 'com.heal.test', pid: opts.loadedPid, lastExitCode: null })
    }
    const launchctl = {
      domainOf: (scope: string) => (scope === 'daemon' ? 'system' : 'gui/501'),
      list: vi.fn(async () => tables),
      bootstrap: vi.fn(async (path: string) => {
        calls.push(`bootstrap:${path}`)
      }),
      bootout: vi.fn(async () => calls.push('bootout')),
      kickstart: vi.fn(async (_l: string, _s: string, o?: { kill?: boolean }) => calls.push(o?.kill ? 'kickstart:kill' : 'kickstart')),
      enable: vi.fn(async (label: string) => {
        calls.push(`enable:${label}`)
        tables.disabled.gui.delete(label)
      }),
      disable: vi.fn(async (label: string) => {
        calls.push(`disable:${label}`)
        tables.disabled.gui.add(label)
      }),
      print: vi.fn(async () => ({ found: false, path: null, pid: null })),
      stop: vi.fn(async () => {
        calls.push('kill')
        return 'ok' as const
      })
    } as unknown as LaunchctlService
    const dir = mkdtempSync(join(tmpdir(), 'agent-intent-'))
    const pfPath = join(dir, 'com.heal.test.plist')
    writeFileSync(pfPath, 'x')
    const plists = {
      scanAll: async () => ({
        valid: [{ path: pfPath, scope: 'user' as const, fileName: 'com.heal.test.plist', xml: '', value: { Label: 'com.heal.test' }, label: 'com.heal.test', desc: '' }],
        invalid: []
      }),
      dirs: () => [{ scope: 'user' as const, dir, privileged: false }],
      pathFor: () => pfPath
    } as unknown as PlistService
    const svc = createAgentService({ runner: {} as never, launchctl, plists, brew: {} as never, getXmlIndent: () => '  ' })
    return { svc, calls, pfPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
  }
  const ID = 'user:com.heal.test'

  it('start(已停用+未载入)→ 恰为 enable → bootstrap → kickstart', async () => {
    const h = opsHarness({ disabledGui: ['com.heal.test'] })
    try {
      await h.svc.ops(ID, 'start')
      expect(h.calls).toEqual(['enable:com.heal.test', `bootstrap:${h.pfPath}`, 'kickstart'])
    } finally {
      h.cleanup()
    }
  })

  it('start(已启用+未载入)→ bootstrap 后仍 kickstart(不依赖 RunAtLoad,保证「启动」即运行)', async () => {
    const h = opsHarness({})
    try {
      await h.svc.ops(ID, 'start')
      expect(h.calls).toEqual([`bootstrap:${h.pfPath}`, 'kickstart'])
    } finally {
      h.cleanup()
    }
  })

  it('start(已载入未运行)→ 仅 kickstart', async () => {
    const h = opsHarness({ loadedPid: null })
    try {
      await h.svc.ops(ID, 'start')
      expect(h.calls).toEqual(['kickstart'])
    } finally {
      h.cleanup()
    }
  })

  it('start(已在运行)→ 无操作(幂等)', async () => {
    const h = opsHarness({ loadedPid: 42 })
    try {
      await h.svc.ops(ID, 'start')
      expect(h.calls).toEqual([])
    } finally {
      h.cleanup()
    }
  })

  it('stop → 仅 bootout(不做 kill 前置;移出域即终止进程)', async () => {
    const h = opsHarness({ loadedPid: 42 })
    try {
      await h.svc.ops(ID, 'stop')
      expect(h.calls).toEqual(['bootout'])
      expect(h.calls).not.toContain('kill')
    } finally {
      h.cleanup()
    }
  })

  it('restart:运行中 → kickstart -k;未载入 → 走启动序列', async () => {
    const hRun = opsHarness({ loadedPid: 42 })
    try {
      await hRun.svc.ops(ID, 'restart')
      expect(hRun.calls).toEqual(['kickstart:kill'])
    } finally {
      hRun.cleanup()
    }
    const hIdle = opsHarness({})
    try {
      await hIdle.svc.ops(ID, 'restart')
      expect(hIdle.calls).toEqual([`bootstrap:${hIdle.pfPath}`, 'kickstart'])
    } finally {
      hIdle.cleanup()
    }
  })

  it('autostart 关(disable)→ 仅 disable,不触碰运行状态', async () => {
    const h = opsHarness({ loadedPid: 42 })
    try {
      const next = await h.svc.ops(ID, 'disable')
      expect(h.calls).toEqual(['disable:com.heal.test'])
      expect(next.enabled).toBe(false)
      expect(next.running).toBe(true) // 进程未受影响(launchd:disable 不停进程)
    } finally {
      h.cleanup()
    }
  })


})

