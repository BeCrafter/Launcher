import { describe, expect, it } from 'vitest'
import {
  buildTagOptions,
  buildWikiOptions,
  COMPLETION_LIMIT,
  tagTriggerAt,
  wikiTriggerAt,
  type WikiTarget
} from './note-completions'

describe('wikiTriggerAt', () => {
  it('识别 [[ 与 ![[,from 落在查询词的第一个字符', () => {
    expect(wikiTriggerAt('see [[Be', 8)).toEqual({ from: 6, query: 'Be' })
    expect(wikiTriggerAt('![[fo', 5)).toEqual({ from: 3, query: 'fo' })
    expect(wikiTriggerAt('[[', 2)).toEqual({ from: 2, query: '' })
  })

  it('已闭合 / 带别名 / 带标题 / 其它行内方括号都不触发', () => {
    expect(wikiTriggerAt('[[done]]', 8)).toBeNull()
    expect(wikiTriggerAt('[[a|b', 5)).toBeNull()
    expect(wikiTriggerAt('[[a#b', 5)).toBeNull()
    expect(wikiTriggerAt('[x', 2)).toBeNull()
    expect(wikiTriggerAt('plain', 5)).toBeNull()
  })

  it('光标不在行尾时只看光标之前', () => {
    expect(wikiTriggerAt('[[Beta]] tail', 6)).toEqual({ from: 2, query: 'Beta' })
  })
})

describe('tagTriggerAt', () => {
  it('要求 # 后至少一个字符,from 落在标签名开头', () => {
    expect(tagTriggerAt('x #al', 5)).toEqual({ from: 3, query: 'al' })
    expect(tagTriggerAt('#al', 3)).toEqual({ from: 1, query: 'al' })
    expect(tagTriggerAt('# 标题', 4)).toBeNull()
    expect(tagTriggerAt('#', 1)).toBeNull()
  })

  it('URL 片段 / 词内 / 连续 # / 转义都不算标签', () => {
    expect(tagTriggerAt('https://x/#frag', 15)).toBeNull()
    expect(tagTriggerAt('foo#bar', 7)).toBeNull()
    expect(tagTriggerAt('##tag', 5)).toBeNull()
    expect(tagTriggerAt('\\#tag', 5)).toBeNull()
  })

  it('中文标签可用', () => {
    expect(tagTriggerAt('见 #笔记/子', 8)).toEqual({ from: 3, query: '笔记/子' })
  })
})

const targets: WikiTarget[] = [
  { id: 'work/Beta', title: 'Beta' },
  { id: 'life/Beta', title: 'Beta' },
  { id: 'Alpha', title: 'Alpha' },
  { id: 'logs/alpha-notes', title: 'alpha-notes' },
  { id: 'bad#title', title: 'bad#title' },
  { id: 'pipe', title: 'a|b' }
]

describe('buildWikiOptions', () => {
  it('重名标题用 id 消歧,唯一标题直接写标题', () => {
    const beta = buildWikiOptions(targets, 'be')
    expect(beta).toHaveLength(2)
    expect(beta.map((o) => o.apply)).toEqual(['life/Beta|Beta]]', 'work/Beta|Beta]]'])

    const alpha = buildWikiOptions(targets, 'Alph').find((o) => o.label === 'Alpha')
    expect(alpha?.apply).toBe('Alpha]]')
  })

  it('前缀匹配排在中间匹配之前', () => {
    const opts = buildWikiOptions(targets, 'alpha')
    expect(opts.map((o) => o.label)).toEqual(['Alpha', 'alpha-notes'])
  })

  it('标题里带 [[ | # 的候选没法写进链接,直接跳过', () => {
    expect(buildWikiOptions(targets, 'bad')).toEqual([])
    expect(buildWikiOptions(targets, 'a|b')).toEqual([])
  })

  it('空查询列出全部(受上限约束),detail 只在能补充信息时出现', () => {
    const opts = buildWikiOptions(targets, '', 3)
    expect(opts).toHaveLength(3)
    expect(buildWikiOptions([{ id: 'dir/Solo', title: 'Solo' }], '')[0]!.detail).toBe('dir')
    // 根层且 id 与标题相同 → detail 只是重复,不显示
    expect(buildWikiOptions([{ id: 'Solo', title: 'Solo' }], '')[0]!.detail).toBeUndefined()
    expect(COMPLETION_LIMIT).toBe(50)
  })
})

describe('buildTagOptions', () => {
  const tags = ['alpha', 'Alpha', 'beta', '123', 'note/sub', '-bad', 'x']

  it('大小写无关去重,保留首次写法', () => {
    const opts = buildTagOptions(tags, 'al')
    expect(opts.map((o) => o.label)).toEqual(['#alpha'])
    expect(opts[0]!.apply).toBe('#alpha')
  })

  it('只收合法标签(纯数字 / 首尾分隔符不行)', () => {
    const labels = buildTagOptions(tags, '').map((o) => o.label)
    expect(labels).toContain('#note/sub')
    expect(labels).not.toContain('#123')
    expect(labels).not.toContain('#-bad')
  })

  it('前缀匹配优先,再按名称排序,受上限约束', () => {
    const labels = buildTagOptions(tags, 'a').map((o) => o.label)
    // alpha 前缀命中;beta 不在前缀位但包含 a
    expect(labels[0]).toBe('#alpha')
    expect(labels).toContain('#beta')
    expect(buildTagOptions(tags, '', 2)).toHaveLength(2)
  })
})
