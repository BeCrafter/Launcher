// 笔记服务:扫描/索引/CAS/原子写/watch/检索/附件的端到端(真实临时目录,不打桩 fs)。
//
// 这里最要紧的两组是:
//   · 路径穿越全谱必须被拒且**不落盘**(id 来自渲染层和 LLM);
//   · 未知键与未解析形态在保存后**字节不变**(用户会在 Obsidian 里手改这些文件)。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNotesService, type NotesService } from './notes-service'
import { MAX_NOTE_BYTES } from '../../shared/notes'

// 用**本地时间**构造:compactStamp 按本地时区给附件命名,
// 这样断言与运行机器的时区无关(CI 常在 UTC 下跑,写死 UTC 会差 8 小时)
const FIXED = new Date(2026, 9, 9, 15, 41, 3).getTime()

let root = ''
const dirs: string[] = []

function makeDir(): string {
  root = mkdtempSync(join(tmpdir(), 'launcher-notes-'))
  dirs.push(root)
  return root
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function makeService(over: Partial<Parameters<typeof createNotesService>[0]> = {}): NotesService {
  const dir = makeDir()
  return createNotesService({ getDir: () => dir, now: () => FIXED, ...over })
}

const read = (dir: string, name: string): string => readFileSync(join(dir, name), 'utf8')

describe('create / list / read', () => {
  it('建 → 列 → 读 往返,frontmatter 与正文都落盘', async () => {
    const svc = makeService()
    const note = await svc.create({ title: '排查 redis 重启', body: '第一行\n\n第二行' })

    expect(note.title).toBe('排查 redis 重启')
    // 文件名是 slug,frontmatter 里的 title 保留人可读的原样
    expect(note.id).toBe('排查 redis 重启')
    const text = read(svc.dir(), `${note.id}.md`)
    expect(text).toContain('title: 排查 redis 重启')
    expect(text).toContain('created: ')
    expect(text).toContain('updated: ')
    expect(text.endsWith('第一行\n\n第二行')).toBe(true)

    const list = await svc.list()
    expect(list.notes).toHaveLength(1)
    expect(list.notes[0].title).toBe('排查 redis 重启')
    expect(list.error).toBeNull()

    const got = await svc.read(note.id)
    expect(got?.body).toBe('第一行\n\n第二行')
    expect(got?.revision).toBe(note.revision)
  })

  it('中文标题得到中文文件名,空白原样保留', async () => {
    const svc = makeService()
    const note = await svc.create({ title: '为什么 nginx 起不来' })
    expect(note.id).toBe('为什么 nginx 起不来')
    expect(existsSync(join(svc.dir(), `${note.id}.md`))).toBe(true)
  })

  it('同标题重复创建 → 加序号', async () => {
    const svc = makeService()
    const a = await svc.create({ title: '重复' })
    const b = await svc.create({ title: '重复' })
    const c = await svc.create({ title: '重复' })
    expect([a.id, b.id, c.id]).toEqual(['重复', '重复-2', '重复-3'])
  })

  it('目录不存在时按需创建', async () => {
    const dir = makeDir()
    const nested = join(dir, 'a', 'b', 'notes')
    const svc = createNotesService({ getDir: () => nested, now: () => FIXED })
    await svc.create({ title: 'x' })
    expect(existsSync(nested)).toBe(true)
  })

  it('摘录取正文首个有内容的非标题行', async () => {
    const svc = makeService()
    await svc.create({ title: 't', body: '# 标题\n\n\n- 摘录就取这一行\n后面还有' })
    const list = await svc.list()
    expect(list.notes[0].excerpt).toBe('摘录就取这一行')
  })
})

describe('save:CAS 与原子写', () => {
  it('revision 正确 → 写入成功,updated 前移', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't', body: '旧' })
    const out = await svc.save({ id: note.id, body: '新', expectedRevision: note.revision })
    expect(out.ok).toBe(true)
    if (!out.ok || !('note' in out)) throw new Error('expected note')
    expect(out.note.body).toBe('新')
    expect(out.note.revision).not.toBe(note.revision)
  })

  it('revision 陈旧 → conflict 并带回磁盘现状(绝不静默覆盖)', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't', body: '我的版本' })
    // 模拟外部改动
    const file = join(svc.dir(), `${note.id}.md`)
    writeFileSync(file, read(svc.dir(), `${note.id}.md`).replace('我的版本', '别人的版本'))

    const out = await svc.save({ id: note.id, body: '我的新版本', expectedRevision: note.revision })
    expect(out.ok).toBe(false)
    if (out.ok || out.kind !== 'conflict') throw new Error('expected conflict')
    expect(out.latest.body).toContain('别人的版本')
    // 磁盘没被我们改动
    expect(read(svc.dir(), `${note.id}.md`)).toContain('别人的版本')
  })

  it('缺少 expectedRevision → 直接拒绝(写路径不许绕过 CAS)', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't', body: '原' })
    const out = await svc.save({ id: note.id, body: '改', expectedRevision: '' })
    expect(out.ok).toBe(false)
    expect(read(svc.dir(), `${note.id}.md`)).toContain('原')
  })

  it('force 用于「保留我的版本」:以磁盘最新 revision 为基准覆盖', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't', body: '我的' })
    const file = join(svc.dir(), `${note.id}.md`)
    writeFileSync(file, read(svc.dir(), `${note.id}.md`).replace('我的', '别人的'))

    const latest = await svc.read(note.id)
    const out = await svc.save({
      id: note.id,
      body: '我的最终版',
      expectedRevision: latest!.revision,
      force: true
    })
    expect(out.ok).toBe(true)
    expect(read(svc.dir(), `${note.id}.md`)).toContain('我的最终版')
  })

  it('超 1 MiB 拒绝写入且文件未被触碰', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't', body: '小' })
    const before = read(svc.dir(), `${note.id}.md`)
    const out = await svc.save({
      id: note.id,
      body: 'x'.repeat(MAX_NOTE_BYTES + 1),
      expectedRevision: note.revision
    })
    expect(out.ok).toBe(false)
    if (out.ok || out.kind !== 'too-large') throw new Error('expected too-large')
    expect(read(svc.dir(), `${note.id}.md`)).toBe(before)
  })

  it('不存在的笔记 → not-found', async () => {
    const svc = makeService()
    const out = await svc.save({ id: 'nope', body: 'x', expectedRevision: 'abc' })
    expect(out.ok).toBe(false)
    if (out.ok || out.kind !== 'not-found') throw new Error('expected not-found')
  })
})

describe('save:元数据与「不丢用户内容」', () => {
  it('未知顶层键在保存后逐字节存活', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't', body: 'body' })
    const file = join(svc.dir(), `${note.id}.md`)
    // 外部(Obsidian)加自定义键
    writeFileSync(
      file,
      read(svc.dir(), `${note.id}.md`).replace('---\n', '---\naliases:\n  - 别名\ncssclasses: [wide]\n')
    )

    const cur = await svc.read(note.id)
    const out = await svc.save({
      id: note.id,
      body: 'body 改了',
      expectedRevision: cur!.revision,
      meta: { tags: ['a'] }
    })
    expect(out.ok).toBe(true)
    const text = read(svc.dir(), `${note.id}.md`)
    expect(text).toContain('aliases:\n  - 别名')
    expect(text).toContain('cssclasses: [wide]')
    expect(text).toContain('tags:\n  - a')
  })

  it('refsUnparsed 的笔记:保存正文后 refs 行字节不变', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't', body: 'body' })
    const file = join(svc.dir(), `${note.id}.md`)
    const flow = 'refs: [{type: agent, key: a}]\n'
    writeFileSync(file, read(svc.dir(), `${note.id}.md`).replace('---\n', `---\n${flow}`))

    const cur = await svc.read(note.id)
    expect(cur!.refsUnparsed).toBe(true)

    const out = await svc.save({ id: note.id, body: 'body 改了', expectedRevision: cur!.revision })
    expect(out.ok).toBe(true)
    expect(read(svc.dir(), `${note.id}.md`)).toContain(flow)
  })

  it('D1:裸 .md 只改正文时不被「收养」(不会凭空长出 frontmatter)', async () => {
    const svc = makeService()
    const dir = svc.dir()
    writeFileSync(join(dir, 'dropped.md'), '# 丢进来的\n\n正文\n')

    const note = await svc.read('dropped')
    expect(note!.title).toBe('丢进来的') // 标题回退到首个 # 标题
    expect(note!.body).toBe('# 丢进来的\n\n正文\n')

    const out = await svc.save({ id: 'dropped', body: '改过的正文', expectedRevision: note!.revision })
    expect(out.ok).toBe(true)
    // 一个字面量的 frontmatter 都没加
    expect(read(dir, 'dropped.md')).toBe('改过的正文')
  })

  it('D1:但显式改元数据时会补出 frontmatter(并带上 created)', async () => {
    const svc = makeService()
    const dir = svc.dir()
    writeFileSync(join(dir, 'dropped.md'), '正文\n')
    const note = await svc.read('dropped')

    const out = await svc.save({
      id: 'dropped',
      body: '正文\n',
      expectedRevision: note!.revision,
      meta: { title: '起个名字' }
    })
    expect(out.ok).toBe(true)
    const text = read(dir, 'dropped.md')
    expect(text).toContain('title: 起个名字')
    expect(text).toContain('created: ')
  })

  it('D2:围栏未闭合时改正文可以,改元数据被拒', async () => {
    const svc = makeService()
    const dir = svc.dir()
    writeFileSync(join(dir, 'broken.md'), '---\ntitle: x\n\n正文还在\n')
    const note = await svc.read('broken')
    expect(note!.body).toBe('---\ntitle: x\n\n正文还在\n') // 整份都是正文

    const metaOut = await svc.save({
      id: 'broken',
      body: note!.body,
      expectedRevision: note!.revision,
      meta: { title: '想改' }
    })
    expect(metaOut.ok).toBe(false)
    if (metaOut.ok || metaOut.kind !== 'invalid') throw new Error('expected invalid')
    expect(read(dir, 'broken.md')).toBe('---\ntitle: x\n\n正文还在\n')

    const bodyOut = await svc.save({
      id: 'broken',
      body: '换一段正文',
      expectedRevision: note!.revision
    })
    expect(bodyOut.ok).toBe(true)
    expect(read(dir, 'broken.md')).toBe('换一段正文')
  })
})

