import { describe, expect, it } from 'vitest'
import type { AiAttachment, AiMention, AiUserSegment } from './ai'
import {
  INLINE_CLOSE,
  INLINE_OPEN,
  cutQuery,
  docFromSegments,
  fallbackDoc,
  inlineRefKeys,
  inlineTokenFor,
  mentionQueryAt,
  parseInlineItems,
  sanitizeUserSegments,
  segmentsFromDoc,
  skillIdsOf,
  slashQueryAt,
  stripInlineTokens,
  uniqueSkillIds
} from './ai-inline'

const att = (key: string): AiAttachment => ({
  type: 'text',
  key,
  name: `${key}.md`,
  content: 'x',
  bytes: 1
})

const mention = (key: string): AiMention => ({
  key,
  type: 'note',
  id: key.replace(/^note:/, ''),
  label: key
})

const skillToken = (id: string): string => inlineTokenFor({ kind: 'skill', id })
const attToken = (key: string): string => inlineTokenFor({ kind: 'attachment', key })
const mentionToken = (key: string): string => inlineTokenFor({ kind: 'mention', key })

describe('内联 token', () => {
  it('attachment / mention / skill 往返,key 里的特殊字符被安全编码', () => {
    const doc = `看 ${attToken('a:b/c d')} 和 ${mentionToken('note:工作/日志')} ${skillToken('sk diag')}`
    const items = parseInlineItems(doc)
    expect(items.map((i) => i.kind)).toEqual(['attachment', 'mention', 'skill'])
    expect(items[0]).toMatchObject({ kind: 'attachment', key: 'a:b/c d' })
    expect(items[1]).toMatchObject({ kind: 'mention', key: 'note:工作/日志' })
    expect(items[2]).toMatchObject({ kind: 'skill', id: 'sk diag' })
    const rawToken = doc.slice(items[0]!.start, items[0]!.end)
    expect(rawToken.startsWith(INLINE_OPEN)).toBe(true)
    expect(rawToken.endsWith(INLINE_CLOSE)).toBe(true)
  })

  it('损坏/未知前缀 token 被忽略,不把整段文档吞掉', () => {
    const doc = `${INLINE_OPEN}zzz:foo${INLINE_CLOSE} 正常 ${INLINE_OPEN}%E0%A4%A${INLINE_CLOSE}`
    expect(parseInlineItems(doc)).toEqual([])
  })

  it('stripInlineTokens 用空格替换 chip,并收敛连续空白', () => {
    expect(stripInlineTokens(`  ${attToken('a')}  看  ${mentionToken('note:n')}   日志  `)).toBe(
      '看 日志'
    )
    expect(stripInlineTokens(`a${attToken('a')}b`)).toBe('a b')
  })

  it('inlineRefKeys 按视觉顺序去重,技能可以多个', () => {
    const doc = `${mentionToken('note:a')} ${attToken('t1')} ${attToken('t1')} ${skillToken('sk-a')} ${skillToken('sk-b')} ${skillToken('sk-a')}`
    expect(inlineRefKeys(doc)).toEqual({
      attachments: ['t1'],
      mentions: ['note:a'],
      skillIds: ['sk-a', 'sk-b']
    })
  })

  it('技能 id 归一化:去空、去重、保留首次出现顺序', () => {
    expect(uniqueSkillIds([' sk-a ', '', 42, 'sk-b', 'sk-a', null])).toEqual(['sk-a', 'sk-b'])
    expect(uniqueSkillIds([])).toEqual([])
  })

  it('skillIdsOf 同时读新旧字段,新字段顺序优先并去重', () => {
    expect(skillIdsOf({ skillIds: ['sk-b', 'sk-a'], skillId: 'sk-a' })).toEqual(['sk-b', 'sk-a'])
    expect(skillIdsOf({ skillId: 'sk-a' })).toEqual(['sk-a'])
    expect(skillIdsOf({ skillIds: 'not-array', skillId: 'sk-a' })).toEqual(['sk-a'])
    expect(skillIdsOf({})).toEqual([])
  })
})

describe('内联分段', () => {
  it('文字与引用按原位置交错', () => {
    const doc = `先看 ${attToken('t1')} 再看 ${mentionToken('note:a')} 完`
    expect(segmentsFromDoc(doc)).toEqual([
      { type: 'text', text: '先看 ' },
      { type: 'ref', refType: 'attachment', key: 't1' },
      { type: 'text', text: ' 再看 ' },
      { type: 'ref', refType: 'mention', key: 'note:a' },
      { type: 'text', text: ' 完' }
    ])
  })

  it('重复引用只保留第一次(与 main 的 sanitize 口径一致)', () => {
    const segs = segmentsFromDoc(`${attToken('t1')} 中 ${attToken('t1')}`)
    expect(segs.filter((s) => s.type === 'ref')).toEqual([
      { type: 'ref', refType: 'attachment', key: 't1' }
    ])
  })

  it('多个技能按视觉顺序保留,同一技能重复只保留第一次', () => {
    const doc = `${skillToken('sk-a')} 看 ${skillToken('sk-b')} 和 ${skillToken('sk-a')}`
    expect(segmentsFromDoc(doc)).toEqual([
      { type: 'skill', id: 'sk-a' },
      { type: 'text', text: ' 看 ' },
      { type: 'skill', id: 'sk-b' },
      { type: 'text', text: ' 和 ' }
    ])
  })

  it('docFromSegments 与 segmentsFromDoc 互逆(纯 ref/文字文档)', () => {
    const doc = `A ${attToken('t1')} B ${mentionToken('note:x')}`
    expect(docFromSegments(segmentsFromDoc(doc))).toBe(doc)
  })

  it('纯文字文档不产生分段(避免每条消息都存一份重复正文)', () => {
    expect(segmentsFromDoc('只是文字')).toEqual([])
  })

  it('legacy fallback:正文在前,技能/附件/引用按顺序追加', () => {
    const doc = fallbackDoc(
      '正文',
      [{ ...att('late'), order: 20 } as AiAttachment],
      [{ ...mention('note:early'), order: 10 }],
      ['sk-diag', 'sk-plist', 'sk-diag']
    )
    expect(doc.indexOf('正文')).toBe(0)
    expect(doc.indexOf(skillToken('sk-diag'))).toBeGreaterThan(doc.indexOf('正文'))
    expect(doc.indexOf(skillToken('sk-diag'))).toBeLessThan(doc.indexOf(skillToken('sk-plist')))
    // 重复的技能 id 只写一次
    expect(doc.split(skillToken('sk-diag')).length - 1).toBe(1)
    expect(doc.indexOf(mentionToken('note:early'))).toBeLessThan(
      doc.indexOf(attToken('late'))
    )
  })
})

