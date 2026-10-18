// 工具层契约与边界的回归:22 个工具(14 只读 + 8 写)、写工具必备授权摘要、
// 以及最容易出错的几类目标(跨作用域同名 / 非任务文件 / 损坏 plist / 找不到 / 附件路径闸门)
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePlistXml } from '../../domains/plist-xml'
import { createToolRegistry } from './index'
import type { Agent, PortService } from '../../../shared/models'
import type {
  Note,
  NoteCreateInput,
  NoteMeta,
  NoteRemoveInput,
  NoteSaveInput
} from '../../../shared/notes'
import type { ToolDef } from '../tool-types'

const HOME = '/Users/tester'

function agent(over: Partial<Agent> & { id: string }): Agent {
  return {
    label: '',
    desc: '',
    status: 'stopped',
    pid: null,
    uptime: null,
    scope: 'user',
    tags: [],
    program: '',
    exitCode: null,
    restarts: 0,
    ...over
  }
}

const AGENTS: Agent[] = [
  agent({ id: 'user:com.user.alpha', label: 'com.user.alpha', scope: 'user', status: 'running', pid: 42 }),
  agent({ id: 'daemon:com.user.alpha', label: 'com.user.alpha', scope: 'daemon', status: 'stopped' }),
  agent({ id: 'user:com.user.beta', label: 'com.user.beta', scope: 'user', status: 'stopped', exitCode: 1, restarts: 3 }),
  agent({ id: 'user:file:placeholder.plist', label: '', fileName: 'placeholder.plist', scope: 'user', isNotTask: true }),
  agent({ id: 'user:file:broken.plist', label: '', fileName: 'broken.plist', scope: 'user', parseError: 'Unexpected EOF' }),
  agent({ id: 'user:homebrew.mxcl.redis', label: 'homebrew.mxcl.redis', scope: 'user', isBrew: true })
]

const FILES = [
  {
    path: `${HOME}/Library/LaunchAgents/com.user.alpha.plist`,
    scope: 'user' as const,
    fileName: 'com.user.alpha.plist',
    label: 'com.user.alpha',
    isTask: true,
    xml: '<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>com.user.alpha</string></dict></plist>',
    value: { Label: 'com.user.alpha' }
  },
  {
    path: `${HOME}/Library/LaunchAgents/com.user.beta.plist`,
    scope: 'user' as const,
    fileName: 'com.user.beta.plist',
    label: 'com.user.beta',
    isTask: true,
    xml: '',
    value: { Label: 'com.user.beta', StartCalendarInterval: {} }
  },
  {
    path: `${HOME}/Library/LaunchAgents/homebrew.mxcl.redis.plist`,
    scope: 'user' as const,
    fileName: 'homebrew.mxcl.redis.plist',
    label: 'homebrew.mxcl.redis',
    isTask: true,
    xml: '<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>homebrew.mxcl.redis</string></dict></plist>',
    value: { Label: 'homebrew.mxcl.redis' }
  },
  { path: `${HOME}/Library/LaunchAgents/placeholder.plist`, scope: 'user' as const, fileName: 'placeholder.plist', label: '', isTask: false },
  { path: `${HOME}/Library/LaunchAgents/broken.plist`, scope: 'user' as const, fileName: 'broken.plist', label: '', isTask: false }
]


function noteOf(patch: Partial<Note> & { id: string }): Note {
  return {
    title: patch.id,
    created: '2026-10-09T10:00:00+08:00',
    updated: '2026-10-09T10:00:00+08:00',
    tags: [],
    pinned: false,
    refs: [],
    excerpt: '',
    mtimeMs: 0,
    size: 0,
    frontmatterIssues: [],
    refsUnparsed: false,
    opaque: false,
    body: '',
    revision: 'r0',
    ...patch
  }
}

const toMeta = (n: Note): NoteMeta => ({
  id: n.id,
  title: n.title,
  created: n.created,
  updated: n.updated,
  tags: n.tags,
  pinned: n.pinned,
  refs: n.refs,
  excerpt: n.excerpt,
  mtimeMs: n.mtimeMs,
  size: n.size,
  frontmatterIssues: n.frontmatterIssues,
  refsUnparsed: n.refsUnparsed,
  opaque: n.opaque
})

/**
 * read_note_image 的几种结论(真实实现在 notes-service.readAssetForAi)。
 * 这里把「必须继续拒绝」的几类逐条点名 —— 它们才是扩白名单时真正要盯的。
 */
const ASSET_REPLIES: Record<string, { ok: true; data: string; mimeType: string; bytes: number; path: string } | { ok: false; reason: 'invalid' | 'not-image' | 'too-large'; size?: number }> = {
  'assets/a.png': { ok: true, data: 'QUJD', mimeType: 'image/png', bytes: 3, path: '/notes/assets/a.png' },
  // 应用自己写附件时是 %20 编码的,工具必须两种写法都收
  'assets/Pasted%20image.png': { ok: true, data: 'QUJD', mimeType: 'image/png', bytes: 3, path: '/notes/assets/Pasted image.png' },
  'assets/big.png': { ok: false, reason: 'too-large', size: 8 * 1024 * 1024 },
  'assets/movie.mp4': { ok: false, reason: 'not-image' },
  'assets/x.svg': { ok: false, reason: 'invalid' },
  '../secret.png': { ok: false, reason: 'invalid' },
  'notes/secret.png': { ok: false, reason: 'invalid' }
}