describe('路径穿越防护', () => {
  const evil = ['../x', 'a/b', 'a\\b', 'a\u0000b', '..', '.', '.trash', 'x'.repeat(121)]

  it('读/写/删/重命名一律拒绝,且不落盘', async () => {
    const svc = makeService()
    const dir = svc.dir()
    await svc.create({ title: '安全' })
    const before = readdirSync(dir)

    for (const id of evil) {
      expect(await svc.read(id)).toBeNull()
      expect((await svc.save({ id, body: 'x', expectedRevision: 'r' })).ok).toBe(false)
      expect((await svc.remove({ id, expectedRevision: 'r' })).ok).toBe(false)
      expect((await svc.rename({ id, title: 'y', expectedRevision: 'r' })).ok).toBe(false)
    }
    expect(readdirSync(dir)).toEqual(before)
  })

  it('目录外确实没有多出文件', async () => {
    const parent = makeDir()
    const svc = createNotesService({ getDir: () => join(parent, 'notes'), now: () => FIXED })
    await svc.create({ title: 'x' })
    await svc.save({ id: '../escaped', body: 'x', expectedRevision: 'r' })
    expect(existsSync(join(parent, 'escaped.md'))).toBe(false)
  })

  it('create 的显式 id 也走同一道闸', async () => {
    const svc = makeService()
    const note = await svc.create({ title: '正常', id: '../evil' })
    expect(note.id).toBe('正常') // 非法 id 被忽略,退回按标题生成
  })
})

describe('外部改动与索引', () => {
  it('外部改写后 list 能看到新内容', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't', body: '旧' })
    const file = join(svc.dir(), `${note.id}.md`)
    writeFileSync(file, read(svc.dir(), `${note.id}.md`).replace('旧', '外部改的'))
    utimesSync(file, new Date(), new Date(Date.now() + 1000))

    const got = await svc.read(note.id)
    expect(got!.body).toContain('外部改的')
  })

  it('自己的写不会被误报为外部改动', async () => {
    const seen: string[][] = []
    const svc = makeService({ onExternalChange: (ids) => seen.push(ids) })
    const note = await svc.create({ title: 't', body: 'a' })
    await svc.list()
    const cur = await svc.read(note.id)
    await svc.save({ id: note.id, body: 'b', expectedRevision: cur!.revision })
    await svc.list()
    expect(seen.flat()).toEqual([])
  })

  it('只有 mtime 变化(内容大小相同)也能被发现', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't', body: 'aaaa' })
    const file = join(svc.dir(), `${note.id}.md`)
    const text = read(svc.dir(), `${note.id}.md`)
    writeFileSync(file, text.replace('aaaa', 'bbbb')) // 同长度
    utimesSync(file, new Date(), new Date(Date.now() + 2000))

    const got = await svc.read(note.id)
    expect(got!.body).toBe('bbbb')
  })

  it('目录监听上报外部改动(去抖 400ms)', async () => {
    const changed: string[][] = []
    const svc = makeService({ onExternalChange: (ids) => changed.push(ids) })
    const note = await svc.create({ title: 't', body: 'a' })
    await svc.list()
    svc.start()
    try {
      // 先让 fs.watch 注册完成再写:注册是异步的,start() 后立刻写可能赶在注册之前。
      // 这是 fs.watch 的固有性质,也正是本项目「正确性不依赖 watcher,它只是延迟优化」的原因
      // ——scan() 每次都 stat,漏了事件顶多让界面晚一步刷新,不会读到陈旧内容。
      //
      // ⚠️ 也别把「反复写」当重试手段:createTrailingDebouncer 是尾沿去抖,每个事件都会重置
      // 400ms 计时器 —— 写入间隔短于去抖窗口时它会**永远不触发**(连续同步写盘会把它饿死)。
      await new Promise((r) => setTimeout(r, 300))
      writeFileSync(join(svc.dir(), `${note.id}.md`), `${read(svc.dir(), `${note.id}.md`)}\n外部追加\n`)
      await vi.waitFor(() => expect(changed.flat()).toContain(note.id), { timeout: 3000, interval: 100 })
    } finally {
      svc.stop()
    }
  })

  it('文件消失后从列表里移除', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't' })
    expect((await svc.list()).notes).toHaveLength(1)
    rmSync(join(svc.dir(), `${note.id}.md`))
    expect((await svc.list()).notes).toHaveLength(0)
  })

  it('点文件与 .trash/ 不进列表', async () => {
    const svc = makeService()
    await svc.create({ title: '正常' })
    const dir = svc.dir()
    writeFileSync(join(dir, '.hidden.md'), 'x')
    mkdirSync(join(dir, '.trash'), { recursive: true })
    writeFileSync(join(dir, '.trash', 'old.md'), 'x')
    writeFileSync(join(dir, 'not-markdown.txt'), 'x')

    const list = await svc.list()
    expect(list.notes.map((n) => n.id)).toEqual(['正常'])
  })
})

describe('remove / rename', () => {
  it('remove 走注入的 trash 回调', async () => {
    const trashed: string[] = []
    const svc = makeService({ trash: async (p) => void trashed.push(p) })
    const note = await svc.create({ title: 't' })
    const out = await svc.remove({ id: note.id, expectedRevision: note.revision })
    expect(out).toEqual({ ok: true, removed: true })
    expect(trashed).toHaveLength(1)
  })

  it('无 trash 回调时落进 <dir>/.trash/', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't' })
    await svc.remove({ id: note.id, expectedRevision: note.revision })

    const dir = svc.dir()
    expect(existsSync(join(dir, `${note.id}.md`))).toBe(false)
    const trashed = readdirSync(join(dir, '.trash'))
    expect(trashed).toHaveLength(1)
    expect(trashed[0]).toContain(note.id)
  })

  it('remove 带陈旧 revision → conflict,文件还在', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't' })
    const out = await svc.remove({ id: note.id, expectedRevision: 'stale' })
    expect(out.ok).toBe(false)
    expect(existsSync(join(svc.dir(), `${note.id}.md`))).toBe(true)
  })

  it('rename 换文件名并写入新标题', async () => {
    const svc = makeService()
    const note = await svc.create({ title: '旧名', body: '内容' })
    const out = await svc.rename({ id: note.id, title: '新名字', expectedRevision: note.revision })
    expect(out.ok).toBe(true)
    if (!out.ok || !('note' in out)) throw new Error('expected note')

    expect(out.note.id).toBe('新名字')
    expect(out.note.title).toBe('新名字')
    expect(out.note.body).toBe('内容') // 正文没动
    expect(existsSync(join(svc.dir(), `${note.id}.md`))).toBe(false)
    expect(read(svc.dir(), '新名字.md')).toContain('title: 新名字')
  })

  it('rename 撞名:默认**不**擅自加序号,回 name-taken + 建议名', async () => {
    const svc = makeService()
    await svc.create({ title: '占用' })
    const note = await svc.create({ title: '要改的' })
    const out = await svc.rename({ id: note.id, title: '占用', expectedRevision: note.revision })
    expect(out.ok).toBe(false)
    if (out.ok || out.kind !== 'name-taken') throw new Error('expected name-taken')
    expect(out.suggested).toBe('占用-2')
    // 磁盘上什么都没动
    expect(existsSync(join(svc.dir(), '要改的.md'))).toBe(true)
    expect((await svc.read('要改的'))?.title).toBe('要改的')
  })

  it('rename 带 onConflict=auto-rename 时才加序号(用户已确认保留两者)', async () => {
    const svc = makeService()
    await svc.create({ title: '占用' })
    const note = await svc.create({ title: '要改的' })
    const out = await svc.rename({
      id: note.id,
      title: '占用',
      expectedRevision: note.revision,
      onConflict: 'auto-rename'
    })
    if (!out.ok || !('note' in out)) throw new Error('rename failed')
    expect(out.note.id).toBe('占用-2')
    expect(out.note.title).toBe('占用-2')
  })

  it('rename 标题 slug 不变时只改 frontmatter,不动文件名', async () => {
    const svc = makeService()
    const note = await svc.create({ title: '同名', body: 'x' })
    const out = await svc.rename({ id: note.id, title: '同名', expectedRevision: note.revision })
    expect(out.ok).toBe(true)
    if (!out.ok || !('note' in out)) throw new Error('expected note')
    expect(out.note.id).toBe('同名')
    expect(existsSync(join(svc.dir(), '同名.md'))).toBe(true)
  })

  it('rename 空标题被拒', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't' })
    const out = await svc.rename({ id: note.id, title: '   ', expectedRevision: note.revision })
    expect(out.ok).toBe(false)
  })
})

