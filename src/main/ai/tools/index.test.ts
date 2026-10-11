// 工具层契约与边界的回归:20 个工具(12 只读 + 8 写)、写工具必备授权摘要、
// 以及最容易出错的几类目标(跨作用域同名 / 非任务文件 / 损坏 plist / 找不到 / 附件路径闸门)
import { describe, expect, it } from 'vitest'
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
  { path: `${HOME}/Library/LaunchAgents/com.user.alpha.plist`, scope: 'user' as const, fileName: 'com.user.alpha.plist', label: 'com.user.alpha', isTask: true },
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
      readLogs: async () => [{ ts: '2026-09-22 10:00:00', type: 'info' as const, text: 'hello' }]
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
        return { ...f, xml: '', value: {}, desc: '' }
      },
      pathFor: (scope: string, label: string) =>
        scope === 'user' ? `${HOME}/Library/LaunchAgents/${label}.plist` : `/Library/LaunchAgents/${label}.plist`,
      write: async (scope: string, path: string, xml: string) => void written.push({ path, xml })
    },
    launchctl: {
      list: async () => ({ gui: new Map(), system: new Map(), disabled: { gui: new Set<string>(), system: new Set<string>() } })
    },
    brew: {},
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
  it('恰好 20 个工具:12 只读 + 8 写', () => {
    const { registry } = makeRegistry()
    expect(registry.all()).toHaveLength(20)
    expect(registry.readOnly()).toHaveLength(12)
    expect(registry.writable()).toHaveLength(8)
  })

  it('工具名是模型看到的稳定契约', () => {
    const { registry } = makeRegistry()
    expect(registry.all().map((t) => t.name).sort()).toEqual([
      'add_cron', 'check_port', 'collect_diagnostic_context', 'delete_note', 'generate_plist',
      'get_service_status', 'link_note', 'list_notes', 'list_services', 'load_plist', 'read_note',
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