/** 内存版 NotesService:记录每次写,便于断言「解析失败时零写入」 */
function makeNotesFake(initial: Note[] = []) {
  const store = new Map<string, Note>(initial.map((n) => [n.id, n]))
  const created: NoteCreateInput[] = []
  const saved: NoteSaveInput[] = []
  const removed: string[] = []
  let seq = 100
  const nextRev = (): string => `r${seq++}`
  return {
    store,
    created,
    saved,
    removed,
    list: async () => ({ notes: [...store.values()].map(toMeta), dir: '/notes', truncated: 0, error: null }),
    search: async (q: string) =>
      [...store.values()].filter((n) => n.title.includes(q) || n.body.includes(q)).map(toMeta),
    readBodyForAi: async (id: string) => {
      const n = store.get(id)
      return n ? { note: n, body: n.body, truncated: false } : null
    },
    // 附件读取:真的三道闸在 domains/note-asset.ts(单测钉住),这里只回放它的几种结论
    readAssetForAi: async (rel: string) =>
      ASSET_REPLIES[rel] ?? ({ ok: false, reason: 'invalid' } as const),
    create: async (input: NoteCreateInput) => {
      created.push(input)
      const id = input.id ?? input.title ?? 'note'
      const n = noteOf({
        id,
        title: input.title ?? id,
        body: input.body ?? '',
        refs: input.refs ?? [],
        tags: input.tags ?? [],
        revision: nextRev()
      })
      store.set(id, n)
      return n
    },
    save: async (input: NoteSaveInput) => {
      saved.push(input)
      const cur = store.get(input.id)
      if (!cur) return { ok: false as const, kind: 'not-found' as const, message: 'not found' }
      if (cur.revision !== input.expectedRevision) {
        return { ok: false as const, kind: 'conflict' as const, latest: cur }
      }
      const next = noteOf({
        ...cur,
        body: input.body,
        revision: nextRev(),
        ...(input.meta?.title !== undefined ? { title: input.meta.title } : {}),
        ...(input.meta?.refs !== undefined ? { refs: input.meta.refs } : {})
      })
      store.set(input.id, next)
      return { ok: true as const, note: next }
    },
    remove: async (input: NoteRemoveInput) => {
      removed.push(input.id)
      store.delete(input.id)
      return { ok: true as const, removed: true as const }
    }
  }
}

function makeRegistry(portServices: PortService[] = []) {
  const written: { path: string; xml: string }[] = []
  const opsCalls: { id: string; action: string }[] = []
  const notesFake = makeNotesFake()
  const services = {
    agents: {
      list: async () => ({ agents: AGENTS }),
      validateXml: async (xml: string) => (parsePlistXml(xml).ok ? { ok: true, error: null } : { ok: false, error: '解析失败' }),
      readStatus: async () => ({
        state: 'stopped', pid: null, uptime: null, cpu: '0', cpuWidth: '1px', mem: '0', memWidth: '1px',
        exitCode: null, restarts: 0, startTime: '', plistPath: `${HOME}/Library/LaunchAgents/com.user.alpha.plist`, workDir: '', scope: 'user'
      }),
      ops: async (id: string, action: string) => {
        opsCalls.push({ id, action })
        return { loaded: action === 'start', enabled: true, running: false }
      },
      logPaths: async (id: string) =>
        id.includes('beta') ? { stdout: '', stderr: '' } : { stdout: `${HOME}/logs/out.log`, stderr: `${HOME}/logs/err.log` },
      readLogs: async () => [
        { ts: '2026-09-22 10:00:00', type: 'info' as const, text: 'hello', source: 'stdout' as const }
      ]
    },
    cron: {
      list: async () => ({ jobs: [], headers: { user: { headerRaw: '', exists: false }, system: { headerRaw: '', exists: false } } }),
      create: async () => ({ id: 'x', user: '', expr: '* * * * *', cmd: 'true', desc: '', enabled: true }),
      remove: async () => {},
      readLog: async () => []
    },
    discovery: { scanOnce: async () => ({ services: portServices, brewServices: [], containers: [], dockerAvailable: true, dockerReason: null, polling: false, scannedAt: 0 }) },
    plists: {
      dirs: () => [
        { scope: 'user' as const, dir: `${HOME}/Library/LaunchAgents`, privileged: false },
        { scope: 'system' as const, dir: '/Library/LaunchAgents', privileged: true },
        { scope: 'daemon' as const, dir: '/Library/LaunchDaemons', privileged: true }
      ],
      scanAll: async () => FILES,
      scanNow: async () => FILES,
      readFresh: async (scope: string, path: string) => {
        const f = FILES.find((x) => x.path === path)
        if (!f) throw new Error('not found')
        if (f.label === 'com.user.alpha') {
          return { ...f, xml: '', value: { RunAtLoad: true, KeepAlive: true, StandardOutPath: '/tmp/out.log' }, desc: '' }
        }
        if (f.label === 'com.user.beta') {
          return { ...f, xml: '', value: { Label: 'com.user.beta', StartCalendarInterval: {} }, desc: '' }
        }
        return { ...f, xml: '', value: {}, desc: '' }
      },
      pathFor: (scope: string, label: string) =>
        scope === 'user' ? `${HOME}/Library/LaunchAgents/${label}.plist` : `/Library/LaunchAgents/${label}.plist`,
      write: async (scope: string, path: string, xml: string) => void written.push({ path, xml }),
      writeAt: async (scope: string, path: string, xml: string) => void written.push({ path, xml }),
      writeWithBackup: async (
        scope: string,
        path: string,
        xml: string,
        backupPath: string,
        backupXml: string
      ) => {
        written.push({ path: backupPath, xml: backupXml })
        written.push({ path, xml })
      }
    },
    launchctl: {
      list: async () => ({ gui: new Map(), system: new Map(), disabled: { gui: new Set<string>(), system: new Set<string>() } })
    },
    brew: {
      list: async () => [
        { name: 'redis', status: 'started', user: 'tester', file: `${HOME}/Library/LaunchAgents/custom-redis.plist`, exitCode: 0 },
        { name: 'postgresql@16', status: 'stopped', user: null, file: null, exitCode: null }
      ]
    },
    notes: notesFake
  }
  const registry = createToolRegistry({ ...services, home: HOME } as never)
  return { registry, written, opsCalls, notes: notesFake }
}

