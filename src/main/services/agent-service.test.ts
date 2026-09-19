import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { LaunchctlService } from './launchctl-service'
import { createAgentService, type AgentService } from './agent-service'
import type { SaveOutcome } from '../../shared/models'
import { parsePlistXml } from '../domains/plist-xml'
import type { PlistFile, PlistService } from './plist-service'
import type { ShellRunner } from './shell-runner'

/** 测试助手:读当前 revision 后走 saveForm(等价于渲染层保存一次;不存在的 id 用空 revision) */
async function saveFormLike(
  svc: AgentService,
  id: string,
  patch: Record<string, unknown>,
  applyMode: 'save' | 'saveAndApply' = 'save'
): Promise<SaveOutcome> {
  const rev = await svc.readDocument(id).then((d) => d.revision).catch(() => '')
  return svc.saveForm({ id, expectedRevision: rev, dirtyFields: Object.keys(patch), patch: patch as never, applyMode })
}

async function saveXmlLike(
  svc: AgentService,
  id: string,
  xml: string,
  applyMode: 'save' | 'saveAndApply' = 'save'
): Promise<SaveOutcome> {
  const rev = await svc.readDocument(id).then((d) => d.revision).catch(() => '')
  return svc.saveXml({ id, expectedRevision: rev, xml, applyMode })
}


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
      scanNow: async () => files,
      readFresh: async (_s: string, p: string) => {
        // 真实 PlistService 的 fresh 读:绕过 memo/pending,直读该路径
        const f = files.find((x) => x.path === p)
        return f
          ? { ...f }
          : { path: p, scope: 'user' as const, fileName: p.split('/').pop()!, xml: '', value: {}, label: '', desc: '', isTask: false, parseError: 'ENOENT' }
      },
      dirs: () => [{ scope: 'user' as const, dir, privileged: false }],
      pathFor: (_s: 'user' | 'system' | 'daemon', label: string) => join(dir, `${label}.plist`),
      write: vi.fn(async (_s: string, path: string, xml: string) => {
        writeCalls.push({ path, xml })
      }),
      writeAt: vi.fn(async (_s: string, path: string, xml: string) => {
        writeAtCalls.push({ path, xml })
        // 就地重写后按写入内容更新记录(补了 Label → 成为任务;仍无 Label → 保持占位),让后续 findAgent 命中
        const m = xml.match(/<key>Label<\/key>\s*<string>([^<]*)<\/string>/)
        const rec = files.find((f) => f.path === path)
        if (rec) {
          rec.isTask = m !== null
          rec.label = m ? m[1] : ''
          rec.value = m ? { Label: m[1] } : {}
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
      expect((await h.svc.readDocument(PH_ID)).sourceXml).toBe(EMPTY_XML)
      expect((await h.svc.readDocument(BROKEN_ID)).sourceXml).toBe('<plist><dict>')
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
      const doc = await h.svc.readDocument(PH_ID)
      const outcome = await h.svc.clone({ id: PH_ID, expectedRevision: doc.revision })
      expect(outcome).toMatchObject({ ok: false, kind: 'invalid' })
      expect(outcome.ok === false && outcome.message).toMatch(/未定义 launchd 任务/)
    } finally {
      h.cleanup()
    }
  })

  it('save 不带 Label → 拒绝(否则落盘后仍是一行置灰,与保存失败无从区分)', async () => {
    const h = fileHarness()
    try {
      const outcome = await saveFormLike(h.svc, PH_ID, { label: '', desc: '' })
      expect(outcome).toMatchObject({ ok: false, kind: 'invalid' })
      expect(outcome.ok === false && outcome.message).toMatch(/请填写 Label/)
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
      const outcome = await saveFormLike(h.svc, PH_ID, { label: 'com.new', desc: '', program: '/bin/echo' })
      expect(h.writeAtCalls.map((w) => w.path)).toEqual([h.phPath])
      expect(h.writeCalls).toEqual([])
      expect(h.removed).toEqual([])
      // 非任务转正后必须返回新的任务 id(P0-4)
      expect(outcome.ok && 'document' in outcome && outcome.document.id).toBe('user:com.new')
    } finally {
      h.cleanup()
    }
  })

  it('saveXml 修复损坏文件 → 走 writeAt(守卫会拒绝损坏目标,修复否则无从进行)', async () => {
    const h = fileHarness()
    try {
      const outcome = await saveXmlLike(h.svc, BROKEN_ID, EMPTY_XML)
      expect(outcome.ok).toBe(true)
      expect(h.writeAtCalls.map((w) => w.path)).toEqual([h.brokenPath])
      expect(h.writeCalls).toEqual([])
    } finally {
      h.cleanup()
    }
  })

  it('XML 转正:新 Label 与同作用域其他任务重名 → 拒绝且零写盘(P1)', async () => {
    const h = fileHarness()
    try {
      // 同作用域已有 com.other;占位文件 phPath 无 Label
      h.files.push({
        path: join(h.phPath, '..', 'com.other.plist'),
        scope: 'user',
        fileName: 'com.other.plist',
        xml: EMPTY_XML,
        value: { Label: 'com.other' },
        label: 'com.other',
        desc: '',
        isTask: true
      })
      const doc = await h.svc.readDocument(PH_ID)
      const xml = `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>com.other</string><key>ProgramArguments</key><array><string>/bin/echo</string></array></dict></plist>`
      const outcome = await h.svc.saveXml({ id: PH_ID, expectedRevision: doc.revision, xml, applyMode: 'save' })
      expect(outcome.ok).toBe(false)
      expect(outcome.ok === false && outcome.message).toMatch(/已存在同名任务/)
      expect(h.writeAtCalls).toEqual([])
    } finally {
      h.cleanup()
    }
  })

  it('remove 删除的就是那个文件', async () => {
    const h = fileHarness()
    try {
      const doc = await h.svc.readDocument(BROKEN_ID)
      const outcome = await h.svc.remove(BROKEN_ID, doc.revision)
      expect(outcome.ok).toBe(true)
      expect(h.removed).toEqual([h.brokenPath])
    } finally {
      h.cleanup()
    }
  })
})


