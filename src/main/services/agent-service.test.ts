import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { LaunchctlService } from './launchctl-service'
import { createAgentService } from './agent-service'
import type { PlistFile, PlistService } from './plist-service'

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
      scanAll: async () => [
        {
          path: pfPath,
          scope: 'user' as const,
          fileName: 'com.heal.test.plist',
          xml: '',
          value: { Label: 'com.heal.test' },
          label: 'com.heal.test',
          desc: '',
          isTask: true
        }
      ],
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

// ── 非任务/损坏文件:身份、可见性与保存语义(2026-09-13) ──
// 文件在磁盘上存在就必须在列表里有一行;这类行没有 label,身份只能来自文件名,
// 且保存必须原地重写(落进 rename 分支会删掉原文件 —— 那是第三方文件)
describe('agent-service 非任务/损坏文件', () => {
  const EMPTY_XML = '<plist version="1.0"><dict/></plist>'

  function fileHarness() {
    const dir = mkdtempSync(join(tmpdir(), 'agent-nontask-'))
    const phPath = join(dir, 'com.google.keystone.agent.plist')
    const brokenPath = join(dir, 'broken.plist')
    const files: PlistFile[] = [
      { path: phPath, scope: 'user', fileName: 'com.google.keystone.agent.plist', xml: EMPTY_XML, value: {}, label: '', desc: '', isTask: false },
      { path: brokenPath, scope: 'user', fileName: 'broken.plist', xml: '<plist><dict>', value: {}, label: '', desc: '', isTask: false, parseError: 'missing <plist> root' }
    ]
    const writeCalls: { path: string; xml: string }[] = []
    const writeAtCalls: { path: string; xml: string }[] = []
    const removed: string[] = []
    const opCalls: string[] = []
    const tables = { gui: new Map(), system: new Map(), disabled: { gui: new Set<string>(), system: new Set<string>() } }
    const launchctl = {
      domainOf: () => 'gui/501',
      list: vi.fn(async () => tables),
      bootstrap: vi.fn(async () => opCalls.push('bootstrap')),
      bootout: vi.fn(async () => opCalls.push('bootout')),
      kickstart: vi.fn(async () => opCalls.push('kickstart')),
      enable: vi.fn(async () => opCalls.push('enable')),
      disable: vi.fn(async () => opCalls.push('disable')),
      print: vi.fn(async () => ({ found: false, path: null, pid: null }))
    } as unknown as LaunchctlService
    const plists = {
      scanAll: async () => files,
      dirs: () => [{ scope: 'user' as const, dir, privileged: false }],
      pathFor: (_s: 'user' | 'system' | 'daemon', label: string) => join(dir, `${label}.plist`),
      write: vi.fn(async (_s: string, path: string, xml: string) => {
        writeCalls.push({ path, xml })
      }),
      writeAt: vi.fn(async (_s: string, path: string, xml: string) => {
        writeAtCalls.push({ path, xml })
        // 原地重写后该文件就成了带 Label 的任务:让后续 findAgent 能命中
        const rec = files.find((f) => f.path === path)
        if (rec) {
          rec.isTask = true
          rec.label = 'com.new'
          rec.value = { Label: 'com.new' }
          delete rec.parseError
        }
      }),
      remove: vi.fn(async (_s: string, path: string) => {
        removed.push(path)
      }),
      lint: vi.fn(async () => ({ ok: true, error: null }))
    } as unknown as PlistService
    const svc = createAgentService({ runner: {} as never, launchctl, plists, brew: {} as never, getXmlIndent: () => '  ' })
    return {
      svc,
      files,
      phPath,
      brokenPath,
      writeCalls,
      writeAtCalls,
      removed,
      opCalls,
      cleanup: () => rmSync(dir, { recursive: true, force: true })
    }
  }

  const PH_ID = 'user:file:com.google.keystone.agent.plist'
  const BROKEN_ID = 'user:file:broken.plist'

  it('list 把它们都列出来:isNotTask / parseError / fileName 齐备', async () => {
    const h = fileHarness()
    try {
      const { agents } = await h.svc.list()
      expect(agents).toHaveLength(2)
      expect(agents.find((a) => a.id === PH_ID)).toMatchObject({
        isNotTask: true,
        fileName: 'com.google.keystone.agent.plist',
        label: '',
        status: 'stopped',
        pid: null
      })
      expect(agents.find((a) => a.id === BROKEN_ID)).toMatchObject({
        isNotTask: true,
        fileName: 'broken.plist',
        parseError: 'missing <plist> root'
      })
    } finally {
      h.cleanup()
    }
  })

  it('同作用域两个非任务文件 id 不同,各自读到自己那份(身份不能撞车)', async () => {
    const h = fileHarness()
    try {
      expect((await h.svc.readXml(PH_ID)).xml).toBe(EMPTY_XML)
      expect((await h.svc.readXml(BROKEN_ID)).xml).toBe('<plist><dict>')
    } finally {
      h.cleanup()
    }
  })

  it('ops 拒绝执行,且零 launchctl 调用(不能 bootstrap 非任务文件)', async () => {
    const h = fileHarness()
    try {
      await expect(h.svc.ops(PH_ID, 'start')).rejects.toThrow(/未定义 launchd 任务/)
      await expect(h.svc.ops(BROKEN_ID, 'disable')).rejects.toThrow(/未定义 launchd 任务/)
      expect(h.opCalls).toEqual([])
    } finally {
      h.cleanup()
    }
  })

  it('clone 拒绝(空 Label 会生成无意义的 .copy)', async () => {
    const h = fileHarness()
    try {
      await expect(h.svc.clone(PH_ID)).rejects.toThrow(/未定义 launchd 任务/)
    } finally {
      h.cleanup()
    }
  })

  it('save 不带 Label → 拒绝(否则落盘后仍是一行置灰,与保存失败无从区分)', async () => {
    const h = fileHarness()
    try {
      await expect(h.svc.save(PH_ID, { label: '', desc: '' })).rejects.toThrow(/请填写 Label/)
      expect(h.writeAtCalls).toEqual([])
      expect(h.writeCalls).toEqual([])
    } finally {
      h.cleanup()
    }
  })

  // ⚠ 数据丢失防线:落进 rename 分支会写新文件 + remove 原文件,把用户的第三方文件删掉
  it('save 带 Label → 原地重写原路径,且绝不 remove 原文件', async () => {
    const h = fileHarness()
    try {
      const agent = await h.svc.save(PH_ID, { label: 'com.new', desc: '' })
      expect(h.writeAtCalls.map((w) => w.path)).toEqual([h.phPath])
      expect(h.writeCalls).toEqual([])
      expect(h.removed).toEqual([])
      expect(agent.id).toBe('user:com.new')
    } finally {
      h.cleanup()
    }
  })

  it('saveXml 修复损坏文件 → 走 writeAt(守卫会拒绝损坏目标,修复否则无从进行)', async () => {
    const h = fileHarness()
    try {
      await h.svc.saveXml(BROKEN_ID, EMPTY_XML)
      expect(h.writeAtCalls.map((w) => w.path)).toEqual([h.brokenPath])
      expect(h.writeCalls).toEqual([])
    } finally {
      h.cleanup()
    }
  })

  it('remove 删除的就是那个文件', async () => {
    const h = fileHarness()
    try {
      await h.svc.remove(BROKEN_ID)
      expect(h.removed).toEqual([h.brokenPath])
    } finally {
      h.cleanup()
    }
  })
})