describe('全文检索', () => {
  it('命中正文中段的词,不只标题', async () => {
    const svc = makeService()
    await svc.create({ title: '甲', body: '开头\n\n中间藏着 关键词 这里\n\n结尾' })
    await svc.create({ title: '乙', body: '无关内容' })

    const hits = await svc.search('关键词')
    expect(hits.map((h) => h.title)).toEqual(['甲'])
  })

  it('命中标题、标签、关联名', async () => {
    const svc = makeService()
    await svc.create({ title: '标题里有 zzz', body: 'x' })
    await svc.create({ title: 'b', body: 'x', tags: ['taggy'] })
    await svc.create({
      title: 'c',
      body: 'x',
      refs: [{ type: 'agent', key: 'user:foo', label: 'refname' }]
    })

    expect((await svc.search('zzz')).map((n) => n.title)).toEqual(['标题里有 zzz'])
    expect((await svc.search('taggy')).map((n) => n.title)).toEqual(['b'])
    expect((await svc.search('refname')).map((n) => n.title)).toEqual(['c'])
  })

  it('空查询返回空;大小写不敏感;limit 生效', async () => {
    const svc = makeService()
    for (let i = 0; i < 5; i++) await svc.create({ title: `笔记 ${i}`, body: 'common' })
    expect(await svc.search('   ')).toEqual([])
    expect((await svc.search('COMMON')).length).toBe(5)
    expect((await svc.search('common', 2)).length).toBe(2)
  })
})

describe('正文里的 # 不是标签', () => {
  it('不写回 frontmatter;保存正文后 tags 不变', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't', body: '#inline', tags: ['fm'] })
    expect(note.tags).toEqual(['fm'])
    expect(read(svc.dir(), `${note.id}.md`)).toContain('tags:\n  - fm')

    const out = await svc.save({
      id: note.id,
      body: '#next 与 #inline',
      expectedRevision: note.revision
    })
    expect(out.ok).toBe(true)
    if (!out.ok || !('note' in out)) throw new Error('save failed')
    expect(out.note.tags).toEqual(['fm'])
    const text = read(svc.dir(), `${note.id}.md`)
    expect(text).toContain('tags:\n  - fm')
    expect(text).not.toContain('next\n  -')
  })

  it('全文搜索仍能命中正文里的 # 文本(只是不算标签命中)', async () => {
    const svc = makeService()
    await svc.create({ title: '甲', body: '正文 #project/foo' })
    await svc.create({ title: '乙', body: '无关' })
    expect((await svc.search('project/foo')).map((n) => n.title)).toEqual(['甲'])
    expect((await svc.search('PROJECT')).map((n) => n.title)).toEqual(['甲'])
  })
})

describe('附件', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer

  it('落盘到 assets/ 并返回相对路径', async () => {
    const svc = makeService()
    const out = await svc.saveAsset({ fileName: 'shot.png', data: png })
    expect(out.relPath).toBe('assets/Pasted image 20261009154103.png')
    expect(existsSync(join(svc.dir(), out.relPath))).toBe(true)
  })

  it('同名冲突加序号', async () => {
    const svc = makeService()
    const a = await svc.saveAsset({ fileName: 'a.png', data: png })
    const b = await svc.saveAsset({ fileName: 'b.png', data: png })
    expect(a.relPath).not.toBe(b.relPath)
    expect(b.relPath).toBe('assets/Pasted image 20261009154103-2.png')
  })

  it('非图片扩展名被拒', async () => {
    const svc = makeService()
    await expect(svc.saveAsset({ fileName: 'evil.html', data: png })).rejects.toThrow()
    await expect(svc.saveAsset({ fileName: 'noext', data: png })).rejects.toThrow()
  })

  it('svg 被拒(作为文档打开时是 XSS 向量)', async () => {
    const svc = makeService()
    await expect(svc.saveAsset({ fileName: 'x.svg', data: png })).rejects.toThrow()
  })

  it('超大附件被拒', async () => {
    const svc = makeService()
    const big = new Uint8Array(16 * 1024 * 1024 + 1).buffer
    await expect(svc.saveAsset({ fileName: 'big.png', data: big })).rejects.toThrow()
  })

  it('assets/ 子目录不进笔记列表', async () => {
    const svc = makeService()
    await svc.saveAsset({ fileName: 'a.png', data: png })
    expect((await svc.list()).notes).toEqual([])
  })
})

describe('附件:AI 按需读图(readAssetForAi)', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer

  it('读回 base64 与 mimeType(与协议同一套闸门)', async () => {
    const svc = makeService()
    const { relPath } = await svc.saveAsset({ fileName: 'shot.png', data: png })
    const out = await svc.readAssetForAi(relPath)
    if (!out.ok) throw new Error('unreachable')
    expect(out.mimeType).toBe('image/png')
    expect(out.bytes).toBe(4)
    expect(Buffer.from(out.data, 'base64')).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  it('%20 编码与原文两种写法都收(正文里存的是编码后的)', async () => {
    const svc = makeService()
    const { relPath } = await svc.saveAsset({ fileName: 'shot.png', data: png })
    const encoded = relPath.replace(/ /g, '%20')
    expect(encoded).not.toBe(relPath)
    expect((await svc.readAssetForAi(encoded)).ok).toBe(true)
    expect((await svc.readAssetForAi(relPath)).ok).toBe(true)
  })

  it('越界 / 不在 assets/ / 白名单外 → invalid,一个字节都不读', async () => {
    const svc = makeService()
    // 目录外放一个真文件:闸门若失效,这里就会读成功
    writeFileSync(join(svc.dir(), '..', 'outside.png'), Buffer.from([1, 2, 3]))
    for (const rel of ['../outside.png', 'assets/../../outside.png', 'notes.md', 'assets/x.svg', '']) {
      expect(await svc.readAssetForAi(rel)).toEqual({ ok: false, reason: 'invalid' })
    }
  })

  it('非图片附件给 not-image(视频/PDF 对模型没有可读内容)', async () => {
    const svc = makeService()
    mkdirSync(join(svc.dir(), 'assets'), { recursive: true })
    writeFileSync(join(svc.dir(), 'assets', 'v.mp4'), Buffer.from([0]))
    expect(await svc.readAssetForAi('assets/v.mp4')).toEqual({ ok: false, reason: 'not-image' })
  })

  it('超过 4 MiB 给 too-large 并带回实际体积', async () => {
    const svc = makeService()
    mkdirSync(join(svc.dir(), 'assets'), { recursive: true })
    writeFileSync(join(svc.dir(), 'assets', 'big.png'), Buffer.alloc(4 * 1024 * 1024 + 1))
    const out = await svc.readAssetForAi('assets/big.png')
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('unreachable')
    expect(out.reason).toBe('too-large')
    expect(out.size).toBe(4 * 1024 * 1024 + 1)
  })

  it('文件不存在 → io(闸门过了但读不到,与「路径不合法」区分开)', async () => {
    const svc = makeService()
    expect(await svc.readAssetForAi('assets/nope.png')).toEqual({ ok: false, reason: 'io' })
  })
})

describe('上限与统计', () => {
  it('超过 MAX_NOTES 时按 mtime 倒序截断并报 truncated', async () => {
    const dir = makeDir()
    // 直接落盘 2001 个文件(走 create 太慢)
    for (let i = 0; i < 2001; i++) writeFileSync(join(dir, `n${i}.md`), `---\ntitle: n${i}\n---\nx`)
    const svc = createNotesService({ getDir: () => dir, now: () => FIXED })
    const list = await svc.list()
    expect(list.notes).toHaveLength(2000)
    expect(list.truncated).toBe(1)
  })

  it('超过 MAX_NOTE_BYTES 的文件标记 tooLarge 且 read 拒绝', async () => {
    const svc = makeService()
    const dir = svc.dir()
    writeFileSync(join(dir, 'huge.md'), 'x'.repeat(MAX_NOTE_BYTES + 10))
    const list = await svc.list()
    expect(list.notes[0].tooLarge).toBe(true)
    expect(await svc.read('huge')).toBeNull()
  })

  it('目录不可读时返回 error 而不是空列表(「扫描挂了」与「真没有」不能长得一样)', async () => {
    const svc = createNotesService({ getDir: () => '/proc/definitely-not-here', now: () => FIXED })
    const list = await svc.list()
    expect(list.error).not.toBeNull()
  })
})

describe('readBodyForAi', () => {
  it('正常返回正文', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't', body: '正文' })
    const got = await svc.readBodyForAi(note.id)
    expect(got?.body).toBe('正文')
    expect(got?.truncated).toBe(false)
  })

  it('超长截断并标记', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't', body: 'x'.repeat(70 * 1024) })
    const got = await svc.readBodyForAi(note.id)
    expect(got?.truncated).toBe(true)
    expect(got?.body.length).toBe(64 * 1024)
  })

  it('不存在返回 null', async () => {
    const svc = makeService()
    expect(await svc.readBodyForAi('nope')).toBeNull()
  })
})

describe('revision 稳定性', () => {
  it('同一内容两次读到的 revision 相同', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't', body: 'x' })
    const a = await svc.read(note.id)
    const b = await svc.read(note.id)
    expect(a!.revision).toBe(b!.revision)
  })

  it('原子写不留 .tmp 残留', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't', body: 'x' })
    await svc.save({ id: note.id, body: 'y', expectedRevision: note.revision })
    expect(readdirSync(svc.dir()).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('写后 mtime 前移(否则索引会拿到陈旧缓存)', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 't', body: 'x' })
    const before = statSync(join(svc.dir(), `${note.id}.md`)).mtimeMs
    await svc.save({ id: note.id, body: 'y', expectedRevision: note.revision })
    const after = statSync(join(svc.dir(), `${note.id}.md`)).mtimeMs
    expect(after).toBeGreaterThanOrEqual(before)
  })
})