const byName = (registry: ReturnType<typeof makeRegistry>['registry'], n: string): ToolDef => {
  const t = registry.get(n)
  if (!t) throw new Error(`missing tool ${n}`)
  return t
}

describe('ToolRegistry 契约', () => {
  it('恰好 22 个工具:14 只读 + 8 写', () => {
    const { registry } = makeRegistry()
    expect(registry.all()).toHaveLength(22)
    expect(registry.readOnly()).toHaveLength(14)
    expect(registry.writable()).toHaveLength(8)
  })

  it('工具名是模型看到的稳定契约', () => {
    const { registry } = makeRegistry()
    expect(registry.all().map((t) => t.name).sort()).toEqual([
      'add_cron', 'check_port', 'collect_diagnostic_context', 'delete_note', 'generate_plist',
      'get_service_status', 'link_note', 'list_brew_services', 'list_notes', 'list_services', 'load_plist', 'prepare_agent', 'read_note',
      'read_note_image', 'read_plist', 'remove_cron', 'search_services', 'tail_log', 'unload_plist',
      'validate_plist', 'write_note', 'write_plist'
    ])
  })

  it('每个工具都有名字/描述/label/schema,且 name 唯一', () => {
    const { registry } = makeRegistry()
    const names = new Set<string>()
    for (const t of registry.all()) {
      expect(t.name).toBeTruthy()
      expect(t.label).toBeTruthy()
      expect(t.description.length).toBeGreaterThan(5)
      expect(t.parameters).toBeTruthy()
      expect(names.has(t.name)).toBe(false)
      names.add(t.name)
    }
  })

  it('每个写工具都有 summarize,且 detail/command 非空(授权卡不能空白)', () => {
    const { registry } = makeRegistry()
    for (const t of registry.writable()) {
      expect(t.summarize, `${t.name} 缺 summarize`).toBeTypeOf('function')
      const s = t.summarize!({ label: 'com.x', xml: '<plist/>', expr: '* * * * *', cmd: 'true', id: 'i' })
      expect(s.detail.trim(), `${t.name} detail 为空`).not.toBe('')
      expect(s.command.trim(), `${t.name} command 为空`).not.toBe('')
    }
  })

  it('只读工具不定义 summarize(避免误标成写操作)', () => {
    const { registry } = makeRegistry()
    for (const t of registry.readOnly()) expect(t.summarize).toBeUndefined()
  })
})

describe('Homebrew 服务清单', () => {
  it('直接列出 brew registry，包括未载入且没有 plist 的服务', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'list_brew_services').execute({}, ctx())
    const text = savedText(r)
    expect(text).toContain('redis')
    expect(text).toContain('postgresql@16')
    expect(text).toContain('无 plist 文件')
  })
})

describe('目标定位的边界', () => {
  it('同一 label 存在于两个作用域时要求指明 scope,不擅自挑一个', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'get_service_status').execute({ label: 'com.user.alpha' }, ctx())
    expect(r.isError).toBe(true)
    expect(r.lines.map((l) => l.text).join('\n')).toContain('daemon')
    expect(r.lines.map((l) => l.text).join('\n')).toContain('user')
  })

  it('显式 scope 时按它取用', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'get_service_status').execute({ label: 'com.user.alpha', scope: 'user' }, ctx())
    expect(r.isError).toBeFalsy()
    expect(r.lines[0].text).toContain('运行中')
  })

  it('非任务文件(占位)被如实标注而不是伪装成任务', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'get_service_status').execute({ label: 'placeholder.plist' }, ctx())
    expect(r.isError).toBe(true)
    expect(r.lines.map((l) => l.text).join('\n')).toContain('非任务文件')
  })

  it('损坏 plist 如实报出原因', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'get_service_status').execute({ label: 'broken.plist' }, ctx())
    expect(r.isError).toBe(true)
    expect(r.lines.map((l) => l.text).join('\n')).toContain('Unexpected EOF')
  })

  it('找不到的目标返回可读错误而不是抛异常', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'get_service_status').execute({ label: 'com.nope' }, ctx())
    expect(r.isError).toBe(true)
    expect(r.lines[0].text).toContain('找不到')
  })

  it('brew 管理的任务不允许直接载入/卸载(会被下次 brew 操作覆盖)', async () => {
    const { registry, opsCalls } = makeRegistry()
    for (const name of ['load_plist', 'unload_plist']) {
      const r = await byName(registry, name).execute({ label: 'homebrew.mxcl.redis' }, ctx())
      expect(r.isError, name).toBe(true)
      expect(r.lines[0].text).toContain('brew')
    }
    expect(opsCalls).toHaveLength(0)
  })

  it('非任务/损坏文件不允许载入', async () => {
    const { registry, opsCalls } = makeRegistry()
    const a = await byName(registry, 'load_plist').execute({ label: 'placeholder.plist' }, ctx())
    expect(a.isError).toBe(true)
    expect(opsCalls).toHaveLength(0)
  })
})

describe('prepare_agent', () => {
  it('只读准备:返回卡片且不写入/不执行 ops', async () => {
    const { registry, written, opsCalls } = makeRegistry()
    const r = await byName(registry, 'prepare_agent').execute(
      { label: 'com.user.plan', scope: 'user', program: '/bin/echo', args: ['hello'] },
      ctx()
    )
    expect(r.isError).toBeFalsy()
    expect(r.cardOnly).toBe(true)
    expect(r.card).toMatchObject({ kind: 'agentPreparation', readiness: 'ready', label: 'com.user.plan', scope: 'user' })
    expect(written).toHaveLength(0)
    expect(opsCalls).toHaveLength(0)
  })

  it('同 scope 标签冲突与端口占用会阻断,不进行写入', async () => {
    const { registry, written } = makeRegistry([
      {
        id: 'svc-3000', port: 3000, name: 'old-app', pid: 99, command: 'node old.js', cmd: 'node old.js',
        user: 'tester', status: 'running', addr: '127.0.0.1', proto: 'tcp', uptime: '1m'
      }
    ])
    const r = await byName(registry, 'prepare_agent').execute(
      { label: 'com.user.alpha', scope: 'user', program: '/bin/echo', port: 3000 },
      ctx()
    )
    expect(r.isError).toBeFalsy()
    expect(r.card).toMatchObject({ kind: 'agentPreparation', readiness: 'blocked', port: { value: 3000, state: 'occupied' } })
    if (r.card?.kind !== 'agentPreparation') throw new Error('unreachable')
    expect(r.card.questions.join('\n')).toContain('端口 3000 已占用')
    expect(written).toHaveLength(0)
  })

  it('无效端口被拒绝', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'prepare_agent').execute(
      { label: 'com.user.plan', scope: 'user', program: '/bin/echo', port: 70000 },
      ctx()
    )
    expect(r.isError).toBe(true)
    expect(savedText(r)).toContain('1–65535')
  })
})

