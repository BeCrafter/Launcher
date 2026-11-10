import { describe, expect, it } from 'vitest'
import {
  buildWikiOptions,
  COMPLETION_LIMIT,
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