describe('目录笔记', () => {
  it('在指定目录下新建笔记,文件真的落在那个目录里', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '工作' })
    const note = await svc.create({ title: '复盘', parent: '工作' })

    expect(note.id).toBe('工作/复盘')
    expect(existsSync(join(svc.dir(), '工作', '复盘.md'))).toBe(true)
    expect((await svc.read(note.id))?.title).toBe('复盘')
  })

  it('多级目录', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: 'a' })
    await svc.createFolder({ parent: 'a', name: 'b' })
    const note = await svc.create({ title: 'c', parent: 'a/b' })
    expect(note.id).toBe('a/b/c')
    expect((await svc.list()).folders).toEqual(['a', 'a/b'])
  })

  it('扫描是递归的:外部丢进子目录的 .md 也能被列出', async () => {
    const svc = makeService()
    const dir = svc.dir()
    mkdirSync(join(dir, '工作', 'nginx'), { recursive: true })
    writeFileSync(join(dir, '工作', 'nginx', '反代.md'), '---\ntitle: 反代\n---\n正文')

    const list = await svc.list()
    expect(list.notes.map((n) => n.id)).toContain('工作/nginx/反代')
    expect(list.folders).toEqual(['工作', '工作/nginx'])
  })

  it('**空目录**也在 folders 里 —— 它是空目录唯一的痕迹', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '还没有笔记' })
    const list = await svc.list()
    expect(list.notes).toEqual([])
    expect(list.folders).toEqual(['还没有笔记'])
  })

  it('同名目录不报错,自动加序号', async () => {
    const svc = makeService()
    const a = await svc.createFolder({ parent: '', name: '工作' })
    const b = await svc.createFolder({ parent: '', name: '工作' })
    expect(a.id).toBe('工作')
    expect(b.id).toBe('工作-2')
  })

  it('目录名走与标题同一套清洗(非法字符 / 前导点)', async () => {
    const svc = makeService()
    expect((await svc.createFolder({ parent: '', name: 'a/b:c' })).id).toBe('a-b-c')
    expect((await svc.createFolder({ parent: '', name: '.hidden' })).id).toBe('hidden')
  })

  it('目录改名:文件跟着搬,目录内的笔记 id 前缀一起变', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '旧名' })
    const note = await svc.create({ title: 'n', parent: '旧名' })

    const { id } = await svc.renameFolder({ id: '旧名', name: '新名' })
    expect(id).toBe('新名')
    expect(existsSync(join(svc.dir(), '新名', 'n.md'))).toBe(true)
    expect(existsSync(join(svc.dir(), '旧名'))).toBe(false)
    // 索引跟着换了前缀:list 里是新 id
    const list = await svc.list()
    expect(list.notes.map((n) => n.id)).toEqual(['新名/n'])
    expect((await svc.read('新名/n'))?.title).toBe('n')
    expect(note.id).toBe('旧名/n') // 返回值是当时那个 id,不受后续改名影响
  })

  it('目录改名撞名时加序号', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '占用' })
    await svc.createFolder({ parent: '', name: '要改的' })
    expect((await svc.renameFolder({ id: '要改的', name: '占用' })).id).toBe('占用-2')
  })

  it('删除目录:整棵子树进 .trash,索引清干净', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '工作' })
    await svc.create({ title: 'n', parent: '工作' })

    const out = await svc.removeFolder({ id: '工作' })
    expect(out).toEqual({ ok: true, removed: true })
    expect(existsSync(join(svc.dir(), '工作'))).toBe(false)
    expect(readdirSync(join(svc.dir(), '.trash'))).toHaveLength(1)

    const list = await svc.list()
    expect(list.notes).toEqual([])
    expect(list.folders).toEqual([])
  })

  it('目录删除走注入的 trash 回调', async () => {
    const trashed: string[] = []
    const svc = makeService({ trash: async (p) => void trashed.push(p) })
    await svc.createFolder({ parent: '', name: '工作' })
    await svc.removeFolder({ id: '工作' })
    expect(trashed).toEqual([join(svc.dir(), '工作')])
  })

  it('根层重命名笔记时留在原目录里', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '工作' })
    const note = await svc.create({ title: '旧', parent: '工作' })
    const out = await svc.rename({ id: note.id, title: '新', expectedRevision: note.revision })
    expect(out.ok).toBe(true)
    if (!out.ok || !('note' in out)) throw new Error('expected note')
    expect(out.note.id).toBe('工作/新')
    expect(existsSync(join(svc.dir(), '工作', '新.md'))).toBe(true)
  })

  it('目录路径的穿越防护', async () => {
    const svc = makeService()
    for (const evil of ['../x', 'a/../../x', '/etc', 'a//b', 'a/.hidden']) {
      // ⚠ await 必须在 expect 外面套着:写成 `expect(await p).rejects` 的话
      // await 会先把拒绝抛出来,`.rejects` 根本没机会接住
      await expect(svc.create({ title: 't', parent: evil })).rejects.toThrow()
      expect((await svc.removeFolder({ id: evil })).ok).toBe(false)
      await expect(svc.renameFolder({ id: evil, name: 'x' })).rejects.toThrow()
    }
  })

  it('目录里的笔记仍可正常保存(CAS 不受路径影响)', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '工作' })
    const note = await svc.create({ title: 'n', parent: '工作', body: '旧' })
    const out = await svc.save({ id: note.id, body: '新', expectedRevision: note.revision })
    expect(out.ok).toBe(true)
    expect((await svc.read('工作/n'))?.body).toBe('新')
  })

  it('根层 assets/ 不参与扫描,但嵌套的同名目录是普通目录', async () => {
    const svc = makeService()
    const dir = svc.dir()
    await svc.saveAsset({ fileName: 'a.png', data: new Uint8Array([1]).buffer })
    mkdirSync(join(dir, '工作', 'assets'), { recursive: true })
    writeFileSync(join(dir, '工作', 'assets', 'x.md'), '---\ntitle: x\n---\n')

    const list = await svc.list()
    expect(list.notes.map((n) => n.id)).toEqual(['工作/assets/x'])
    expect(list.folders).toEqual(['工作', '工作/assets'])
  })
})

describe('标题回退', () => {
  it('目录里没写 title 的笔记,展示名是**文件名那一段**,不是完整路径', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '随手记' })
    const note = await svc.create({ title: '', parent: '随手记' })
    expect(note.id).toBe('随手记/note')
    expect(note.title).toBe('note') // 不是 '随手记/note'
  })

  it('正文有 # 标题时用标题,仍不带目录前缀', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '工作' })
    const note = await svc.create({ title: '', parent: '工作', body: '# 真标题\n正文' })
    expect(note.title).toBe('真标题')
  })

  it('历史遗留:文件里被写进了 `title: <完整 id>` 时当作没有标题,读出来是文件名', async () => {
    const svc = makeService()
    const dir = svc.dir()
    mkdirSync(join(dir, '随手记'), { recursive: true })
    // 早期版本真的会写出这种文件
    writeFileSync(join(dir, '随手记', 'note.md'), '---\ntitle: 随手记/note\n---\n正文')

    const list = await svc.list()
    expect(list.notes[0].title).toBe('note')

    // 保存一次即自愈:文件里的 title 被改成正常值
    const note = await svc.read('随手记/note')
    await svc.save({
      id: note!.id,
      body: note!.body,
      expectedRevision: note!.revision,
      meta: { title: note!.title }
    })
    expect(read(dir, '随手记/note.md')).toContain('title: note')
    expect(read(dir, '随手记/note.md')).not.toContain('随手记/note')
  })

  it('目录改名后标题里的旧路径也算残留(文件搬了,标题没跟着搬)', async () => {
    const svc = makeService()
    const dir = svc.dir()
    mkdirSync(join(dir, '随手记', 'sss'), { recursive: true })
    // 文件搬进子目录了,但 frontmatter 还留着搬家前的路径标题
    writeFileSync(join(dir, '随手记', 'sss', 'note.md'), '---\ntitle: 随手记/note\n---\n正文')
    expect((await svc.list()).notes[0].title).toBe('note')
  })

  it('用户手写的、真的带斜杠的标题不会被误判(尾段与文件名不同)', async () => {
    const svc = makeService()
    const dir = svc.dir()
    mkdirSync(join(dir, '工作'), { recursive: true })
    writeFileSync(join(dir, '工作', 'x.md'), '---\ntitle: 前端/后端对照\n---\n正文')
    expect((await svc.list()).notes[0].title).toBe('前端/后端对照')
  })

  it('根层笔记的标题恰好等于文件名时不受影响(不误判成遗留值)', async () => {
    const svc = makeService()
    const dir = svc.dir()
    writeFileSync(join(dir, 'note.md'), '---\ntitle: note\n---\n正文')
    expect((await svc.list()).notes[0].title).toBe('note')
    // 正文里有 # 标题也不该顶掉 frontmatter 的 title(根层没有目录前缀,不触发自愈)
    writeFileSync(join(dir, 'note.md'), '---\ntitle: note\n---\n# 别的标题')
    expect((await svc.list()).notes[0].title).toBe('note')
  })
})

describe('目录改名:边界', () => {
  it('**名字没改**时不动文件,也不追加 -2', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '工作' })
    const out = await svc.renameFolder({ id: '工作', name: '工作' })
    expect(out.id).toBe('工作')
    expect(existsSync(join(svc.dir(), '工作'))).toBe(true)
    expect(existsSync(join(svc.dir(), '工作-2'))).toBe(false)
  })

  it('清洗后与原名相同(如多打了空格)同样不追加 -2', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '工作' })
    expect((await svc.renameFolder({ id: '工作', name: '  工作  ' })).id).toBe('工作')
    expect(readdirSync(svc.dir()).filter((n) => n.startsWith('工作'))).toEqual(['工作'])
  })

  it('子目录同名判定同样只看自己那一段,不看完整路径', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: 'a' })
    await svc.createFolder({ parent: 'a', name: 'b' })
    expect((await svc.renameFolder({ id: 'a/b', name: 'b' })).id).toBe('a/b')
    expect(existsSync(join(svc.dir(), 'a', 'b'))).toBe(true)
  })

  it('真的撞到别的目录时才加序号', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '占用' })
    await svc.createFolder({ parent: '', name: '要改的' })
    expect((await svc.renameFolder({ id: '要改的', name: '占用' })).id).toBe('占用-2')
  })
})