describe('generate_plist', () => {
  it('产出可解析的 plist,ProgramArguments 首项即可执行文件(argv 规范形态)', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.demo', program: '/bin/echo', args: ['hello'], runAtLoad: true, startInterval: 60 },
      ctx()
    )
    expect(r.isError).toBeFalsy()
    const xml = r.lines.map((l) => l.text).join('\n')
    expect(r.card?.kind).toBe('plist')
    const cardXml = r.card?.kind === 'plist' ? r.card.xml : ''
    const parsed = parsePlistXml(cardXml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('unreachable')
    expect(parsed.value['ProgramArguments']).toEqual(['/bin/echo', 'hello'])
    expect(parsed.value['RunAtLoad']).toBe(true)
    expect(parsed.value['StartInterval']).toBe(60)
    // 报告里必须带上 XML,模型才能引用它;草稿不得落盘
    expect(xml).toContain('<plist')
  })

  it('相对路径的 program 被拒绝(launchd 不解析 PATH)', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'generate_plist').execute({ label: 'com.user.demo', program: 'echo' }, ctx())
    expect(r.isError).toBe(true)
    expect(r.lines[0].text).toContain('绝对路径')
  })

  it('非法 Label 被拒绝', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'generate_plist').execute({ label: '../escape', program: '/bin/echo' }, ctx())
    expect(r.isError).toBe(true)
  })

  it('多条 calendar 生成数组,单条生成字典', async () => {
    const { registry } = makeRegistry()
    const one = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.one', program: '/bin/echo', calendar: [{ hour: 2, minute: 30 }] },
      ctx()
    )
    const many = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.many', program: '/bin/echo', calendar: [{ hour: 2 }, { hour: 14 }] },
      ctx()
    )
    const x1 = one.card?.kind === 'plist' ? one.card.xml : ''
    const x2 = many.card?.kind === 'plist' ? many.card.xml : ''
    expect(x1).toContain('<dict>')
    const p2 = parsePlistXml(x2)
    expect(p2.ok && Array.isArray(p2.value['StartCalendarInterval'])).toBe(true)
  })

  it('logDir 自动派生 stdout/stderr,并把 ~/ 展开成绝对路径', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.logs', program: '/bin/echo', logDir: '~/Library/Logs/com.user.logs' },
      ctx()
    )
    expect(r.isError).toBeFalsy()
    const xml = r.card?.kind === 'plist' ? r.card.xml : ''
    const p = parsePlistXml(xml)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.value['StandardOutPath']).toBe(`${HOME}/Library/Logs/com.user.logs/stdout.log`)
    expect(p.value['StandardErrorPath']).toBe(`${HOME}/Library/Logs/com.user.logs/stderr.log`)
  })

  it('传 scope 后自动按作用域派生默认日志目录;logs=none 可关闭', async () => {
    const { registry } = makeRegistry()
    const user = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.logs', program: '/bin/echo', scope: 'user' },
      ctx()
    )
    const userXml = user.card?.kind === 'plist' ? user.card.xml : ''
    const up = parsePlistXml(userXml)
    expect(up.ok && up.value['StandardOutPath']).toBe(`${HOME}/Library/Logs/com.user.logs/stdout.log`)

    const daemon = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.logs', program: '/bin/echo', scope: 'daemon' },
      ctx()
    )
    const daemonXml = daemon.card?.kind === 'plist' ? daemon.card.xml : ''
    const dp = parsePlistXml(daemonXml)
    expect(dp.ok && dp.value['StandardOutPath']).toBe('/Library/Logs/com.user.logs/stdout.log')

    const none = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.logs', program: '/bin/echo', scope: 'user', logs: 'none' },
      ctx()
    )
    const noneXml = none.card?.kind === 'plist' ? none.card.xml : ''
    const np = parsePlistXml(noneXml)
    expect(np.ok && np.value['StandardOutPath']).toBeUndefined()
    expect(savedText(none)).toContain('logs=none')
  })

  it('scope=daemon 时 UserName 不再提示「仅 daemon」;user 时提示', async () => {
    const { registry } = makeRegistry()
    const daemon = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.demo', program: '/bin/echo', scope: 'daemon', userName: '_www' },
      ctx()
    )
    expect(savedText(daemon)).not.toContain('仅 daemon 作用域生效')
    const user = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.demo', program: '/bin/echo', scope: 'user', userName: '_www' },
      ctx()
    )
    expect(savedText(user)).toContain('仅 daemon 作用域生效')
  })

  it('日志路径必须是绝对路径,且 stdout/stderr 不能相同', async () => {
    const { registry } = makeRegistry()
    const rel = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.logs', program: '/bin/echo', stdout: 'logs/out.log' },
      ctx()
    )
    expect(rel.isError).toBe(true)
    expect(rel.lines[0].text).toContain('绝对路径')

    const same = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.logs', program: '/bin/echo', stdout: '/tmp/same.log', stderr: '/tmp/same.log' },
      ctx()
    )
    expect(same.isError).toBe(true)
    expect(same.lines[0].text).toContain('同一个文件')
  })

  it('program / workingDirectory 预检:不存在或不可执行直接报错', async () => {
    const { registry } = makeRegistry()
    const noProgram = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.demo', program: '/definitely/not/here' },
      ctx()
    )
    expect(noProgram.isError).toBe(true)
    expect(noProgram.lines[0].text).toContain('不存在')

    const noDir = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.demo', program: '/bin/echo', workingDirectory: '/definitely/not/here' },
      ctx()
    )
    expect(noDir.isError).toBe(true)
    expect(noDir.lines[0].text).toContain('workingDirectory')
  })

  it('calendar / processType 取值校验', async () => {
    const { registry } = makeRegistry()
    const badCal = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.demo', program: '/bin/echo', calendar: [{ minute: 99 }] },
      ctx()
    )
    expect(badCal.isError).toBe(true)
    expect(badCal.lines[0].text).toContain('calendar.Minute')

    const badProc = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.demo', program: '/bin/echo', processType: 'Quick' },
      ctx()
    )
    expect(badProc.isError).toBe(true)
    expect(badProc.lines[0].text).toContain('processType')
  })

  it('calendar 统一写成 launchd / 页面表单的大写键(兼容小写输入)', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.cal', program: '/bin/echo', calendar: [{ hour: 2, minute: 30 }] },
      ctx()
    )
    expect(r.isError).toBeFalsy()
    const xml = r.card?.kind === 'plist' ? r.card.xml : ''
    const p = parsePlistXml(xml)
    expect(p.ok && p.value['StartCalendarInterval']).toEqual({ Hour: 2, Minute: 30 })
  })

  it('空 calendar 条目被拒绝(空字典 = 每分钟触发)', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.cal', program: '/bin/echo', calendar: [{}] },
      ctx()
    )
    expect(r.isError).toBe(true)
    expect(r.lines[0].text).toContain('不能为空')
  })

  it('页面支持的 WatchPaths / Nice / UserName / KeepAlive(dict) 都能生成', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'generate_plist').execute(
      {
        label: 'com.user.misc',
        program: '/bin/echo',
        watchPaths: ['/tmp/watch-a', '/tmp/watch-b'],
        nice: 5,
        userName: '_www',
        keepAliveDict: { crashed: true }
      },
      ctx()
    )
    expect(r.isError).toBeFalsy()
    const xml = r.card?.kind === 'plist' ? r.card.xml : ''
    const p = parsePlistXml(xml)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.value['WatchPaths']).toEqual(['/tmp/watch-a', '/tmp/watch-b'])
    expect(p.value['Nice']).toBe(5)
    expect(p.value['UserName']).toBe('_www')
    expect(p.value['KeepAlive']).toEqual({ Crashed: true })
  })

  it('Nice / UserName 越界或含空白被拒绝;空 keepAliveDict 只警告', async () => {
    const { registry } = makeRegistry()
    const badNice = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.demo', program: '/bin/echo', nice: 21 },
      ctx()
    )
    expect(badNice.isError).toBe(true)
    expect(badNice.lines[0].text).toContain('Nice')

    const badUser = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.demo', program: '/bin/echo', userName: 'a b' },
      ctx()
    )
    expect(badUser.isError).toBe(true)
    expect(badUser.lines[0].text).toContain('UserName')

    const emptyDict = await byName(registry, 'generate_plist').execute(
      { label: 'com.user.demo', program: '/bin/echo', keepAliveDict: {} },
      ctx()
    )
    expect(emptyDict.isError).toBeFalsy()
    expect(savedText(emptyDict)).toContain('没有有效条件')
  })
})