describe('触发词', () => {
  it('@ 查询要求同一行且不超过上限', () => {
    expect(mentionQueryAt('帮我 @笔记', 7)).toEqual({ start: 3, query: '笔记' })
    expect(mentionQueryAt('a@b c', 4)).toBeNull()
    expect(mentionQueryAt('@' + 'x'.repeat(81), 82)).toBeNull()
    expect(mentionQueryAt('没有触发词', 5)).toBeNull()
  })

  it('/ 在行首、空白后、中文/全角标点后与 chip 后触发,路径/URL 不误触', () => {
    expect(slashQueryAt('/diag', 5)).toEqual({ start: 0, query: 'diag', boundary: 'line' })
    expect(slashQueryAt('看 /di', 5)).toEqual({ start: 2, query: 'di', boundary: 'space' })
    // 中文没有词间空格:「总结一下/」才是最自然的写法
    expect(slashQueryAt('总结一下/', 5)).toEqual({ start: 4, query: '', boundary: 'cjk' })
    expect(slashQueryAt('总结一下/诊断', 7)).toEqual({ start: 4, query: '诊断', boundary: 'cjk' })
    // 全角标点之后同理
    expect(slashQueryAt('看看，/diag', 8)).toEqual({ start: 3, query: 'diag', boundary: 'cjk' })
    // chip 是独立的块,紧跟其后的 `/` 是新命令
    const chipDoc = `看${attToken('a')}/di`
    expect(slashQueryAt(chipDoc, chipDoc.length)).toEqual({
      start: 1 + attToken('a').length,
      query: 'di',
      boundary: 'chip'
    })
    // 路径、URL、相对路径与英文单词里的斜线都不能触发
    expect(slashQueryAt('/usr/bin', 8)).toBeNull()
    expect(slashQueryAt('https://a/b', 11)).toBeNull()
    expect(slashQueryAt('x/foo', 5)).toBeNull()
    expect(slashQueryAt('./run.sh', 8)).toBeNull()
    expect(slashQueryAt('1/2 杯', 3)).toBeNull()
  })

  it('cutQuery 删掉触发符到光标,保留后面的文字', () => {
    expect(cutQuery('前 /diag 后', { start: 2, query: 'diag' }, 7)).toEqual({
      doc: '前  后',
      pos: 2
    })
  })
})

describe('sanitizeUserSegments', () => {
  const attachments = [att('t1')]
  const mentions = [mention('note:a')]

  it('丢弃不存在的引用、重复引用和未选中的技能;多个技能按顺序保留', () => {
    const raw: AiUserSegment[] = [
      { type: 'text', text: '看 ' },
      { type: 'ref', refType: 'attachment', key: 't1' },
      { type: 'ref', refType: 'attachment', key: 't1' },
      { type: 'ref', refType: 'attachment', key: 'nope' },
      { type: 'ref', refType: 'mention', key: 'note:a' },
      { type: 'ref', refType: 'mention', key: 'note:nope' },
      { type: 'skill', id: 'sk-wrong' },
      { type: 'skill', id: 'sk-ok' },
      { type: 'skill', id: 'sk-two' },
      { type: 'skill', id: 'sk-ok' }
    ]
    expect(sanitizeUserSegments(raw, attachments, mentions, ['sk-ok', 'sk-two'])).toEqual([
      { type: 'text', text: '看 ' },
      { type: 'ref', refType: 'attachment', key: 't1' },
      { type: 'ref', refType: 'mention', key: 'note:a' },
      { type: 'skill', id: 'sk-ok' },
      { type: 'skill', id: 'sk-two' }
    ])
  })

  it('只有文字时返回空数组:纯文本消息不额外落一份分段', () => {
    expect(
      sanitizeUserSegments([{ type: 'text', text: 'hello' }], attachments, mentions)
    ).toEqual([])
  })

  it('非数组/非法项安全返回空数组', () => {
    expect(sanitizeUserSegments(undefined, attachments, mentions)).toEqual([])
    expect(sanitizeUserSegments([null, 42, 'x'], attachments, mentions)).toEqual([])
  })
})