// ── 保存守卫与键保留:表单拥有父键的部分拦下;顶层非托管键原样保留(本机 19/32 真实 plist 含此类键) ──
describe('agent-service.save 守卫与保留', () => {
  function saveHarness(
    files: { label: string; value?: Record<string, unknown>; xml?: string }[],
    existingFile: { present: boolean; value?: Record<string, unknown>; readable?: boolean; xml?: string }
  ) {
    const dir = mkdtempSync(join(tmpdir(), 'agent-save-'))
    const write = vi.fn(async (_s: string, p: string, xml: string) => {
      // 真实环境写盘会 invalidate 并重扫:让后续 findAgent 能看到这份新文件
      const label = p.split('/').pop()!.replace(/\.plist$/, '')
      const existing = files.find((f) => f.label === label)
      if (existing) existing.value = { ...(existing.value ?? { Label: label }), Label: label }
      else files.push({ label, value: { Label: label } })
      void xml
    })
    const plists = {
      readFresh: async (_s: string, p: string) => {
        // 真实 PlistService 的 fresh 读:绕过 memo/pending,直读该路径(记录形态与 scanAll 一致,revision 才可比对)
        const label = p.split('/').pop()!.replace(/\.plist$/, '')
        const hit = files.find((f) => f.label === label)
        return {
          path: p,
          scope: 'user' as const,
          fileName: `${label}.plist`,
          // fresh 读必须与 scanAll 同源(同一份原文),否则 revision 比对会假冲突
          xml: hit?.xml ?? `<plist version="1.0"><dict><key>Label</key><string>${label}</string></dict></plist>`,
          value: hit ? (hit.value ?? { Label: hit.label }) : { Label: label },
          label,
          desc: '',
          isTask: true
        }
      },
      scanAll: async () =>
        files.map((f) => ({
          path: join(dir, `${f.label}.plist`),
          scope: 'user' as const,
          fileName: `${f.label}.plist`,
          xml: f.xml ?? `<plist version="1.0"><dict><key>Label</key><string>${f.label}</string></dict></plist>`,
          value: f.value ?? { Label: f.label },
          label: f.label,
          desc: '',
          isTask: true
        })),
      scanNow: async () =>
        files.map((f) => ({
          path: join(dir, `${f.label}.plist`),
          scope: 'user' as const,
          fileName: `${f.label}.plist`,
          xml: `<plist version="1.0"><dict><key>Label</key><string>${f.label}</string></dict></plist>`,
          value: f.value ?? { Label: f.label },
          label: f.label,
          desc: '',
          isTask: true
        })),
      dirs: () => [{ scope: 'user' as const, dir, privileged: false }],
      pathFor: (_s: string, label: string) => join(dir, `${label}.plist`),
      read: async (_s: string, p: string) => {
        if (existingFile.readable === false) throw new Error('unreadable')
        return {
          path: p,
          scope: 'user' as const,
          fileName: '',
          // xml 供「保真锁」用例:<data>/<date>/多注释 必须由 sourceXml 判定
          xml: existingFile.xml ?? '',
          value: existingFile.value ?? { Label: 'x' },
          label: 'x',
          desc: '',
          isTask: true
        }
      },
      write,
      remove: vi.fn(async () => {})
    } as unknown as PlistService
    const launchctl = {
      list: async () => ({ gui: new Map(), system: new Map(), disabled: { gui: new Set<string>(), system: new Set<string>() } }),
      domainOf: () => 'gui/501',
      print: async () => ({ found: false, path: null, pid: null }),
      bootout: vi.fn(async () => {})
    } as unknown as LaunchctlService
    const svc = createAgentService({
      runner: {} as never,
      launchctl,
      plists,
      brew: { list: async () => [] } as never,
      getXmlIndent: () => '  '
    })
    return { svc, dir, write, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
  }

  it('UserName 字段政策:非 daemon scope 的 patch 一律拒绝;daemon 允许(P1)', async () => {
    const u = saveHarness([{ label: 'com.u' }], { present: false })
    try {
      const doc = await u.svc.readDocument('user:com.u')
      const outcome = await u.svc.saveForm({
        id: 'user:com.u',
        expectedRevision: doc.revision,
        dirtyFields: ['userName'],
        patch: { userName: 'root' },
        applyMode: 'save'
      })
      expect(outcome).toMatchObject({ ok: false, kind: 'invalid' })
      expect(u.write).not.toHaveBeenCalled()
    } finally {
      u.cleanup()
    }
  })

  it('既有任务含 KeepAlive 未知子键(表单拥有父键)→ 拒绝保存且零写盘', async () => {
    const h = saveHarness(
      [{ label: 'com.x', value: { Label: 'com.x', KeepAlive: { PathState: { '/x': true } } } }],
      { present: false }
    )
    try {
      const outcome = await saveFormLike(h.svc, 'user:com.x', { label: 'com.x', desc: '' })
      expect(outcome).toMatchObject({ ok: false, kind: 'unsupported' })
      expect(outcome.ok === false && outcome.message).toMatch(/含表单不支持的键:KeepAlive.PathState/)
      expect(h.write).not.toHaveBeenCalled()
    } finally {
      h.cleanup()
    }
  })

  it('既有任务含顶层非托管键(Sockets / MachServices)→ 放行保存,键原样保留', async () => {
    const h = saveHarness(
      [
        {
          label: 'com.x',
          value: { Label: 'com.x', Sockets: { Listeners: { SockServiceName: '12345' } }, MachServices: { 'com.x': true } },
          // 节点级补丁以**原文**为准:未改动的节点原样搬过去,因此夹具的 XML 必须真的含这些键
          xml:
            '<plist version="1.0">\n<dict>\n\t<key>Label</key>\n\t<string>com.x</string>\n' +
            '\t<key>Sockets</key>\n\t<dict>\n\t\t<key>Listeners</key>\n\t\t<dict>\n\t\t\t<key>SockServiceName</key>\n\t\t\t<string>12345</string>\n\t\t</dict>\n\t</dict>\n' +
            '\t<key>MachServices</key>\n\t<dict>\n\t\t<key>com.x</key>\n\t\t<true/>\n\t</dict>\n</dict>\n</plist>'
        }
      ],
      { present: false }
    )
    try {
      // 表单从不触碰这两个键 → 不再锁表单(锁死会让本机 21/32 个真实 plist 无法编辑)
      const outcome = await saveFormLike(h.svc, 'user:com.x', { label: 'com.x', desc: '' })
      expect(outcome.ok).toBe(true)
      const written = String(h.write.mock.calls[0][2])
      // 未改动的节点逐字节保留(含嵌套结构)
      expect(written).toContain('\t<key>Sockets</key>\n\t<dict>\n\t\t<key>Listeners</key>')
      expect(written).toContain('\t<key>MachServices</key>\n\t<dict>')
    } finally {
      h.cleanup()
    }
  })

  it('草稿撞名:同名文件含 <data> / 字典内注释 → 节点级补丁保留原文(不再锁死)', async () => {
    const cases = [
      '<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>com.new</string><key>Blob</key><data>AQ==</data></dict></plist>',
      '<?xml version="1.0"?><plist version="1.0"><dict><!-- 内部注释 --><key>Label</key><string>com.new</string></dict></plist>'
    ]
    for (const xml of cases) {
      const h = saveHarness([], { present: true, value: { Label: 'com.new', ProgramArguments: ['/bin/echo'] }, xml })
      writeFileSync(join(h.dir, 'com.new.plist'), 'x')
      try {
        await h.svc.createDraft('user', 'com.new').catch(() => undefined)
        const outcome = await saveFormLike(h.svc, 'user:com.new', { label: 'com.new', desc: '', program: '/bin/echo' })
        expect(outcome.ok, xml.slice(0, 60)).toBe(true)
        const written = String(h.write.mock.calls[0][2])
        // `<data>` / 注释在未被改动的节点里,必须一字不动地保留
        expect(written).toContain(xml.includes('<data>') ? '<data>AQ==</data>' : '<!-- 内部注释 -->')
      } finally {
        h.cleanup()
      }
    }
  })

  it('草稿落盘时同名文件含未建模顶层键 → 放行覆盖,原键保留', async () => {
    const h = saveHarness([], {
      present: true,
      value: { Label: 'com.new', Sockets: { a: 1 } },
      xml: '<plist version="1.0">\n<dict>\n\t<key>Label</key>\n\t<string>com.new</string>\n\t<key>Sockets</key>\n\t<dict>\n\t\t<key>a</key>\n\t\t<integer>1</integer>\n\t</dict>\n</dict>\n</plist>'
    })
    writeFileSync(join(h.dir, 'com.new.plist'), 'x')
    try {
      await h.svc.createDraft('user', 'com.new').catch(() => undefined)
      const outcome = await saveFormLike(h.svc, 'user:com.new', { label: 'com.new', desc: '', program: '/bin/echo' })
      expect(outcome.ok).toBe(true)
      expect(String(h.write.mock.calls[0][2])).toContain('\t<key>Sockets</key>\n\t<dict>')
    } finally {
      h.cleanup()
    }
  })

  it('草稿落盘时同名文件含表单拥有父键的键 → 拒绝(保不住)', async () => {
    const h = saveHarness([], { present: true, value: { Label: 'com.new', KeepAlive: { OtherJobEnabled: { x: true } } } })
    writeFileSync(join(h.dir, 'com.new.plist'), 'x')
    try {
      await h.svc.createDraft('user', 'com.new').catch(() => undefined)
      const outcome = await saveFormLike(h.svc, 'user:com.new', { label: 'com.new', desc: '', program: '/bin/echo' })
      expect(outcome).toMatchObject({ ok: false, kind: 'unsupported' })
      expect(outcome.ok === false && outcome.message).toMatch(/同名文件已存在且含表单不支持的键/)
      expect(h.write).not.toHaveBeenCalled()
    } finally {
      h.cleanup()
    }
  })

  // ⚠ 这里曾有一条 mock 假阳性用例(「同名文件读不出来仍放行写盘」):它 mock 掉 plists.write,
  // 绕过了真实 PlistService.assertOverwritable —— 真实行为是**拒绝覆盖无法解析的目标**
  // (plist-service.test.ts「write 仍拒绝覆盖损坏目标」覆盖该语义)。草稿撞上损坏文件时
  // main 会抛出覆盖守卫的中文错误,渲染层按失败展示,不会静默写坏别人的 plist。
})

// ── P0-1:Label 是身份,新建/改名必须过校验;非法 label 零写盘、零提权 ──
describe('agent-service Label 安全闸', () => {
  function labelHarness(files: { label: string; value?: Record<string, unknown>; xml?: string }[]) {
    const dir = mkdtempSync(join(tmpdir(), 'agent-label-'))
    const write = vi.fn(async (_s: string, _p: string, _xml: string) => {})
    const writeAt = vi.fn(async (_s: string, _p: string, _xml: string) => {})
    const plists = {
      readFresh: async (_s: string, p: string) => {
        // 真实 PlistService 的 fresh 读:绕过 memo/pending,直读该路径(记录形态与 scanAll 一致,revision 才可比对)
        const label = p.split('/').pop()!.replace(/\.plist$/, '')
        const hit = files.find((f) => f.label === label)
        return {
          path: p,
          scope: 'user' as const,
          fileName: `${label}.plist`,
          // fresh 读必须与 scanAll 同源(同一份原文),否则 revision 比对会假冲突
          xml: hit?.xml ?? `<plist version="1.0"><dict><key>Label</key><string>${label}</string></dict></plist>`,
          value: hit ? (hit.value ?? { Label: hit.label }) : { Label: label },
          label,
          desc: '',
          isTask: true
        }
      },
      scanAll: async () =>
        files.map((f) => ({
          path: join(dir, `${f.label}.plist`),
          scope: 'user' as const,
          fileName: `${f.label}.plist`,
          xml: f.xml ?? `<plist version="1.0"><dict><key>Label</key><string>${f.label}</string></dict></plist>`,
          value: f.value ?? { Label: f.label },
          label: f.label,
          desc: '',
          isTask: true
        })),
      scanNow: async () =>
        files.map((f) => ({
          path: join(dir, `${f.label}.plist`),
          scope: 'user' as const,
          fileName: `${f.label}.plist`,
          xml: `<plist version="1.0"><dict><key>Label</key><string>${f.label}</string></dict></plist>`,
          value: f.value ?? { Label: f.label },
          label: f.label,
          desc: '',
          isTask: true
        })),
      dirs: () => [{ scope: 'user' as const, dir, privileged: false }],
      pathFor: (_s: string, label: string) => join(dir, `${label}.plist`),
      read: async (_s: string, p: string) => ({
        path: p, scope: 'user' as const, fileName: '', xml: '', value: { Label: 'x' }, label: 'x', desc: '', isTask: true
      }),
      write,
      writeAt,
      remove: vi.fn(async () => {}),
      lint: async () => ({ ok: true, error: null })
    } as unknown as PlistService
    const launchctl = {
      list: async () => ({ gui: new Map(), system: new Map(), disabled: { gui: new Set<string>(), system: new Set<string>() } }),
      domainOf: () => 'gui/501',
      print: async () => ({ found: false, path: null, pid: null }),
      bootout: vi.fn(async () => {})
    } as unknown as LaunchctlService
    const svc = createAgentService({
      runner: {} as never,
      launchctl,
      plists,
      brew: { list: async () => [] } as never,
      getXmlIndent: () => '  '
    })
    return { svc, dir, write, writeAt, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
  }

  it('新建草稿:非法 label 零写盘', async () => {
    const h = labelHarness([])
    try {
      for (const bad of ['a b', '../evil', 'a;rm -rf /', '']) {
        await h.svc.createDraft('user', 'draft').catch(() => undefined)
        const outcome = await saveFormLike(h.svc, 'user:draft', { label: bad, desc: '' })
        expect(outcome.ok, bad).toBe(false)
        if (!outcome.ok) expect(outcome.message).toMatch(/Label 不合法|invalid agent id/)
      }
      expect(h.write).not.toHaveBeenCalled()
      expect(h.writeAt).not.toHaveBeenCalled()
    } finally {
      h.cleanup()
    }
  })

  it('createDraft:非法 label 直接拒绝', async () => {
    const h = labelHarness([])
    try {
      await expect(h.svc.createDraft('user', 'a b')).rejects.toThrow(/Label 不合法/)
      await expect(h.svc.createDraft('user', 'ok.label')).resolves.toMatchObject({ label: 'ok.label' })
    } finally {
      h.cleanup()
    }
  })

  it('既有任务改名为非法 label → 拒绝且零写盘;标签不变(即便不规范)仍可保存内容', async () => {
    const h = labelHarness([{ label: 'legacy label with space' }])
    try {
      const renamed = await saveFormLike(h.svc, 'user:legacy label with space', { label: '../evil', desc: '' })
      expect(renamed).toMatchObject({ ok: false, kind: 'invalid' })
      expect(h.write).not.toHaveBeenCalled()
      // 标签不变 → 放行(磁盘上本就不规范的文件仍可改内容)
      const same = await saveFormLike(h.svc, 'user:legacy label with space', { label: 'legacy label with space', desc: '' })
      expect(same.ok).toBe(true)
      expect(h.write).toHaveBeenCalledTimes(1)
    } finally {
      h.cleanup()
    }
  })

  it('XML 改已有任务的 Label → 拒绝并提示改名入口', async () => {
    const h = labelHarness([{ label: 'com.x' }])
    try {
      const xml = `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>com.y</string><key>ProgramArguments</key><array><string>/bin/echo</string></array></dict></plist>`
      const outcome = await saveXmlLike(h.svc, 'user:com.x', xml)
      expect(outcome).toMatchObject({ ok: false, kind: 'rename-required' })
      expect(outcome.ok === false && outcome.message).toMatch(/重命名/)
      expect(h.write).not.toHaveBeenCalled()
      expect(h.writeAt).not.toHaveBeenCalled()
    } finally {
      h.cleanup()
    }
  })
})

// ── P0-2/P0-3/P0-4/P1-1:写入事务(保存 vs 应用 · CAS · 改名 · XML 回源) ──
describe('agent-service 写入事务', () => {
  const XML_OF = (args: string[], extra = ''): string =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>com.tx</string><key>ProgramArguments</key><array>${args
      .map((a) => `<string>${a}</string>`)
      .join('')}</array>${extra}</dict></plist>`

  function txHarness(opts?: {
    loaded?: boolean
    bootstrapFails?: boolean
    scanFrozen?: boolean
    scope?: 'user' | 'system' | 'daemon'
    privilegedRemoveFails?: boolean
  }) {
    const scope = opts?.scope ?? 'user'
    /** 模拟「旧扫描仍在飞 + 外部已改盘」:scanAll 给旧内容,readFresh 读到这里覆盖的新内容 */
    let freshOverride: { path: string; xml: string } | null = null
    /** 指定路径的删除失败(改名事务的旧文件删除回滚用例) */
    let failRemovePath: string | null = null
    /** 模拟磁盘上已消失但扫描仍有记录的路径 */
    let missingPath: string | null = null
    /** 写动作发生后注入的重复 Label(模拟外部进程抢名) */
    let dupAfterWrite: string | null = null
    const dir = mkdtempSync(join(tmpdir(), 'agent-tx-'))
    const path = join(dir, 'com.tx.plist')
    const xml0 = XML_OF(['/bin/echo', 'v1'])
    const files: PlistFile[] = [
      {
        path,
        scope,
        fileName: 'com.tx.plist',
        xml: xml0,
        value: { Label: 'com.tx', ProgramArguments: ['/bin/echo', 'v1'] },
        label: 'com.tx',
        desc: '',
        isTask: true
      }
    ]
    const frozenCount = files.length
    const calls: string[] = []
    const written: string[] = []
    // 并发守卫:同一时刻只允许一个受锁保护的动作在跑。无锁时两个流程会在此交错 → violations 非空
    const violations: string[] = []
    let busy = false
    const guarded = <T>(tag: string, fn: () => T | Promise<T>): Promise<T> => {
      if (busy) violations.push(tag)
      busy = true
      return Promise.resolve()
        .then(() => new Promise((r) => setTimeout(r, 0))) // 让出事件循环:无锁时并发流程会在此重叠
        .then(fn)
        .finally(() => {
          busy = false
        })
    }
    const applyToRecord = (p: string, xml: string): void => {
      const rec = files.find((f) => f.path === p)
      const parsed = parsePlistXml(xml)
      if (!rec || !parsed.ok) return
      rec.xml = xml
      rec.value = parsed.value
      rec.label = typeof parsed.value.Label === 'string' ? parsed.value.Label : ''
      rec.isTask = rec.label !== ''
    }
    const tables = {
      gui: new Map<string, { label: string; pid: number | null; lastExitCode: number | null }>(),
      system: new Map<string, { label: string; pid: number | null; lastExitCode: number | null }>(),
      disabled: { gui: new Set<string>(), system: new Set<string>() }
    }
    if (opts?.loaded) {
      const table = scope === 'daemon' ? tables.system : tables.gui
      table.set('com.tx', { label: 'com.tx', pid: null, lastExitCode: null })
    }
    const launchctl = {
      list: vi.fn(async () => tables),
      domainOf: () => 'gui/501',
      bootout: vi.fn((_p?: string) => guarded('bootout', () => {
        calls.push('bootout')
      })),
      bootstrap: vi.fn((_p?: string) =>
        guarded('bootstrap', () => {
          calls.push('bootstrap')
          // 只让首次(应用新内容)失败:回滚后重载旧配置应当成功
          if (opts?.bootstrapFails && calls.filter((c) => c === 'bootstrap').length === 1) {
            throw new Error('bootstrap failed: 5')
          }
        })
      ),
      kickstart: vi.fn((_l?: string) =>
        guarded('kickstart', () => {
          calls.push('kickstart')
        })
      ),
      print: vi.fn(async () => ({ found: false, path: null, pid: null }))
    } as unknown as LaunchctlService
    const plists = {
      // 快照:真实服务每次重新读盘(found.pf 必须是当时的副本,否则「回滚」会写回被覆盖后的内容);
      // scanFrozen = 模拟「旧 pending 扫描仍在飞」:写前开始的扫描看不到新建/改名出来的文件
      scanNow: async () => files.map((f) => ({ ...f })),
      scanAll: async () => (opts?.scanFrozen ? files.slice(0, frozenCount).map((f) => ({ ...f })) : files.map((f) => ({ ...f }))),
      readFresh: async (_s: string, p: string) => {
        // 真实 PlistService 的 fresh 读:绕过 memo/pending,直读该路径
        if (missingPath === p) {
          return {
            path: p,
            scope: 'user' as const,
            fileName: p.split('/').pop()!,
            xml: '',
            value: {},
            label: '',
            desc: '',
            isTask: false,
            parseError: 'ENOENT: no such file or directory'
          }
        }
        if (freshOverride && p === freshOverride.path) {
          const parsed = parsePlistXml(freshOverride.xml)
          return {
            path: p,
            scope: 'user' as const,
            fileName: p.split('/').pop()!,
            xml: freshOverride.xml,
            value: parsed.ok ? parsed.value : {},
            label: parsed.ok && typeof parsed.value.Label === 'string' ? parsed.value.Label : '',
            desc: '',
            isTask: true
          }
        }
        const f = files.find((x) => x.path === p)
        return f
          ? { ...f }
          : { path: p, scope: 'user' as const, fileName: p.split('/').pop()!, xml: '', value: {}, label: '', desc: '', isTask: false, parseError: 'ENOENT' }
      },
      dirs: () => [{ scope: 'user' as const, dir, privileged: false }],
      pathFor: (_s: string, label: string) => join(dir, `${label}.plist`),
      read: async (_s: string, p: string) => {
        const f = files.find((x) => x.path === p)
        return f ? { ...f } : null
      },
      write: vi.fn((_s: string, p: string, xml: string) => guarded('write', () => {
        written.push(xml)
        if (dupAfterWrite !== null) {
          files.push({
            // 不同文件名、同 Label(模拟外部进程抢名;同路径会被自校验按 writtenPath 过滤掉)
            path: join(dir, `foreign-${dupAfterWrite}.plist`),
            scope,
            fileName: `foreign-${dupAfterWrite}.plist`,
            xml: '',
            value: { Label: dupAfterWrite },
            label: dupAfterWrite,
            desc: '',
            isTask: true
          })
        }
        if (files.some((f) => f.path === p)) applyToRecord(p, xml)
        else {
          // 新路径(改名/新建):建档,让后续 findAgent 能命中
          const parsed = parsePlistXml(xml)
          if (parsed.ok) {
            files.push({
              path: p,
              scope: 'user',
              fileName: p.split('/').pop()!,
              xml,
              value: parsed.value,
              label: typeof parsed.value.Label === 'string' ? parsed.value.Label : '',
              desc: '',
              isTask: typeof parsed.value.Label === 'string'
            })
          }
        }
      })),
      writeAt: vi.fn((_s: string, p: string, xml: string) =>
        guarded('writeAt', () => {
          written.push(xml)
          applyToRecord(p, xml)
        })
      ),
      remove: vi.fn((_s: string, p: string) =>
        guarded('remove', () => {
          if (failRemovePath === p) throw new Error('rm: Operation not permitted')
        })
      ),
      removeWithBootout: vi.fn(async (_s: string, _p: string, loaded: boolean) => ({
        bootoutDone: loaded,
        fileDeleted: opts?.privilegedRemoveFails !== true,
        cancelled: false,
        stderr: opts?.privilegedRemoveFails === true ? 'rm: Operation not permitted' : null
      })),
      lint: vi.fn(async () => ({ ok: true, error: null }))
    } as unknown as PlistService
    const svc = createAgentService({
      runner: {} as never,
      launchctl,
      plists,
      brew: { list: async () => [] } as never,
      getXmlIndent: () => '  '
    })
    return {
      svc,
      calls,
      written,
      files,
      path,
      launchctl,
      violations,
      setFreshOverride: (path: string, xml: string) => {
        freshOverride = { path, xml }
      },
      /** 模拟「扫描缓存里还有、磁盘上已删」:fresh 读返回 ENOENT 记录 */
      setFreshMissing: (path: string) => {
        missingPath = path
      },
      /** 模拟外部抢名:write 成功后目录里多出一份同 Label 文件 */
      setDupAfterWrite: (label: string) => {
        dupAfterWrite = label
      },
      /** 往扫描视图里塞一条别的作用域记录(验证跨 scope 同 Label 可共存) */
      addForeignScopeRecord: (foreignScope: 'user' | 'system' | 'daemon', label: string) => {
        files.push({
          path: join(dir, `foreign-${label}.plist`),
          scope: foreignScope,
          fileName: `foreign-${label}.plist`,
          xml: '',
          value: { Label: label },
          label,
          desc: '',
          isTask: true
        })
      },
      failRemoveOn: (p: string) => {
        failRemovePath = p
      },
      cleanup: () => rmSync(dir, { recursive: true, force: true })
    }
  }

  it('save:已载入任务也**零** launchctl 调用(只写文件)', async () => {
    const h = txHarness({ loaded: true })
    try {
      const doc = await h.svc.readDocument('user:com.tx')
      const outcome = await h.svc.saveForm({
        id: 'user:com.tx',
        expectedRevision: doc.revision,
        dirtyFields: ['args'],
        patch: { label: 'com.tx', args: ['v2'] },
        applyMode: 'save'
      })
      expect(outcome.ok).toBe(true)
      expect(h.calls).toEqual([])
      expect(h.launchctl.list).not.toHaveBeenCalled()
      expect(outcome.ok && outcome.report).toMatchObject({ wasLoaded: null, applied: false })
      expect(h.written[0]).toContain('v2')
    } finally {
      h.cleanup()
    }
  })

  it('saveAndApply:bootout → bootstrap 顺序执行,报告 applied(不 kickstart)', async () => {
    const h = txHarness({ loaded: true })
    try {
      const doc = await h.svc.readDocument('user:com.tx')
      const outcome = await h.svc.saveForm({
        id: 'user:com.tx',
        expectedRevision: doc.revision,
        dirtyFields: ['args'],
        patch: { label: 'com.tx', args: ['v3'] },
        applyMode: 'saveAndApply'
      })
      expect(outcome.ok).toBe(true)
      expect(h.calls).toEqual(['bootout', 'bootstrap'])
      expect(outcome.ok && outcome.report).toMatchObject({ wasLoaded: true, applied: true, fileRolledBack: false })
    } finally {
      h.cleanup()
    }
  })

  it('saveAndApply:bootstrap 失败 → 回滚文件并重新载入旧配置,分阶段结果如实上报', async () => {
    const h = txHarness({ loaded: true, bootstrapFails: true })
    try {
      const doc = await h.svc.readDocument('user:com.tx')
      const outcome = await h.svc.saveForm({
        id: 'user:com.tx',
        expectedRevision: doc.revision,
        dirtyFields: ['args'],
        patch: { label: 'com.tx', args: ['v4'] },
        applyMode: 'saveAndApply'
      })
      // P1:应用失败不再当成功 —— 必须返回失败,页面才能给红/黄的分阶段结果
      expect(outcome.ok).toBe(false)
      expect(outcome.ok === false && outcome.kind).toBe('write-failed')
      expect(outcome.ok === false && outcome.message).toMatch(/重新载入失败:已回滚到保存前配置/)
      const report = outcome.ok === false ? outcome.report : null
      expect(report).toMatchObject({ fileWritten: true, fileRolledBack: true, applied: false, nowLoaded: true })
      // 文件已回滚到保存前内容
      expect(h.written.at(-1)).toContain('v1')
    } finally {
      h.cleanup()
    }
  })

  it('revision 冲突:零写盘 + 返回最新文档(P1-1)', async () => {
    const h = txHarness()
    try {
      const outcome = await h.svc.saveForm({
        id: 'user:com.tx',
        expectedRevision: 'stale-revision',
        dirtyFields: ['args'],
        patch: { label: 'com.tx', args: ['x'] },
        applyMode: 'save'
      })
      expect(outcome).toMatchObject({ ok: false, kind: 'conflict' })
      expect(h.written).toEqual([])
      expect(outcome.ok === false && outcome.latest?.sourceXml).toContain('v1')
    } finally {
      h.cleanup()
    }
  })

  it('进行中扫描下的 CAS:scanAll 仍是旧内容、fresh 读到外部改动 → conflict 且零写盘(P1)', async () => {
    const h = txHarness()
    try {
      const doc = await h.svc.readDocument('user:com.tx')
      // 外部编辑器改了盘;旧扫描(scanAll)仍返回旧 XML,fresh 读能看到新内容
      h.setFreshOverride(h.path, XML_OF(['/bin/echo', 'externally-edited']))
      const outcome = await h.svc.saveForm({
        id: 'user:com.tx',
        expectedRevision: doc.revision,
        dirtyFields: ['args'],
        patch: { args: ['mine'] },
        applyMode: 'save'
      })
      expect(outcome).toMatchObject({ ok: false, kind: 'conflict' })
      expect(h.written).toEqual([])
      // latest 必须是 fresh 的内容(而不是缓存扫描的旧内容)
      expect(outcome.ok === false && outcome.latest?.sourceXml).toContain('externally-edited')
    } finally {
      h.cleanup()
    }
  })

  it('renameAgent / clone:含 <data> 的文件走节点级补丁 —— 只改 Label,<data> 原文保留(P1)', async () => {
    const h = txHarness()
    try {
      h.files[0].xml =
        '<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>com.tx</string><key>Blob</key><data>AQ==</data></dict></plist>'
      const doc = await h.svc.readDocument('user:com.tx')
      const renamed = await h.svc.renameAgent({
        id: 'user:com.tx',
        expectedRevision: doc.revision,
        newLabel: 'com.tx2',
        applyMode: 'save'
      })
      expect(renamed.ok).toBe(true)
      const written = h.written.at(-1) ?? ''
      expect(written).toContain('<data>AQ==</data>') // 未被改动的节点一字不动
      expect(written).toContain('<string>com.tx2</string>') // 只有 Label 变了
      const cloned = await h.svc.clone({ id: 'user:com.tx2', expectedRevision: renamed.ok && 'document' in renamed ? renamed.document.revision : '' })
      expect(cloned.ok).toBe(true)
      expect(h.written.at(-1)).toContain('<data>AQ==</data>')
    } finally {
      h.cleanup()
    }
  })

  it('改名:旧文件删除失败 → 回滚(卸载并删除新任务、重新载入旧任务)并如实上报(P1)', async () => {
    const h = txHarness({ loaded: true })
    try {
      const doc = await h.svc.readDocument('user:com.tx')
      h.failRemoveOn(h.path)
      const outcome = await h.svc.renameAgent({
        id: 'user:com.tx',
        expectedRevision: doc.revision,
        newLabel: 'com.tx2',
        applyMode: 'saveAndApply'
      })
      expect(outcome.ok).toBe(false)
      expect(outcome.ok === false && outcome.report).toMatchObject({ fileRolledBack: true, applied: false, nowLoaded: true })
      // 迁移(bootout+bootstrap)→ 回滚(bootout 新 + bootstrap 旧)
      expect(h.calls).toEqual(['bootout', 'bootstrap', 'bootout', 'bootstrap'])
    } finally {
      h.cleanup()
    }
  })

  it('写后回源不经扫描:旧 pending 扫描下改名成功仍返回新文档(P1)', async () => {
    const h = txHarness({ scanFrozen: true })
    try {
      const doc = await h.svc.readDocument('user:com.tx')
      const outcome = await h.svc.renameAgent({
        id: 'user:com.tx',
        expectedRevision: doc.revision,
        newLabel: 'com.tx.new',
        applyMode: 'save'
      })
      expect(outcome.ok).toBe(true)
      expect(outcome.ok && 'document' in outcome && outcome.document.id).toBe('user:com.tx.new')
      expect(outcome.ok && 'document' in outcome && outcome.document.path).toContain('com.tx.new.plist')
    } finally {
      h.cleanup()
    }
  })

  it('删除:文件删除失败 → 尝试恢复运行态并给出结构化失败(不留「文件在、任务没了」)', async () => {
    const h = txHarness({ loaded: true })
    try {
      const doc = await h.svc.readDocument('user:com.tx')
      h.failRemoveOn(h.path)
      const outcome = await h.svc.remove('user:com.tx', doc.revision)
      expect(outcome.ok).toBe(false)
      expect(outcome.ok === false && outcome.message).toMatch(/删除文件失败/)
      expect(outcome.ok === false && outcome.report).toMatchObject({ wasLoaded: true, nowLoaded: true })
      expect(h.calls).toEqual(['bootout', 'bootstrap']) // 卸载 → 删失败 → 重新载入
    } finally {
      h.cleanup()
    }
  })

  it('外部删除原文件后:CAS 视为 not-found,不静默重建(P1)', async () => {
    const h = txHarness()
    try {
      const doc = await h.svc.readDocument('user:com.tx')
      // 外部删除了 plist(模拟:扫描与 fresh 都看不到)
      h.files.length = 0
      const saved = await h.svc.saveForm({
        id: 'user:com.tx',
        expectedRevision: doc.revision,
        dirtyFields: ['args'],
        patch: { args: ['recreate?'] },
        applyMode: 'save'
      })
      expect(saved).toMatchObject({ ok: false, kind: 'not-found' })
      expect(h.written).toEqual([]) // 绝不重建

      const removed = await h.svc.remove('user:com.tx', doc.revision)
      expect(removed).toMatchObject({ ok: false, kind: 'not-found' })
    } finally {
      h.cleanup()
    }
  })

  it('外部删除但扫描缓存未过期 → 仍判 not-found(fresh 读不到该路径)(P1)', async () => {
    const h = txHarness()
    try {
      const doc = await h.svc.readDocument('user:com.tx')
      // scanAll 仍返回旧记录(缓存),但 fresh 读指向一个已消失的文件
      h.setFreshMissing(h.path)
      const saved = await h.svc.saveForm({
        id: 'user:com.tx',
        expectedRevision: doc.revision,
        dirtyFields: ['args'],
        patch: { args: ['x'] },
        applyMode: 'save'
      })
      expect(saved).toMatchObject({ ok: false, kind: 'not-found' })
      expect(h.written).toEqual([])
    } finally {
      h.cleanup()
    }
  })

  it('CAS 通过后的配置源必须是 fresh:缓存快照里的字段不被写回旧值(P1)', async () => {
    const h = txHarness()
    try {
      // 外部改写:磁盘(fresh)的参数变化必须作为唯一配置源,扫描缓存仍是旧内容
      const freshXml =
        '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>com.tx</string>' +
        '<key>ProgramArguments</key><array><string>/bin/echo</string><string>v1</string></array>' +
        '</dict></plist>'
      h.setFreshOverride(h.path, freshXml)
      const { createHash } = await import('node:crypto')
      const freshRev = createHash('sha1').update(freshXml, 'utf8').digest('hex')
      const outcome = await h.svc.saveForm({
        id: 'user:com.tx',
        expectedRevision: freshRev,
        dirtyFields: ['args'],
        patch: { args: ['v9'] },
        applyMode: 'save'
      })
      expect(outcome.ok).toBe(true)
      // 只改了 args;必须基于 fresh 的 v1 内容生成
      expect(h.written.at(-1)).toContain('v9')
    } finally {
      h.cleanup()
    }
  })

  it('跨作用域同 Label 合法共存:daemon 新建不被 user 的同名任务挡住(P1)', async () => {
    const h = txHarness({ scope: 'daemon' })
    try {
      h.addForeignScopeRecord('user', 'com.same')
      await h.svc.createDraft('daemon', 'com.same')
      const outcome = await h.svc.saveForm({
        id: 'daemon:com.same',
        expectedRevision: '',
        dirtyFields: ['label', 'program'],
        patch: { label: 'com.same', program: '/bin/echo' },
        applyMode: 'save'
      })
      expect(outcome.ok).toBe(true)
    } finally {
      h.cleanup()
    }
  })

  it('改名:写入期间被外部抢名 → 撤销本次改名并报冲突(P1)', async () => {
    const h = txHarness()
    try {
      const doc = await h.svc.readDocument('user:com.tx')
      h.setDupAfterWrite('com.tx2') // 新 Label 在写入后被别的文件占用
      const outcome = await h.svc.renameAgent({
        id: 'user:com.tx',
        expectedRevision: doc.revision,
        newLabel: 'com.tx2',
        applyMode: 'save'
      })
      expect(outcome).toMatchObject({ ok: false, kind: 'conflict' })
      // 旧文件仍在(未被删),新文件已被撤销
      expect(h.files.some((f) => f.path === h.path)).toBe(true)
    } finally {
      h.cleanup()
    }
  })

  it('删除:缺 expectedRevision → 直接拒绝,不触碰文件(P1)', async () => {
    const h = txHarness()
    try {
      const outcome = await h.svc.remove('user:com.tx', undefined as never)
      expect(outcome).toMatchObject({ ok: false, kind: 'invalid' })
      expect(h.files.some((f) => f.path === h.path)).toBe(true)
    } finally {
      h.cleanup()
    }
  })

  it('并发:saveAndApply 与 stop 不交错(同一把锁,先到先做)(P1)', async () => {
    const h = txHarness({ loaded: true })
    try {
      const doc = await h.svc.readDocument('user:com.tx')
      const [saved, ops] = await Promise.all([
        h.svc.saveForm({
          id: 'user:com.tx',
          expectedRevision: doc.revision,
          dirtyFields: ['args'],
          patch: { args: ['v2'] },
          applyMode: 'saveAndApply'
        }),
        h.svc.ops('user:com.tx', 'stop')
      ])
      expect(h.violations).toEqual([]) // 两个流程没有交错
      expect(saved.ok).toBe(true)
      expect(ops).toBeDefined()
      // 保存并应用(bootout→bootstrap)与停止(bootout)按锁序各跑完整,不会互相插队
      expect(h.calls).toEqual(['bootout', 'bootstrap', 'bootout'])
    } finally {
      h.cleanup()
    }
  })

  it('并发:delete 与 start 不交错(P1)', async () => {
    const h = txHarness()
    try {
      const doc = await h.svc.readDocument('user:com.tx')
      const [removed] = await Promise.all([
        h.svc.remove('user:com.tx', doc.revision),
        h.svc.ops('user:com.tx', 'start').catch((err) => String(err))
      ])
      expect(h.violations).toEqual([])
      expect(removed.ok).toBe(true)
    } finally {
      h.cleanup()
    }
  })

  it('特权删除:bootout 成功但文件没删掉 → 重新载入原任务并按失败上报(P1)', async () => {
    const h = txHarness({ scope: 'daemon', loaded: true, privilegedRemoveFails: true })
    try {
      const doc = await h.svc.readDocument('daemon:com.tx')
      const outcome = await h.svc.remove('daemon:com.tx', doc.revision)
      expect(outcome.ok).toBe(false)
      expect(outcome.ok === false && outcome.message).toMatch(/删除文件失败/)
      expect(outcome.ok === false && outcome.report).toMatchObject({ wasLoaded: true, nowLoaded: true })
      expect(h.calls).toEqual(['bootstrap']) // 未走用户域 bootout,而是恢复性 bootstrap
    } finally {
      h.cleanup()
    }
  })

  it('XML 保存后表单再保存不回滚 XML 改动(P0-3)', async () => {
    const h = txHarness()
    try {
      const doc0 = await h.svc.readDocument('user:com.tx')
      const xmlOutcome = await h.svc.saveXml({
        id: 'user:com.tx',
        expectedRevision: doc0.revision,
        xml: XML_OF(['/bin/echo', 'from-xml']),
        applyMode: 'save'
      })
      expect(xmlOutcome.ok).toBe(true)
      const doc1 = xmlOutcome.ok && 'document' in xmlOutcome ? xmlOutcome.document : null
      expect(doc1?.sourceXml).toContain('from-xml')
      // 只改描述(不碰参数)→ 参数应保持 XML 里刚写的值
      const formOutcome = await h.svc.saveForm({
        id: 'user:com.tx',
        expectedRevision: doc1!.revision,
        dirtyFields: ['desc'],
        patch: { desc: 'note' },
        applyMode: 'save'
      })
      expect(formOutcome.ok).toBe(true)
      expect(h.written.at(-1)).toContain('from-xml')
    } finally {
      h.cleanup()
    }
  })

  it('renameAgent:成功 → 旧文件删除、新身份返回;已载入 + save → 拒绝;目标已存在 → 拒绝', async () => {
    const h = txHarness({ loaded: true })
    try {
      const doc = await h.svc.readDocument('user:com.tx')
      const refused = await h.svc.renameAgent({
        id: 'user:com.tx',
        expectedRevision: doc.revision,
        newLabel: 'com.tx2',
        applyMode: 'save'
      })
      expect(refused).toMatchObject({ ok: false, kind: 'invalid' })

      const ok = await h.svc.renameAgent({
        id: 'user:com.tx',
        expectedRevision: doc.revision,
        newLabel: 'com.tx2',
        applyMode: 'saveAndApply'
      })
      expect(ok.ok).toBe(true)
      expect(ok.ok && 'document' in ok && ok.document.id).toBe('user:com.tx2')
      expect(h.calls).toEqual(['bootout', 'bootstrap'])
    } finally {
      h.cleanup()
    }
  })

  it('普通已存在任务也校验 StartInterval，负值不能被静默省略', async () => {
    const h = txHarness()
    try {
      const doc = await h.svc.readDocument('user:com.tx')
      const outcome = await h.svc.saveForm({
        id: 'user:com.tx',
        expectedRevision: doc.revision,
        dirtyFields: ['triggers'],
        patch: { label: 'com.tx', triggers: { startInterval: -1 } as never },
        applyMode: 'save'
      })
      expect(outcome).toMatchObject({ ok: false, kind: 'invalid' })
      expect(h.written).toEqual([])
    } finally {
      h.cleanup()
    }
  })

  it('删除成功返回 removed 结果而非伪造空 AgentDocument', async () => {
    const h = txHarness()
    try {
      const doc = await h.svc.readDocument('user:com.tx')
      const outcome = await h.svc.remove('user:com.tx', doc.revision)
      expect(outcome).toMatchObject({ ok: true, removed: true })
      expect(outcome.ok && 'document' in outcome).toBe(false)
    } finally {
      h.cleanup()
    }
  })
})

// ── P1:system 日志 predicate 转义(历史 Label 可能含引号/反斜杠) ──
describe('agent-service system 日志 predicate 转义', () => {
  it('Label 含引号/反斜杠 → predicate 字面量被转义,不改变查询语义', async () => {
    const calls: string[][] = []
    const runner = {
      run: async (_f: string, args: string[]) => {
        calls.push(args)
        return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false, error: null }
      }
    } as unknown as ShellRunner
    const label = 'legacy"label\\x'
    const rec = {
      path: '/tmp/legacy.plist',
      scope: 'user' as const,
      fileName: 'legacy.plist',
      xml: '',
      value: { Label: label },
      label,
      desc: '',
      isTask: true
    }
    const plists = {
      scanAll: async () => [rec],
      scanNow: async () => [rec],
      readFresh: async () => rec,
      dirs: () => [{ scope: 'user' as const, dir: '/tmp', privileged: false }],
      pathFor: (_s: string, l: string) => `/tmp/${l}.plist`
    } as unknown as PlistService
    const svc = createAgentService({
      runner,
      launchctl: {} as never,
      plists,
      brew: {} as never,
      getXmlIndent: () => '  '
    })
    const id = `user:${label}`
    await svc.readLogs(id, 'system').catch(() => [])
    const args = calls[0]
    const pred = args[args.indexOf('--predicate') + 1]
    expect(pred).not.toContain(`== "${label}"`) // 未转义的原文不得出现
    expect(pred).toContain('\\"') // 引号被转义
    expect(pred).toContain('\\\\') // 反斜杠被转义
  })
})