describe('load_plist 重新载入语义', () => {
  it('走 reload(已载入也会先卸载再载入,确保读取磁盘上的最新配置)', async () => {
    const { registry, opsCalls } = makeRegistry()
    const r = await byName(registry, 'load_plist').execute({ label: 'com.user.beta', scope: 'user' }, ctx())
    expect(r.isError).toBeFalsy()
    expect(opsCalls).toEqual([{ id: 'user:com.user.beta', action: 'reload' }])
  })
})

describe('write_plist 覆盖守卫', () => {
  const goodXml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>Label</key><string>com.user.newone</string></dict></plist>`

  it('目标不存在 → 正常写入', async () => {
    const { registry, written } = makeRegistry()
    const r = await byName(registry, 'write_plist').execute({ label: 'com.user.newone', xml: goodXml, scope: 'user' }, ctx())
    expect(r.isError).toBeFalsy()
    expect(written).toHaveLength(1)
    expect(written[0].path).toContain('com.user.newone.plist')
  })

  it('同名任务已存在但没带 overwrite → 拒绝', async () => {
    const { registry, written } = makeRegistry()
    const existing = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>Label</key><string>com.user.alpha</string></dict></plist>`
    const r = await byName(registry, 'write_plist').execute({ label: 'com.user.alpha', xml: existing, scope: 'user' }, ctx())
    expect(r.isError).toBe(true)
    expect(r.lines[0].text).toContain('overwrite')
    expect(written).toHaveLength(0)
  })

  it('目标是无 Label 的占位文件 → 即使带 overwrite 也拒绝(不静默清掉别人的文件)', async () => {
    const { registry, written } = makeRegistry()
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>Label</key><string>placeholder</string></dict></plist>`
    const r = await byName(registry, 'write_plist').execute(
      { label: 'placeholder', xml, scope: 'user', overwrite: true },
      ctx()
    )
    expect(r.isError).toBe(true)
    expect(written).toHaveLength(0)
  })

  it('Homebrew 管理的任务拒绝手工改写', async () => {
    const { registry, written } = makeRegistry()
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>Label</key><string>homebrew.mxcl.redis</string></dict></plist>`
    const r = await byName(registry, 'write_plist').execute(
      { label: 'homebrew.mxcl.redis', xml, scope: 'user', overwrite: true },
      ctx()
    )
    expect(r.isError).toBe(true)
    expect(savedText(r)).toContain('Homebrew')
    expect(written).toHaveLength(0)
  })

  it('参数 label 与 XML 里的 Label 不一致 → 拒绝(身份以 XML 为准)', async () => {
    const { registry, written } = makeRegistry()
    const r = await byName(registry, 'write_plist').execute({ label: 'com.user.other', xml: goodXml, scope: 'user' }, ctx())
    expect(r.isError).toBe(true)
    expect(savedText(r)).toContain('不一致')
    expect(written).toHaveLength(0)
  })

  it('校验失败直接拒绝', async () => {
    const { registry, written } = makeRegistry()
    const r = await byName(registry, 'write_plist').execute({ label: 'x', xml: 'not xml', scope: 'user' }, ctx())
    expect(r.isError).toBe(true)
    expect(written).toHaveLength(0)
  })

  it('覆盖同名任务前写 .bak(载入失败可恢复旧配置)', async () => {
    const { registry, written } = makeRegistry()
    const alphaXml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>Label</key><string>com.user.alpha</string></dict></plist>`
    const r = await byName(registry, 'write_plist').execute(
      { label: 'com.user.alpha', xml: alphaXml, scope: 'user', overwrite: true },
      ctx()
    )
    expect(r.isError).toBeFalsy()
    const bak = written.find((w) => w.path.endsWith('.bak'))
    expect(bak?.path).toBe(`${HOME}/Library/LaunchAgents/com.user.alpha.plist.bak`)
    expect(bak?.xml).toContain('com.user.alpha')
    expect(savedText(r)).toContain('旧配置已备份')
  })

  it('写 user 作用域时自动创建日志目录', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-logs-'))
    try {
      const logDir = join(dir, 'nested', 'logs')
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>Label</key><string>com.user.withlog</string>
<key>StandardOutPath</key><string>${logDir}/out.log</string>
<key>StandardErrorPath</key><string>${logDir}/err.log</string>
</dict></plist>`
      const { registry, written } = makeRegistry()
      const r = await byName(registry, 'write_plist').execute({ label: 'com.user.withlog', xml, scope: 'user' }, ctx())
      expect(r.isError).toBeFalsy()
      expect(existsSync(logDir)).toBe(true)
      expect(written.some((w) => w.path.includes('com.user.withlog'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('日志路径相对 / stdout 与 stderr 相同 → 拒绝', async () => {
    const { registry } = makeRegistry()
    const relXml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>Label</key><string>com.user.rel</string><key>StandardOutPath</key><string>logs/out.log</string></dict></plist>`
    const rel = await byName(registry, 'write_plist').execute({ label: 'com.user.rel', xml: relXml, scope: 'user' }, ctx())
    expect(rel.isError).toBe(true)
    expect(savedText(rel)).toContain('绝对路径')

    const sameXml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>Label</key><string>com.user.same</string><key>StandardOutPath</key><string>/tmp/same.log</string><key>StandardErrorPath</key><string>/tmp/same.log</string></dict></plist>`
    const same = await byName(registry, 'write_plist').execute({ label: 'com.user.same', xml: sameXml, scope: 'user' }, ctx())
    expect(same.isError).toBe(true)
    expect(savedText(same)).toContain('不能是同一个文件')
  })

  it('授权卡摘要展示程序、触发与日志路径;非标准日志目录标为危险', () => {
    const { registry } = makeRegistry()
    const t = byName(registry, 'write_plist')
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>Label</key><string>com.user.alpha</string>
<key>ProgramArguments</key><array><string>/bin/sleep</string><string>60</string></array>
<key>RunAtLoad</key><true/>
<key>StandardOutPath</key><string>/tmp/out.log</string>
</dict></plist>`
    const s = t.summarize!({ label: 'com.user.alpha', xml, scope: 'user' })
    expect(s.detail).toContain('RunAtLoad')
    expect(s.detail).toContain('/tmp/out.log')
    expect(s.command).toContain('/bin/sleep')
    expect(s.dangerous).toBe(true)
  })
})

describe('日志与触发方式的取证口径', () => {
  it('未配置日志路径时明确说「未配置」,而不是「没有日志行」', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'tail_log').execute({ label: 'com.user.beta', source: 'file' }, ctx())
    expect(savedText(r)).toContain('未配置 StandardOutPath')
  })

  it('get_service_status 带触发方式与日志路径(自动验证据此判断未运行是否正常)', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'get_service_status').execute({ label: 'com.user.alpha', scope: 'user' }, ctx())
    expect(savedText(r)).toContain('触发：RunAtLoad · KeepAlive')
    expect(savedText(r)).toContain('日志：stdout /tmp/out.log')
  })

  it('tail_log 标注 stdout/stderr 来源', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'tail_log').execute({ label: 'com.user.alpha', scope: 'user', source: 'file' }, ctx())
    expect(savedText(r)).toContain('[stdout]')
  })

  it('空 StartCalendarInterval 标注为每分钟触发', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'get_service_status').execute({ label: 'com.user.beta', scope: 'user' }, ctx())
    expect(savedText(r)).toContain('空=每分钟')
    expect(savedText(r)).toContain('⚠ 空日历=每分钟触发')
  })
})

describe('cron 工具', () => {
  it('表达式段数不对被拒绝', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'add_cron').execute({ expr: '* * *', cmd: 'true' }, ctx())
    expect(r.isError).toBe(true)
    expect(savedText(r)).toContain('5 段式')
  })

  it('@daily 等特殊串可用', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'add_cron').execute({ expr: '@daily', cmd: 'true' }, ctx())
    expect(r.isError).toBeFalsy()
  })

  it('未知特殊串被拒绝', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'add_cron').execute({ expr: '@foo', cmd: 'true' }, ctx())
    expect(r.isError).toBe(true)
  })

  it('没有匹配的删除目标时给出可读错误', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'remove_cron').execute({ desc: '不存在' }, ctx())
    expect(r.isError).toBe(true)
    expect(savedText(r)).toContain('没有匹配')
  })
})

describe('search_services', () => {
  it('空关键词也返回(用于整体清点),且按来源分段', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'search_services').execute({ keyword: '' }, ctx())
    const text = savedText(r)
    expect(text).toContain('launchd')
    expect(text).toContain('cron')
    expect(text).toContain('端口')
  })

  it('source=brew 只列 brew 服务', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'search_services').execute({ source: 'brew' }, ctx())
    expect(savedText(r)).toContain('homebrew.mxcl.redis')
    expect(savedText(r)).not.toContain('com.user.beta')
  })
})

describe('read_plist 目标解析', () => {
  it('launchd 目录外的路径被拒绝(路径围栏)', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'read_plist').execute({ target: '/etc/passwd' }, ctx())
    expect(r.isError).toBe(true)
    expect(savedText(r)).toContain('不在 launchd 目录内')
  })

  it('目录通配列出该作用域下的文件', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'read_plist').execute({ target: '~/Library/LaunchAgents/*' }, ctx())
    expect(savedText(r)).toContain('com.user.alpha.plist')
  })
})

function ctx() {
  return { sessionId: 'test', signal: new AbortController().signal }
}
function savedText(r: { lines: { text: string }[] }): string {
  return r.lines.map((l) => l.text).join('\n')
}

describe('笔记工具', () => {
  const ctx = { sessionId: 's1', signal: new AbortController().signal }

  const SVC: PortService = {
    id: '1234:8080',
    port: 8080,
    name: 'node',
    command: 'node',
    user: 'tester',
    cmd: 'node server.js',
    status: 'running',
    addr: '*',
    proto: 'TCP',
    uptime: '2h'
  }

  it('list_notes 打印关联的持久键(供后续 link_note 复用)', async () => {
    const { registry } = makeRegistry()
    const t = byName(registry, 'list_notes')
    const r = await t.execute({}, ctx)
    // 空目录也不报错,只是明说没有
    expect(savedText(r)).toContain('没有匹配的笔记')
  })

  it('read_note_image 返回图片块(模型真的看得到图)', async () => {
    const { registry } = makeRegistry()
    const t = byName(registry, 'read_note_image')
    const r = await t.execute({ note_id: 'a', path: 'assets/a.png' }, ctx)
    expect(r.isError).toBeFalsy()
    expect(r.images).toHaveLength(1)
    expect(r.images?.[0]).toMatchObject({ type: 'image', mimeType: 'image/png', data: 'QUJD' })
    expect(savedText(r)).toContain('assets/a.png')
  })

  it('read_note_image 收下 %20 编码的路径(应用自己写附件时就是这种)', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'read_note_image').execute(
      { note_id: 'a', path: 'assets/Pasted%20image.png' },
      ctx
    )
    expect(r.isError).toBeFalsy()
    expect(r.images).toHaveLength(1)
  })

  it.each([
    ['越界路径', '../secret.png', 'assets/'],
    ['不在 assets/ 下', 'notes/secret.png', 'assets/'],
    ['白名单外(svg)', 'assets/x.svg', 'assets/'],
    ['不是图片', 'assets/movie.mp4', '不是图片'],
    ['超过上限', 'assets/big.png', '上限'],
    ['不存在', 'assets/nope.png', 'assets/']
  ])('read_note_image 拒绝%s:给可读原因且不返回图片', async (_name, path, hint) => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'read_note_image').execute({ note_id: 'a', path }, ctx)
    expect(r.isError).toBe(true)
    expect(r.images).toBeUndefined()
    expect(savedText(r)).toContain(hint)
  })

  it('read_note_image 缺 path → 直接拒绝(不去猜一张图)', async () => {
    const { registry } = makeRegistry()
    const r = await byName(registry, 'read_note_image').execute({ note_id: 'a' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.images).toBeUndefined()
  })

  it('write_note 新建:挂上 agent 关联(键取自实时服务,不是模型编的)', async () => {
    const { registry, notes } = makeRegistry()
    const t = byName(registry, 'write_note')
    // com.user.beta 只在 user 域存在 → 无歧义
    const r = await t.execute(
      { title: '排查 redis', body: '正文', refs: [{ type: 'agent', label: 'com.user.beta' }] },
      ctx
    )
    expect(r.isError).toBeFalsy()
    expect(notes.created).toHaveLength(1)
    expect(notes.created[0].refs).toEqual([
      { type: 'agent', key: 'user:com.user.beta', label: 'com.user.beta', detail: 'scope=user' }
    ])
  })

  it('agent 跨作用域同名 → 列候选且**零写入**', async () => {
    const { registry, notes } = makeRegistry()
    const t = byName(registry, 'write_note')
    const r = await t.execute(
      { title: 'x', body: 'y', refs: [{ type: 'agent', label: 'com.user.alpha' }] },
      ctx
    )
    // com.user.alpha 在 user 与 daemon 都存在 → 歧义
    expect(r.isError).toBe(true)
    expect(savedText(r)).toContain('多个作用域')
    expect(notes.created).toHaveLength(0)
  })

  it('显式 scope 后歧义消解', async () => {
    const { registry, notes } = makeRegistry()
    const t = byName(registry, 'write_note')
    const r = await t.execute(
      { title: 'x', body: 'y', refs: [{ type: 'agent', label: 'com.user.alpha', scope: 'daemon' }] },
      ctx
    )
    expect(r.isError).toBeFalsy()
    expect(notes.created[0].refs?.[0].key).toBe('daemon:com.user.alpha')
  })

  it('service 关联解析成**跨重启稳定**的身份键,不是 pid:port', async () => {
    const { registry, notes } = makeRegistry([SVC])
    const t = byName(registry, 'write_note')
    const r = await t.execute({ title: 'x', body: 'y', refs: [{ type: 'service', port: 8080 }] }, ctx)
    expect(r.isError).toBeFalsy()
    expect(notes.created[0].refs?.[0].key).toBe('8080:node')
    expect(notes.created[0].refs?.[0].key).not.toBe(SVC.id)
  })

  it('端口上没有服务 → 整次失败且零写入', async () => {
    const { registry, notes } = makeRegistry()
    const t = byName(registry, 'write_note')
    const r = await t.execute({ title: 'x', body: 'y', refs: [{ type: 'service', port: 9999 }] }, ctx)
    expect(r.isError).toBe(true)
    expect(notes.created).toHaveLength(0)
  })

  it('未知关联类型 → 零写入', async () => {
    const { registry, notes } = makeRegistry()
    const t = byName(registry, 'write_note')
    const r = await t.execute({ title: 'x', body: 'y', refs: [{ type: 'sorcery' }] }, ctx)
    expect(r.isError).toBe(true)
    expect(notes.created).toHaveLength(0)
  })

  it('改写既有笔记前必须先 read_note —— 冷调 write_note 被拒且零写入', async () => {
    const { registry, notes } = makeRegistry()
    const existing = noteOf({ id: 'old', title: '旧', body: '旧正文' })
    notes.store.set('old', existing)

    const w = byName(registry, 'write_note')
    const cold = await w.execute({ id: 'old', title: '新', body: '新正文' }, ctx)
    expect(cold.isError).toBe(true)
    expect(savedText(cold)).toContain('read_note')
    expect(notes.saved).toHaveLength(0)
    expect(notes.store.get('old')?.body).toBe('旧正文')

    // 先读再写就通过
    await byName(registry, 'read_note').execute({ id: 'old' }, ctx)
    const warm = await w.execute({ id: 'old', title: '新', body: '新正文' }, ctx)
    expect(warm.isError).toBeFalsy()
    expect(notes.store.get('old')?.body).toBe('新正文')
  })

  it('read_note 之后磁盘被改 → conflict,不覆盖', async () => {
    const { registry, notes } = makeRegistry()
    notes.store.set('old', noteOf({ id: 'old', title: '旧', body: '旧正文', revision: 'r1' }))
    await byName(registry, 'read_note').execute({ id: 'old' }, ctx)
    // 模拟外部改动
    notes.store.set('old', noteOf({ id: 'old', title: '旧', body: '别人改的', revision: 'r2' }))

    const r = await byName(registry, 'write_note').execute({ id: 'old', title: 'x', body: 'y' }, ctx)
    expect(r.isError).toBe(true)
    expect(notes.store.get('old')?.body).toBe('别人改的')
  })

  it('append 保留原正文', async () => {
    const { registry, notes } = makeRegistry()
    notes.store.set('old', noteOf({ id: 'old', title: '旧', body: '原有内容', revision: 'r1' }))
    await byName(registry, 'read_note').execute({ id: 'old' }, ctx)
    await byName(registry, 'write_note').execute({ id: 'old', title: '旧', body: '追加段', mode: 'append' }, ctx)
    expect(notes.store.get('old')?.body).toBe('原有内容\n\n追加段')
  })

  it('refsUnparsed 的笔记拒绝 link_note(不改写用户原文)', async () => {
    const { registry, notes } = makeRegistry()
    notes.store.set('flow', noteOf({ id: 'flow', title: 'f', refsUnparsed: true, revision: 'r1' }))
    const r = await byName(registry, 'link_note').execute(
      { id: 'flow', refs: [{ type: 'service', port: 8080 }] },
      ctx
    )
    expect(r.isError).toBe(true)
    expect(notes.saved).toHaveLength(0)
  })

  it('link_note 增删关联', async () => {
    const { registry, notes } = makeRegistry([SVC])
    notes.store.set('n', noteOf({ id: 'n', title: 'n', revision: 'r1' }))
    await byName(registry, 'link_note').execute({ id: 'n', refs: [{ type: 'service', port: 8080 }] }, ctx)
    expect(notes.store.get('n')?.refs.map((r) => r.key)).toEqual(['8080:node'])

    await byName(registry, 'link_note').execute(
      { id: 'n', refs: [{ type: 'service', port: 8080 }], remove: true },
      ctx
    )
    expect(notes.store.get('n')?.refs).toEqual([])
  })

  it('link_note 重复添加不堆两条', async () => {
    const { registry, notes } = makeRegistry([SVC])
    notes.store.set('n', noteOf({ id: 'n', title: 'n', revision: 'r1' }))
    await byName(registry, 'link_note').execute({ id: 'n', refs: [{ type: 'service', port: 8080 }] }, ctx)
    await byName(registry, 'link_note').execute({ id: 'n', refs: [{ type: 'service', port: 8080 }] }, ctx)
    expect(notes.store.get('n')?.refs).toHaveLength(1)
  })

  it('delete_note 删除并记录', async () => {
    const { registry, notes } = makeRegistry()
    notes.store.set('gone', noteOf({ id: 'gone', title: 'g', revision: 'r1' }))
    const r = await byName(registry, 'delete_note').execute({ id: 'gone' }, ctx)
    expect(r.isError).toBeFalsy()
    expect(notes.removed).toEqual(['gone'])
  })

  it('不存在的笔记:read / delete 都报错而不是静默成功', async () => {
    const { registry } = makeRegistry()
    expect((await byName(registry, 'read_note').execute({ id: 'nope' }, ctx)).isError).toBe(true)
    expect((await byName(registry, 'delete_note').execute({ id: 'nope' }, ctx)).isError).toBe(true)
  })

  it('write_note 的授权摘要:replace 标 dangerous,create 不标', () => {
    const { registry } = makeRegistry()
    const t = byName(registry, 'write_note')
    expect(t.summarize?.({ title: 'a', body: 'b' }).dangerous).toBeFalsy()
    expect(t.summarize?.({ id: 'x', title: 'a', body: 'b' }).dangerous).toBe(true)
    // 摘要要能说清「写去哪、多少字」
    expect(t.summarize?.({ title: 'a', body: 'bcd' }).detail).toContain('3 字')
  })
})