describe('移动', () => {
  it('把笔记移进目录', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '工作' })
    const note = await svc.create({ title: 'n' })

    const out = await svc.move({ id: note.id, kind: 'note', parent: '工作' })
    expect(out).toEqual({ ok: true, id: '工作/n' })
    expect(existsSync(join(svc.dir(), '工作', 'n.md'))).toBe(true)
    expect(existsSync(join(svc.dir(), 'n.md'))).toBe(false)
    expect((await svc.read('工作/n'))?.body).toBe('')
  })

  it('从子目录移回根层', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '工作' })
    const note = await svc.create({ title: 'n', parent: '工作' })
    expect(moved(await svc.move({ id: note.id, kind: 'note', parent: '' }))).toBe('n')
    expect(existsSync(join(svc.dir(), 'n.md'))).toBe(true)
  })

  it('移动目录:整棵子树跟着走,索引前缀一起换', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: 'a' })
    await svc.createFolder({ parent: '', name: 'b' })
    await svc.create({ title: 'n', parent: 'a' })

    expect(moved(await svc.move({ id: 'a', kind: 'folder', parent: 'b' }))).toBe('b/a')
    expect(existsSync(join(svc.dir(), 'b', 'a', 'n.md'))).toBe(true)
    const list = await svc.list()
    expect(list.notes.map((n) => n.id)).toEqual(['b/a/n'])
    expect(list.folders).toEqual(['b', 'b/a'])
  })

  it('**不能把目录移进它自己或它的子孙**', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: 'a' })
    await svc.createFolder({ parent: 'a', name: 'b' })

    expect((await svc.move({ id: 'a', kind: 'folder', parent: 'a' })).ok).toBe(false)
    expect((await svc.move({ id: 'a', kind: 'folder', parent: 'a/b' })).ok).toBe(false)
    // 磁盘上原样未动
    expect(existsSync(join(svc.dir(), 'a', 'b'))).toBe(true)
  })

  it('移到原地 = 成功但不做任何事', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '工作' })
    const note = await svc.create({ title: 'n', parent: '工作' })
    const before = statSync(join(svc.dir(), '工作', 'n.md')).mtimeMs
    expect(moved(await svc.move({ id: note.id, kind: 'note', parent: '工作' }))).toBe('工作/n')
    expect(statSync(join(svc.dir(), '工作', 'n.md')).mtimeMs).toBe(before)
  })

  it('目标目录里同名时加序号', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '工作' })
    await svc.create({ title: 'n', parent: '工作' })
    const other = await svc.create({ title: 'n' })
    expect(moved(await svc.move({ id: other.id, kind: 'note', parent: '工作' }))).toBe('工作/n-2')
  })

  it('目录路径的穿越防护', async () => {
    const svc = makeService()
    const note = await svc.create({ title: 'n' })
    for (const evil of ['../x', 'a/../../x', '/etc', 'a//b', '.hidden']) {
      expect((await svc.move({ id: note.id, kind: 'note', parent: evil })).ok).toBe(false)
      expect((await svc.move({ id: evil, kind: 'note', parent: '' })).ok).toBe(false)
    }
    expect(existsSync(join(svc.dir(), 'n.md'))).toBe(true)
  })

  it('找不到的对象', async () => {
    const svc = makeService()
    expect((await svc.move({ id: 'nope', kind: 'note', parent: '' })).ok).toBe(false)
  })

  it('文件按普通文件移动,字节不变,扩展名留在原位', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '工作' })
    writeFileSync(join(svc.dir(), 'pic.png'), Buffer.from([1, 2, 3, 4]))

    const out = await svc.move({ id: 'pic.png', kind: 'file', parent: '工作' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.id).toBe('工作/pic.png')
    expect(out.file?.path).toBe('工作/pic.png')
    expect(out.file?.ext).toBe('png')
    expect(readFileSync(join(svc.dir(), '工作', 'pic.png'))).toEqual(Buffer.from([1, 2, 3, 4]))
    expect(existsSync(join(svc.dir(), 'pic.png'))).toBe(false)
    // 文件不进笔记索引
    expect((await svc.list()).notes.map((n) => n.id)).toEqual([])
    expect((await svc.list()).files.map((f) => f.path)).toEqual(['工作/pic.png'])
  })

  it('文件撞名保留扩展名:pic.png → pic-2.png,不是 pic.png-2', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '工作' })
    writeFileSync(join(svc.dir(), '工作', 'pic.png'), Buffer.from('old'))
    writeFileSync(join(svc.dir(), 'pic.png'), Buffer.from('new'))

    const out = await svc.move({ id: 'pic.png', kind: 'file', parent: '工作' })
    expect(out).toMatchObject({
      ok: true,
      id: '工作/pic-2.png',
      renamed: { from: 'pic.png', to: 'pic-2.png' }
    })
    expect(readFileSync(join(svc.dir(), '工作', 'pic.png'), 'utf8')).toBe('old')
    expect(readFileSync(join(svc.dir(), '工作', 'pic-2.png'), 'utf8')).toBe('new')
    expect(existsSync(join(svc.dir(), '工作', 'pic.png-2'))).toBe(false)
  })

  it('无扩展名文件不会把旁边同名笔记搬走', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '工作' })
    const note = await svc.create({ title: 'readme', body: '这是笔记' })
    writeFileSync(join(svc.dir(), 'readme'), '这是文件')

    const asFile = await svc.move({ id: 'readme', kind: 'file', parent: '工作' })
    expect(asFile.ok).toBe(true)
    if (!asFile.ok) return
    expect(asFile.id).toBe('工作/readme')
    expect(readFileSync(join(svc.dir(), '工作', 'readme'), 'utf8')).toBe('这是文件')
    // 笔记还在根层,正文一个字没动
    expect((await svc.read(note.id))?.body).toBe('这是笔记')
    expect(existsSync(join(svc.dir(), 'readme.md'))).toBe(true)

    // 反过来:按笔记移动也不会把文件当笔记
    writeFileSync(join(svc.dir(), '工作', 'plain'), '文件')
    expect((await svc.move({ id: '工作/plain', kind: 'note', parent: '' })).ok).toBe(false)
    expect(existsSync(join(svc.dir(), '工作', 'plain'))).toBe(true)
  })

  it('种类和磁盘不符就失败,不改名', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '工作' })
    await svc.createFolder({ parent: '', name: '目标' })
    writeFileSync(join(svc.dir(), 'pic.png'), Buffer.from('x'))

    expect((await svc.move({ id: 'pic.png', kind: 'folder', parent: '目标' })).ok).toBe(false)
    expect((await svc.move({ id: '工作', kind: 'file', parent: '目标' })).ok).toBe(false)
    expect((await svc.move({ id: '工作', kind: 'note', parent: '目标' })).ok).toBe(false)
    expect(existsSync(join(svc.dir(), 'pic.png'))).toBe(true)
    expect(existsSync(join(svc.dir(), '工作'))).toBe(true)
  })
})

/** move 的返回是联合类型:断言成功并把 id 取出来 */
function moved(out: { ok: true; id: string } | { ok: false; message: string }): string {
  if (!out.ok) throw new Error(`move 失败:${out.message}`)
  return out.id
}

/** 时钟可推进的实例:makeService 用的是固定 now,测「时间有没有变」必须能推动它 */
function makeClockService(): { svc: NotesService; advance: (ms: number) => void } {
  const dir = makeDir()
  let t = FIXED
  return {
    svc: createNotesService({ getDir: () => dir, now: () => t }),
    advance: (ms) => {
      t += ms
    }
  }
}

describe('touchUpdated', () => {
  it('默认会把 updated 推到当前时间', async () => {
    const { svc, advance } = makeClockService()
    const note = await svc.create({ title: 'n' })
    const before = (await svc.read(note.id))!.updated
    advance(60_000)
    const cur = (await svc.read(note.id))!
    await svc.save({
      id: note.id,
      body: cur.body,
      expectedRevision: cur.revision,
      meta: { pinned: true }
    })
    expect((await svc.read(note.id))!.updated).not.toBe(before)
  })

  it('touchUpdated=false 时 updated 原地不动(置顶用)', async () => {
    const { svc, advance } = makeClockService()
    const note = await svc.create({ title: 'n' })
    const before = (await svc.read(note.id))!.updated
    advance(60_000)
    const cur = (await svc.read(note.id))!
    const out = await svc.save({
      id: note.id,
      body: cur.body,
      expectedRevision: cur.revision,
      meta: { pinned: true },
      touchUpdated: false
    })
    expect(out.ok).toBe(true)
    const after = (await svc.read(note.id))!
    expect(after.updated).toBe(before)
    expect(after.pinned).toBe(true)
  })
})

