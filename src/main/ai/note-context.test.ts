// 引用注入的回归:这一层错了会以「模型答非所问」的形式出现 —— 界面上看不出任何异常,
// 所以每条规则都钉在这里(截断、上限、缺失、片段、去重)。
import { describe, expect, it } from 'vitest'
import type { AiMessage, AiMention } from '../../shared/ai'
import { MAX_MENTIONS } from '../../shared/ai'
import { MAX_NOTE_MENTION_BYTES, MAX_NOTE_QUOTE_BYTES, type Note } from '../../shared/notes'
import { cutUtf8, mentionContext, resolveNoteContexts, sanitizeMentions } from './note-context'

function noteOf(id: string, patch: Partial<Note> = {}): Note {
  return {
    id,
    title: patch.title ?? id,
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

/** 内存读取器:顺便统计每个 id 被读了几次 */
function reader(notes: Record<string, { title?: string; body: string; tags?: string[] }>) {
  const reads: string[] = []
  return {
    reads,
    read: async (id: string) => {
      reads.push(id)
      const n = notes[id]
      if (!n) return null
      return {
        note: noteOf(id, { title: n.title ?? id, body: n.body, tags: n.tags ?? [] }),
        body: n.body,
        truncated: false
      }
    }
  }
}

const userMsg = (text: string, mentions?: AiMention[]): AiMessage => ({
  role: 'user',
  id: 'u1',
  blocks: [{ type: 'text', text }],
  ...(mentions ? { mentions } : {}),
  timestamp: 1
})

const noteMention = (id: string, extra: Partial<AiMention> = {}): AiMention => ({
  key: `note:${id}`,
  type: 'note',
  id,
  label: id,
  ...extra
})

describe('resolveNoteContexts', () => {
  it('按 key 去重,同一个 id 只读一次盘', async () => {
    const r = reader({ a: { title: 'A', body: '甲' } })
    const ctx = await resolveNoteContexts(r.read, [
      userMsg('一', [noteMention('a')]),
      userMsg('二', [noteMention('a')])
    ])
    expect(r.reads).toEqual(['a'])
    expect(ctx.size).toBe(1)
    expect(ctx.get('note:a')?.body).toBe('甲')
  })

  it('读不到时标 missing 而不是丢掉(丢了模型会以为用户没引用)', async () => {
    const r = reader({})
    const ctx = await resolveNoteContexts(r.read, [userMsg('看这篇', [noteMention('gone', { label: '没了' })])])
    expect(ctx.get('note:gone')).toMatchObject({ missing: true, title: '没了' })
  })

  it('有片段就不读盘(用户选了一段,就是只想说这一段)', async () => {
    const r = reader({ a: { title: 'A', body: '整篇正文' } })
    const ctx = await resolveNoteContexts(r.read, [
      userMsg('看这段', [noteMention('a', { key: 'note:a#sel', quote: '选中的那段' })])
    ])
    expect(r.reads).toEqual([])
    expect(ctx.get('note:a#sel')?.quote).toBe('选中的那段')
  })

  it('标题以磁盘上的为准(引用记录里的 label 只是展示快照)', async () => {
    const r = reader({ a: { title: '改过名的标题', body: 'x' } })
    const ctx = await resolveNoteContexts(r.read, [userMsg('x', [noteMention('a', { label: '旧标题' })])])
    expect(ctx.get('note:a')?.title).toBe('改过名的标题')
  })

  it('agent / cron 引用不参与笔记解析', async () => {
    const r = reader({})
    const ctx = await resolveNoteContexts(r.read, [
      userMsg('x', [{ key: 'agent:1', type: 'agent', id: 'com.foo', label: 'com.foo' }])
    ])
    expect(ctx.size).toBe(0)
    expect(r.reads).toEqual([])
  })
})

describe('mentionContext', () => {
  it('没有引用时返回空串(调用方据此不做任何拼接)', () => {
    expect(mentionContext(undefined, undefined)).toBe('')
    expect(mentionContext([], new Map())).toBe('')
  })

  it('agent / cron 仍是一行标签(本次不改它们的语义)', () => {
    const out = mentionContext(
      [
        { key: 'agent:1', type: 'agent', id: 'a', label: 'com.foo', scope: 'daemon' },
        { key: 'cron:1', type: 'cron', id: 'c', label: '每日备份' }
      ],
      new Map()
    )
    expect(out).toBe('[用户引用了本机任务：com.foo（LaunchAgent · daemon）、每日备份（定时任务）]\n')
  })

  it('笔记正文带标题/id/标签/关联一起注入', async () => {
    const r = reader({ '工作/nginx': { title: 'nginx 排障', body: '8080 被占用', tags: ['ops'] } })
    const msgs = [userMsg('x', [noteMention('工作/nginx')])]
    const ctx = await resolveNoteContexts(r.read, msgs)
    const out = mentionContext(msgs[0].role === 'user' ? msgs[0].mentions : [], ctx)
    expect(out).toContain('笔记「nginx 排障」')
    expect(out).toContain('id=工作/nginx')
    expect(out).toContain('标签:ops')
    expect(out).toContain('8080 被占用')
    expect(out).toContain('—— 笔记结束 ——')
  })

  it('正文里有本地图片时提示模型可以用 read_note_image', async () => {
    const r = reader({ a: { body: '看图 ![](assets/a.png)' } })
    const msgs = [userMsg('x', [noteMention('a')])]
    const ctx = await resolveNoteContexts(r.read, msgs)
    const out = mentionContext(msgs[0].role === 'user' ? msgs[0].mentions : [], ctx)
    expect(out).toContain('read_note_image')
  })

  it('截断的正文要说明只给了前一段', async () => {
    const ctx = new Map([
      ['note:a', { key: 'note:a', id: 'a', title: 'A', tags: [], refs: [], body: '前 64 KiB', truncated: true }]
    ])
    const out = mentionContext([noteMention('a')], ctx)
    expect(out).toContain('仅为前 64 KiB')
  })

  it('缺失的笔记注入一行说明,而不是静默跳过', () => {
    const ctx = new Map([
      ['note:gone', { key: 'note:gone', id: 'gone', title: '没了', tags: [], refs: [], missing: true }]
    ])
    const out = mentionContext([noteMention('gone')], ctx)
    expect(out).toContain('已不存在')
    expect(out).not.toContain('笔记结束')
  })

  it('装不下的整篇不注入(继续试后面的),并列出是哪几篇', () => {
    const big = 'x'.repeat(MAX_NOTE_MENTION_BYTES)
    const ctx = new Map([
      ['note:a', { key: 'note:a', id: 'a', title: 'A', tags: [], refs: [], body: '甲' }],
      ['note:b', { key: 'note:b', id: 'b', title: 'B', tags: [], refs: [], body: big }],
      ['note:c', { key: 'note:c', id: 'c', title: 'C', tags: [], refs: [], body: '丙' }]
    ])
    const out = mentionContext([noteMention('a'), noteMention('b'), noteMention('c')], ctx)
    expect(out).toContain('甲')
    expect(out).not.toContain(big) // 放不下的整篇不注入,不给截一半的正文
    // 跳过 B 之后 C 仍然装得下 —— 一篇撑爆不该把后面的小笔记一起牺牲掉
    expect(out).toContain('丙')
    expect(out).toContain('另有 1 篇因本条消息的引用总量上限未注入：B')
    expect(out).toContain('笔记「B」（id=b）未注入')
  })

  it('ctx 缺失时退回一行标签(旧会话里的引用不该让发送炸掉)', () => {
    const out = mentionContext([noteMention('a', { label: '老引用' })], undefined)
    expect(out).toContain('笔记「老引用」（id=a）')
  })

  it('片段引用只注入片段,不注入整篇', () => {
    const ctx = new Map([
      [
        'note:a#sel',
        { key: 'note:a#sel', id: 'a', title: 'A', tags: [], refs: [], quote: '只这一句' }
      ]
    ])
    const out = mentionContext([noteMention('a', { key: 'note:a#sel', quote: '只这一句' })], ctx)
    expect(out).toContain('只这一句')
    expect(out).toContain('的选中片段')
  })
})

describe('sanitizeMentions', () => {
  it('非数组 / 非法项一律丢弃,不抛', () => {
    expect(sanitizeMentions(undefined)).toEqual([])
    expect(sanitizeMentions('x')).toEqual([])
    expect(sanitizeMentions([null, 1, {}, { type: 'note' }, { type: 'nope', id: 'a' }])).toEqual([])
  })

  it('按 key 去重并截到上限', () => {
    const many = Array.from({ length: MAX_MENTIONS + 5 }, (_, i) => noteMention(`n${i}`))
    expect(sanitizeMentions(many)).toHaveLength(MAX_MENTIONS)
    expect(sanitizeMentions([noteMention('a'), noteMention('a')])).toHaveLength(1)
  })

  it('key 缺失时按 type:id 补,label 缺失时退化成 id', () => {
    const out = sanitizeMentions([{ type: 'note', id: 'a' }])
    expect(out[0]).toEqual({ key: 'note:a', type: 'note', id: 'a', label: 'a' })
  })

  it('片段按 UTF-8 上限截断且不切断多字节字符', () => {
    const quote = '汉'.repeat(MAX_NOTE_QUOTE_BYTES) // 一个字 3 字节,必然超
    const out = sanitizeMentions([{ type: 'note', id: 'a', quote }])
    const got = out[0].quote ?? ''
    expect(Buffer.byteLength(got, 'utf8')).toBeLessThanOrEqual(MAX_NOTE_QUOTE_BYTES)
    expect(got).not.toContain('�')
    expect(got.startsWith('汉')).toBe(true)
  })

  it('空白片段视为没有片段(不注入一个空的「选中片段」块)', () => {
    expect(sanitizeMentions([{ type: 'note', id: 'a', quote: '   ' }])[0].quote).toBeUndefined()
  })

  it('agent 的 scope 只认三个合法值', () => {
    expect(sanitizeMentions([{ type: 'agent', id: 'a', scope: 'user' }])[0].scope).toBe('user')
    expect(sanitizeMentions([{ type: 'agent', id: 'a', scope: 'root' }])[0].scope).toBeUndefined()
  })
})

describe('cutUtf8', () => {
  it('不超限时原样返回', () => {
    expect(cutUtf8('abc', 3)).toEqual({ text: 'abc', cut: false })
  })

  it('超限时退到字符边界', () => {
    // '汉' = 3 字节;给 4 字节只能装下一个字
    expect(cutUtf8('汉汉', 4)).toEqual({ text: '汉', cut: true })
  })
})
