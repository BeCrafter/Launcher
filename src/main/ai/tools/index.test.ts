// 工具层契约与边界的回归:14 个工具(9 只读 + 5 写)、写工具必备授权摘要、
// 以及最容易出错的几类目标(跨作用域同名 / 非任务文件 / 损坏 plist / 找不到)
import { describe, expect, it } from 'vitest'
import { parsePlistXml } from '../../domains/plist-xml'
import { createToolRegistry } from './index'
import type { Agent } from '../../../shared/models'
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

function makeRegistry() {
  const written: { path: string; xml: string }[] = []
  const opsCalls: { id: string; action: string }[] = []
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
    discovery: { scanOnce: async () => ({ services: [], brewServices: [], containers: [], dockerAvailable: true, dockerReason: null, polling: false, scannedAt: 0 }) },
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
    brew: {}
  }
  const registry = createToolRegistry({ ...services, home: HOME } as never)
  return { registry, written, opsCalls }
}

const byName = (registry: ReturnType<typeof makeRegistry>['registry'], n: string): ToolDef => {
  const t = registry.get(n)
  if (!t) throw new Error(`missing tool ${n}`)
  return t
}

describe('ToolRegistry 契约', () => {
  it('恰好 14 个工具:9 只读 + 5 写', () => {
    const { registry } = makeRegistry()
    expect(registry.all()).toHaveLength(14)
    expect(registry.readOnly()).toHaveLength(9)
    expect(registry.writable()).toHaveLength(5)
  })

  it('工具名是模型看到的稳定契约', () => {
    const { registry } = makeRegistry()
    expect(registry.all().map((t) => t.name).sort()).toEqual([
      'add_cron', 'check_port', 'collect_diagnostic_context', 'generate_plist', 'get_service_status',
      'list_services', 'load_plist', 'read_plist', 'remove_cron', 'search_services', 'tail_log',
      'unload_plist', 'validate_plist', 'write_plist'
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