describe('移动撞名', () => {
  it('目标已有同名笔记:不覆盖,加序号,并在 renamed 里如实带回', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: 'dst' })
    await svc.create({ title: 'n', parent: 'dst', body: '原有的' })
    const src = await svc.create({ title: 'n', body: '要移过去的' })

    const out = await svc.move({ id: src.id, kind: 'note', parent: 'dst' })
    expect(out).toEqual({ ok: true, id: 'dst/n-2', renamed: { from: 'n', to: 'n-2' } })
    // 两边都在,内容都没丢
    expect((await svc.read('dst/n'))?.body).toBe('原有的')
    expect((await svc.read('dst/n-2'))?.body).toBe('要移过去的')
  })

  it('**撞名改名时标题一起改** —— 否则标题与文件名脱钩,下次失焦会被改回去再撞一次', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: 'dst' })
    await svc.create({ title: 'n', parent: 'dst' })
    const src = await svc.create({ title: 'n' })

    const out = await svc.move({ id: src.id, kind: 'note', parent: 'dst' })
    if (!out.ok) throw new Error('move failed')
    const moved = await svc.read(out.id)
    expect(moved?.title).toBe('n-2') // 与文件名一致
    expect(moved?.title).toBe(out.id.split('/').pop())
  })

  it('没有 frontmatter title 的笔记不用补:展示名本来就取自文件名', async () => {
    const svc = makeService()
    const dir = svc.dir()
    mkdirSync(join(dir, 'dst'), { recursive: true })
    writeFileSync(join(dir, 'dst', 'bare.md'), '原有的')
    writeFileSync(join(dir, 'bare.md'), '要移过去的')

    const out = await svc.move({ id: 'bare', kind: 'note', parent: 'dst' })
    expect(out).toEqual({ ok: true, id: 'dst/bare-2', renamed: { from: 'bare', to: 'bare-2' } })
    expect(read(dir, 'dst/bare-2.md')).toBe('要移过去的') // 正文一个字没动
  })

  it('目录撞名同样加序号', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: 'dst' })
    await svc.createFolder({ parent: 'dst', name: 'sub' })
    await svc.createFolder({ parent: '', name: 'sub' })

    const out = await svc.move({ id: 'sub', kind: 'folder', parent: 'dst' })
    expect(out).toEqual({ ok: true, id: 'dst/sub-2', renamed: { from: 'sub', to: 'sub-2' } })
    expect(existsSync(join(svc.dir(), 'dst', 'sub-2'))).toBe(true)
  })

  it('不撞名时不返回 renamed', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: 'dst' })
    const src = await svc.create({ title: 'unique' })
    const out = await svc.move({ id: src.id, kind: 'note', parent: 'dst' })
    expect(out).toEqual({ ok: true, id: 'dst/unique' })
  })

  it('撞名后标题与文件名仍然一致(不变式不被破坏)', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: 'dst' })
    await svc.create({ title: 'x', parent: 'dst' })
    const src = await svc.create({ title: 'x' })
    const out = await svc.move({ id: src.id, kind: 'note', parent: 'dst' })
    if (!out.ok) throw new Error('move failed')
    const note = await svc.read(out.id)
    expect(note?.title).toBe(out.id.split('/').pop())
  })
})

describe('重命名撞名(右侧标题栏改名)', () => {
  it('目标名已存在:不覆盖,加序号,**且标题跟着改成带序号的名字**', async () => {
    const svc = makeService()
    await svc.create({ title: 'n', body: '原有的' })
    const src = await svc.create({ title: 'other', body: '要改名的' })

    const out = await svc.rename({
      id: src.id,
      title: 'n',
      expectedRevision: src.revision,
      onConflict: 'auto-rename'
    })
    if (!out.ok || !('note' in out)) throw new Error('rename failed')
    expect(out.note.id).toBe('n-2')
    // 标题必须与文件名一致,否则下次失焦会被 syncFileName 改回去 → 再撞 → 连锁
    expect(out.note.title).toBe('n-2')
    expect(out.note.title).toBe(out.note.id.split('/').pop())
    // 原有的那篇没被动
    expect((await svc.read('n'))?.body).toBe('原有的')
    expect((await svc.read('n-2'))?.body).toBe('要改名的')
  })

  it('不撞名时标题就是用户输入的那个(不做多余加工)', async () => {
    const svc = makeService()
    const src = await svc.create({ title: 'old' })
    const out = await svc.rename({ id: src.id, title: '全新名字', expectedRevision: src.revision })
    if (!out.ok || !('note' in out)) throw new Error('rename failed')
    expect(out.note.id).toBe('全新名字')
    expect(out.note.title).toBe('全新名字')
  })

  it('撞名改名后标题与文件名仍然一致(不变式不被破坏)', async () => {
    const svc = makeService()
    await svc.create({ title: 'x' })
    const src = await svc.create({ title: 'y' })
    const out = await svc.rename({
      id: src.id,
      title: 'x',
      expectedRevision: src.revision,
      onConflict: 'auto-rename'
    })
    if (!out.ok || !('note' in out)) throw new Error('rename failed')
    expect(out.note.title).toBe(out.note.id.split('/').pop())
  })
})

describe('移动不得破坏附件(禁忌项)', () => {
  it('附件路径相对**笔记目录**,不是相对笔记所在目录 —— 所以移动后引用仍然有效', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '工作' })
    await svc.createFolder({ parent: '', name: '随手记' })

    // 附件一律落在 <笔记目录>/assets/,与笔记在哪个子目录无关
    const asset = await svc.saveAsset({ fileName: 'a.png', data: new Uint8Array([1, 2, 3]).buffer })
    expect(asset.relPath).toBe('assets/Pasted image 20261009154103.png')

    const note = await svc.create({ title: '带图', parent: '工作', body: `![图](${asset.relPath})` })
    const before = (await svc.read(note.id))!.body

    const moved = await svc.move({ id: note.id, kind: 'note', parent: '随手记' })
    if (!moved.ok) throw new Error('move failed')

    // 正文一个字节没变 → 引用仍然指向同一个附件
    expect((await svc.read(moved.id))!.body).toBe(before)
    expect(before).toContain('assets/')
    // 附件本身也没被搬走
    expect(existsSync(join(svc.dir(), asset.relPath))).toBe(true)
  })

  it('移动**目录**同样不影响目录内笔记的附件引用', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: 'a' })
    await svc.createFolder({ parent: '', name: 'b' })
    const asset = await svc.saveAsset({ fileName: 'a.png', data: new Uint8Array([9]).buffer })
    const note = await svc.create({ title: 'n', parent: 'a', body: `![图](${asset.relPath})` })
    const before = (await svc.read(note.id))!.body

    const moved = await svc.move({ id: 'a', kind: 'folder', parent: 'b' })
    if (!moved.ok) throw new Error('move failed')
    expect((await svc.read(moved.id + '/n'))!.body).toBe(before)
    expect(existsSync(join(svc.dir(), asset.relPath))).toBe(true)
  })
})

describe('ensureSample(首次运行的示例笔记)', () => {
  const sample = { title: '随心手记示例', body: '# 随心手记示例\n\n正文' }

  it('目录完全为空时写入,并返回 true', async () => {
    const svc = makeService()
    expect(await svc.ensureSample(sample)).toBe('created')
    const list = await svc.list()
    expect(list.notes.map((n) => n.title)).toEqual(['随心手记示例'])
  })

  it('已经有笔记就不写 —— 用户删掉示例之后不该再冒出来', async () => {
    const svc = makeService()
    await svc.create({ title: '我自己的', body: 'x' })
    expect(await svc.ensureSample(sample)).toBe('none')
    expect((await svc.list()).notes.map((n) => n.title)).toEqual(['我自己的'])
  })

  it('**只有空目录也算「不空」** —— 用户建过目录就说明他用过', async () => {
    const svc = makeService()
    await svc.createFolder({ parent: '', name: '工作' })
    expect(await svc.ensureSample(sample)).toBe('none')
    expect((await svc.list()).notes).toHaveLength(0)
  })

  it('assets/ 不算「用户的目录」(它是附件区,不是他建的东西)', async () => {
    const svc = makeService()
    await svc.saveAsset({ fileName: 'a.png', data: new ArrayBuffer(8) })
    expect(await svc.ensureSample(sample)).toBe('created')
  })

  it('重复调用只会有一篇(第二次看到目录已非空)', async () => {
    const svc = makeService()
    expect(await svc.ensureSample(sample)).toBe('created')
    expect(await svc.ensureSample(sample)).toBe('none')
    expect((await svc.list()).notes).toHaveLength(1)
  })

  it('写出来的示例自己读得回来,标题与正文都没坏', async () => {
    const svc = makeService()
    await svc.ensureSample(sample)
    const note = await svc.read('随心手记示例')
    expect(note?.title).toBe('随心手记示例')
    expect(note?.body).toContain('正文')
  })

  it('示例自带的标签写进 frontmatter —— 首启就有标签面板可看、可点', async () => {
    const svc = makeService()
    await svc.ensureSample({ ...sample, tags: ['示例', '用法演示'] })
    const note = await svc.read('随心手记示例')
    expect(note?.tags).toEqual(['示例', '用法演示'])
    // 列表里也读得到:左侧标签面板的数据源就是它
    expect((await svc.list()).notes[0]?.tags).toEqual(['示例', '用法演示'])
  })
})

describe('ensureSample:跟随界面语言', () => {
  const ZH = { title: '随心手记示例', body: '# 随心手记示例\n\n正文' }
  const EN = { title: 'Notes feature tour', body: '# Notes feature tour\n\nbody' }
  const zhInput = { ...ZH, other: EN }
  const enInput = { ...EN, other: ZH }

  it('空目录 → 写当前语言那篇', async () => {
    const svc = makeService()
    expect(await svc.ensureSample(enInput)).toBe('created')
    expect((await svc.list()).notes.map((n) => n.title)).toEqual(['Notes feature tour'])
  })

  it('已有一篇**没改过的**另一种语言版本 → 换成当前语言(连文件名一起)', async () => {
    const svc = makeService()
    await svc.ensureSample(zhInput)
    expect(await svc.ensureSample(enInput)).toBe('switched')
    const list = await svc.list()
    expect(list.notes.map((n) => n.title)).toEqual(['Notes feature tour'])
    expect((await svc.read('Notes feature tour'))?.body).toContain('body')
  })

  it('换语言后示例带的是新语言那套标签,不是旧的那套', async () => {
    const svc = makeService()
    await svc.ensureSample({ ...zhInput, tags: ['示例', '用法演示'] })
    expect(await svc.ensureSample({ ...enInput, tags: ['sample', 'demo'] })).toBe('switched')
    expect((await svc.read('Notes feature tour'))?.tags).toEqual(['sample', 'demo'])
  })

  it('用户动过标签(哪怕正文没改)也不换 —— 那篇已经是他的笔记了', async () => {
    const svc = makeService()
    await svc.ensureSample({ ...zhInput, tags: ['示例', '用法演示'] })
    const n = await svc.read('随心手记示例')
    await svc.save({
      id: n!.id,
      body: n!.body,
      expectedRevision: n!.revision,
      meta: { tags: ['示例'] }
    })
    const en = { ...EN, other: { ...ZH, tags: ['示例', '用法演示'] } }
    expect(await svc.ensureSample(en)).toBe('none')
    expect((await svc.list()).notes.map((x) => x.title)).toEqual(['随心手记示例'])
  })

  it('**用户改过一个字就不换** —— 那已经是他的笔记了', async () => {
    const svc = makeService()
    await svc.ensureSample(zhInput)
    const n = await svc.read('随心手记示例')
    await svc.save({ id: n!.id, body: '# 随心手记示例\n\n我自己加的', expectedRevision: n!.revision })
    expect(await svc.ensureSample(enInput)).toBe('none')
    expect((await svc.list()).notes.map((x) => x.title)).toEqual(['随心手记示例'])
  })

  it('语言没变时不折腾(标题相同直接返回 none)', async () => {
    const svc = makeService()
    await svc.ensureSample(zhInput)
    expect(await svc.ensureSample(zhInput)).toBe('none')
    expect((await svc.list()).notes).toHaveLength(1)
  })

  it('目录里是别的笔记 → 不碰', async () => {
    const svc = makeService()
    await svc.create({ title: '我自己的', body: 'x' })
    expect(await svc.ensureSample(enInput)).toBe('none')
  })

  it('换成当前语言之后再来一次,不会来回横跳', async () => {
    const svc = makeService()
    await svc.ensureSample(zhInput)
    expect(await svc.ensureSample(enInput)).toBe('switched')
    expect(await svc.ensureSample(enInput)).toBe('none')
    // 再切回中文:认得出这是「英文那篇、没改过」,换回去
    expect(await svc.ensureSample(zhInput)).toBe('switched')
    expect((await svc.list()).notes.map((n) => n.title)).toEqual(['随心手记示例'])
  })
})

describe('非 Markdown 文件与批量导入', () => {
  it('列出非 .md 文件;根层 assets/ 不列,嵌套 assets/ 正常列', async () => {
    const svc = makeService()
    const dir = svc.dir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.pdf'), 'pdf')
    mkdirSync(join(dir, '工作', 'assets'), { recursive: true })
    writeFileSync(join(dir, '工作', 'assets', 'p.png'), 'png')
    mkdirSync(join(dir, 'assets'), { recursive: true })
    writeFileSync(join(dir, 'assets', 'pasted.png'), 'png')

    const list = await svc.list()
    expect(list.files.map((f) => f.path).sort()).toEqual(['a.pdf', '工作/assets/p.png'])
    expect(list.files.find((f) => f.path === 'a.pdf')?.ext).toBe('pdf')
    expect(list.truncatedFiles).toBe(0)
  })

  it('importPaths 复制目录树;.md 变笔记,其它文件进 files', async () => {
    const svc = makeService()
    const src = mkdtempSync(join(tmpdir(), 'launcher-src-'))
    dirs.push(src)
    mkdirSync(join(src, 'pkg', 'sub'), { recursive: true })
    writeFileSync(join(src, 'pkg', 'readme.md'), '# 导入\n')
    writeFileSync(join(src, 'pkg', 'p.pdf'), 'pdf')
    writeFileSync(join(src, 'pkg', 'sub', 'x.txt'), 'x')

    const out = await svc.importPaths({ target: '', paths: [join(src, 'pkg')] })
    expect(out.ok).toBe(true)
    const list = await svc.list()
    expect(list.notes.map((n) => n.id)).toContain('pkg/readme')
    expect(list.files.map((f) => f.path).sort()).toEqual(['pkg/p.pdf', 'pkg/sub/x.txt'])
  })

  it('removeFile 走 trash 回调,删完从列表消失', async () => {
    const trashed: string[] = []
    const svc = makeService({
      trash: async (p) => {
        trashed.push(p)
        rmSync(p)
      }
    })
    const dir = svc.dir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'tmp.txt'), 'x')
    expect(await svc.list()).toMatchObject({ files: [{ path: 'tmp.txt' }] })

    expect(await svc.removeFile('tmp.txt')).toEqual({ ok: true })
    expect(trashed).toEqual([join(dir, 'tmp.txt')])
    expect((await svc.list()).files).toEqual([])
  })

  it('removeFile 拒绝目录 / 穿越 / 根层 assets', async () => {
    const svc = makeService()
    const dir = svc.dir()
    mkdirSync(join(dir, '文件夹'), { recursive: true })
    mkdirSync(join(dir, 'assets'), { recursive: true })
    writeFileSync(join(dir, 'assets', 'pasted.png'), 'x')

    expect((await svc.removeFile('文件夹')).ok).toBe(false)
    expect((await svc.removeFile('../x')).ok).toBe(false)
    expect((await svc.removeFile('assets/pasted.png')).ok).toBe(false)
  })

  it('只有非 md 文件时 ensureSample 不写示例', async () => {
    const svc = makeService()
    mkdirSync(svc.dir(), { recursive: true })
    writeFileSync(join(svc.dir(), 'only.txt'), 'x')
    expect(await svc.ensureSample({ title: '示例', body: '示例正文' })).toBe('none')
    expect((await svc.list()).notes).toHaveLength(0)
  })

  it('resolveNoteFile 只放行笔记目录内的普通文件', async () => {
    const svc = makeService()
    mkdirSync(svc.dir(), { recursive: true })
    writeFileSync(join(svc.dir(), 'a.txt'), 'a')
    expect(svc.resolveNoteFile('a.txt')).toBe(join(svc.dir(), 'a.txt'))
    expect(svc.resolveNoteFile('../a.txt')).toBeNull()
  })
})

describe('非 Markdown 文件:stat / read / save / bytes', () => {
  it('statFile 按扩展名分类,并拒绝根层 assets 与越界路径', async () => {
    const svc = makeService()
    const dir = svc.dir()
    mkdirSync(join(dir, 'assets'), { recursive: true })
    writeFileSync(join(dir, 'app.js'), 'const a = 1\n')
    writeFileSync(join(dir, 'shot.png'), 'png')
    writeFileSync(join(dir, 'Makefile'), 'all:\n')
    writeFileSync(join(dir, 'LICENSE'), 'MIT\n')
    writeFileSync(join(dir, 'assets', 'x.png'), 'x')

    expect(svc.statFile('app.js')).toMatchObject({ kind: 'code', editable: true, ext: 'js' })
    expect(svc.statFile('shot.png')).toMatchObject({ kind: 'image', editable: false })
    expect(svc.statFile('Makefile')).toMatchObject({ kind: 'code', editable: true })
    expect(svc.statFile('LICENSE')).toMatchObject({ kind: 'text', editable: true })
    expect(svc.statFile('assets/x.png')).toBeNull()
    expect(svc.statFile('../x')).toBeNull()
    expect(svc.statFile('none.txt')).toBeNull()
  })

  it('readFile 解码文本、保留 EOL 与 BOM;未知扩展名读成纯文本', async () => {
    const svc = makeService()
    const dir = svc.dir()
    writeFileSync(
      join(dir, 'bom.js'),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\r\nb\r\n')])
    )
    writeFileSync(join(dir, 'notes.mystery'), 'plain\n')

    const bom = await svc.readFile('bom.js')
    expect(bom.ok).toBe(true)
    if (!bom.ok || !bom.doc.editable) throw new Error('expected text')
    expect(bom.doc).toMatchObject({
      kind: 'code',
      editable: true,
      encoding: 'utf8-bom',
      eol: '\r\n',
      text: 'a\nb\n',
      tooLarge: false
    })
    expect(bom.doc.revision).toMatch(/^[0-9a-f]{40}$/)

    const unknown = await svc.readFile('notes.mystery')
    expect(unknown.ok).toBe(true)
    if (!unknown.ok) throw new Error('expected read')
    expect(unknown.doc.editable).toBe(true)
    expect(unknown.doc.kind).toBe('text')
  })

  it('readFile 对已知二进制返回占位而不是乱码', async () => {
    const svc = makeService()
    writeFileSync(join(svc.dir(), 'x.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]))
    const r = await svc.readFile('x.png')
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('expected read')
    expect(r.doc).toMatchObject({ kind: 'image', editable: false, revision: null, reason: 'unsupported' })

    writeFileSync(join(svc.dir(), 'bad.txt'), Buffer.from([0x41, 0x00, 0x42]))
    const bad = await svc.readFile('bad.txt')
    expect(bad.ok && !bad.doc.editable ? bad.doc.reason : null).toBe('binary')
  })

  it('saveFile 用原始字节 sha1 做 CAS,冲突时不覆盖', async () => {
    const svc = makeService()
    const dir = svc.dir()
    writeFileSync(join(dir, 'a.txt'), 'old')
    const first = await svc.readFile('a.txt')
    if (!first.ok || !first.doc.editable) throw new Error('expected text')

    const saved = await svc.saveFile({
      path: 'a.txt',
      text: 'new\n',
      expectedRevision: first.doc.revision
    })
    expect(saved.ok).toBe(true)
    expect(read(dir, 'a.txt')).toBe('new\n')

    const stale = await svc.saveFile({
      path: 'a.txt',
      text: 'stale',
      expectedRevision: first.doc.revision
    })
    expect(stale.ok).toBe(false)
    if (stale.ok || stale.kind !== 'conflict') throw new Error('expected conflict')
    expect(stale.latest.revision).not.toBe(first.doc.revision)
    expect(read(dir, 'a.txt')).toBe('new\n')
  })

  it('saveFile 按原编码 / BOM / EOL 还原(UTF-8 BOM + CRLF、UTF-16LE)', async () => {
    const svc = makeService()
    const dir = svc.dir()
    const bomPath = join(dir, 'bom.js')
    writeFileSync(
      bomPath,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\r\nb\r\n')])
    )
    const bom = await svc.readFile('bom.js')
    if (!bom.ok || !bom.doc.editable) throw new Error('expected text')
    const out = await svc.saveFile({
      path: 'bom.js',
      text: 'x\ny\n',
      expectedRevision: bom.doc.revision
    })
    expect(out.ok).toBe(true)
    expect(Array.from(readFileSync(bomPath))).toEqual(
      Array.from(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('x\r\ny\r\n')]))
    )

    const u16Path = join(dir, 'u16.txt')
    const u16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('a\nb\n', 'utf16le')
    ])
    writeFileSync(u16Path, u16)
    const doc = await svc.readFile('u16.txt')
    if (!doc.ok || !doc.doc.editable) throw new Error('expected text')
    expect(doc.doc).toMatchObject({ encoding: 'utf16le', eol: '\n', text: 'a\nb\n' })
    const saved = await svc.saveFile({
      path: 'u16.txt',
      text: 'c\nd\n',
      expectedRevision: doc.doc.revision
    })
    expect(saved.ok).toBe(true)
    expect(Array.from(readFileSync(u16Path))).toEqual(
      Array.from(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('c\nd\n', 'utf16le')]))
    )
  })

  it('saveFile 拒绝二进制文件与越界路径', async () => {
    const svc = makeService()
    writeFileSync(join(svc.dir(), 'x.bin'), Buffer.from([0x41, 0x00]))
    const bin = await svc.saveFile({ path: 'x.bin', text: 'text', expectedRevision: 'x', force: true })
    expect(bin).toMatchObject({ ok: false, kind: 'not-text' })

    const outside = await svc.saveFile({ path: '../x.txt', text: 'x', expectedRevision: 'x' })
    expect(outside).toMatchObject({ ok: false, kind: 'not-found' })
    const noRev = await svc.saveFile({ path: 'x.bin', text: 'x', expectedRevision: '' })
    expect(noRev).toMatchObject({ ok: false, kind: 'invalid' })
  })

  it('readFileBytes 返回原始字节,并支持按调用方上限拦截', async () => {
    const svc = makeService()
    const dir = svc.dir()
    writeFileSync(join(dir, 'a.bin'), Buffer.from([1, 2, 3]))
    const ok = await svc.readFileBytes('a.bin')
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error('expected bytes')
    expect(Array.from(ok.data)).toEqual([1, 2, 3])

    const limited = await svc.readFileBytes('a.bin', 2)
    expect(limited).toMatchObject({ ok: false, kind: 'too-large', size: 3 })
  })
})

describe('createFile(新建任意类型的空文件)', () => {
  it('根层与子目录都能建;落盘为空文件并出现在列表里', async () => {
    const svc = makeService()
    const rootFile = await svc.createFile({ parent: '', name: 'app.js' })
    expect(rootFile.ok).toBe(true)
    if (!rootFile.ok) throw new Error('expected file')
    expect(rootFile.file.path).toBe('app.js')
    expect(rootFile.file.kind).toBe('code')
    expect(rootFile.file.editable).toBe(true)
    expect(readFileSync(join(svc.dir(), 'app.js'), 'utf8')).toBe('')

    const nested = await svc.createFile({ parent: 'docs', name: 'notes.txt' })
    expect(nested.ok && nested.file.path).toBe('docs/notes.txt')
    expect(existsSync(join(svc.dir(), 'docs', 'notes.txt'))).toBe(true)

    const list = await svc.list()
    expect(list.files.map((f) => f.path)).toEqual(expect.arrayContaining(['app.js', 'docs/notes.txt']))
  })

  it('同名不覆盖;.md 交给笔记创建;非法目录 / 名字 / assets 被拒', async () => {
    const svc = makeService()
    writeFileSync(join(svc.dir(), 'app.js'), 'keep')

    const exists = await svc.createFile({ parent: '', name: 'app.js' })
    expect(exists).toMatchObject({ ok: false, kind: 'exists' })
    expect(read(svc.dir(), 'app.js')).toBe('keep')

    expect(await svc.createFile({ parent: '', name: 'x.md' })).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await svc.createFile({ parent: '', name: 'noext' })).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await svc.createFile({ parent: '', name: 'a/b.txt' })).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await svc.createFile({ parent: '../evil', name: 'x.txt' })).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await svc.createFile({ parent: 'assets', name: 'x.png' })).toMatchObject({ ok: false, kind: 'invalid' })
  })
})

describe('renameFile(重命名文件,完整新文件名)', () => {
  it('传入完整新文件名:目录保留、内容不动', async () => {
    const svc = makeService()
    mkdirSync(join(svc.dir(), 'docs'), { recursive: true })
    writeFileSync(join(svc.dir(), 'docs', 'old.txt'), 'hello')

    // 以前只传主名,主进程会把旧后缀拼回去。现在 `new` 就是新文件名,不再长出 .txt。
    const out = await svc.renameFile({ path: 'docs/old.txt', name: 'new.txt' })
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error('expected renamed')
    expect(out.file.path).toBe('docs/new.txt')
    expect(out.file.name).toBe('new.txt')
    expect(out.file.ext).toBe('txt')
    expect(out.file.kind).toBe('text')

    expect(existsSync(join(svc.dir(), 'docs', 'old.txt'))).toBe(false)
    expect(read(svc.dir(), 'docs/new.txt')).toBe('hello')
    const list = await svc.list()
    expect(list.files.map((f) => f.path)).toContain('docs/new.txt')
  })

  it('后缀按传入的新名字走,不再沿用旧文件的大小写', async () => {
    const svc = makeService()
    writeFileSync(join(svc.dir(), 'ic.PNG'), 'x')

    // 以前会把自带的 .png 剔掉,再拼回旧的 .PNG。现在新名字原样落地。
    const out = await svc.renameFile({ path: 'ic.PNG', name: 'image.png' })
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error('expected renamed')
    expect(out.file.path).toBe('image.png')
    expect(out.file.ext).toBe('png')
    expect(out.file.kind).toBe('image')
  })

  it('同名目标拒绝且原文件不动;缺失文件 not-found', async () => {
    const svc = makeService()
    writeFileSync(join(svc.dir(), 'a.txt'), 'A')
    writeFileSync(join(svc.dir(), 'b.txt'), 'B')

    const exists = await svc.renameFile({ path: 'a.txt', name: 'b.txt' })
    expect(exists).toMatchObject({ ok: false, kind: 'exists' })
    expect(read(svc.dir(), 'a.txt')).toBe('A')
    expect(read(svc.dir(), 'b.txt')).toBe('B')

    expect(await svc.renameFile({ path: 'missing.txt', name: 'x.txt' })).toMatchObject({
      ok: false,
      kind: 'not-found'
    })
    expect(await svc.renameFile({ path: '../a.txt', name: 'x.txt' })).toMatchObject({
      ok: false,
      kind: 'not-found'
    })
    mkdirSync(join(svc.dir(), 'assets'), { recursive: true })
    writeFileSync(join(svc.dir(), 'assets', 'x.png'), 'x')
    expect(await svc.renameFile({ path: 'assets/x.png', name: 'y.png' })).toMatchObject({
      ok: false,
      kind: 'not-found'
    })
  })

  it('非法文件名与改成 .md 被拒;无扩展名的文件可以加上扩展名', async () => {
    const svc = makeService()
    writeFileSync(join(svc.dir(), 'a.txt'), 'A')

    expect(await svc.renameFile({ path: 'a.txt', name: '' })).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await svc.renameFile({ path: 'a.txt', name: '   ' })).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await svc.renameFile({ path: 'a.txt', name: '.hidden' })).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await svc.renameFile({ path: 'a.txt', name: 'a/b' })).toMatchObject({ ok: false, kind: 'invalid' })
    // .md 会被扫描收成笔记,文件改名不走这条路
    expect(await svc.renameFile({ path: 'a.txt', name: 'a.md' })).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await svc.renameFile({ path: 'a.txt', name: 'a.MD' })).toMatchObject({ ok: false, kind: 'invalid' })
    expect(existsSync(join(svc.dir(), 'a.txt'))).toBe(true)

    const changed = await svc.renameFile({ path: 'a.txt', name: 'b.js' })
    expect(changed.ok).toBe(true)
    if (!changed.ok) throw new Error('expected renamed')
    expect(changed.file.path).toBe('b.js')
    expect(changed.file.kind).toBe('code')
    expect(read(svc.dir(), 'b.js')).toBe('A')

    // 无扩展名文件名:只改主名,也可以加上扩展名
    writeFileSync(join(svc.dir(), 'Makefile'), 'x')
    const keep = await svc.renameFile({ path: 'Makefile', name: 'Buildfile' })
    expect(keep.ok && keep.file.path).toBe('Buildfile')
    const gained = await svc.renameFile({ path: 'Buildfile', name: 'Buildfile.sh' })
    expect(gained.ok).toBe(true)
    if (!gained.ok) throw new Error('expected renamed')
    expect(gained.file.path).toBe('Buildfile.sh')
    expect(gained.file.ext).toBe('sh')
  })

  it('文件名没变时直接返回当前元信息', async () => {
    const svc = makeService()
    writeFileSync(join(svc.dir(), 'a.txt'), 'A')
    const out = await svc.renameFile({ path: 'a.txt', name: 'a.txt' })
    expect(out.ok && out.file.path).toBe('a.txt')
    expect(read(svc.dir(), 'a.txt')).toBe('A')
  })
})
