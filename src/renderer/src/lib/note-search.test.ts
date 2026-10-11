import { describe, expect, it } from 'vitest'
import type { NoteMeta } from '@shared/notes'
import { rankByTagHits, tagHitsOf } from './note-search'

function note(id: string, tags: string[] = []): NoteMeta {
  return {
    id,
    title: id,
    created: '2026-10-09T10:00:00+08:00',
    updated: '2026-10-09T10:00:00+08:00',
    tags,
    pinned: false,
    refs: [],
    excerpt: '',
    mtimeMs: 0,
    size: 0,
    frontmatterIssues: [],
    refsUnparsed: false,
    opaque: false
  }
}

describe('tagHitsOf', () => {
  it('空查询不命中任何标签', () => {
    expect(tagHitsOf([note('a', ['事故'])], '').size).toBe(0)
    expect(tagHitsOf([note('a', ['事故'])], '   ').size).toBe(0)
  })

  it('子串命中,不区分大小写', () => {
    const hits = tagHitsOf([note('a', ['Redis'])], 'redi')
    expect(hits.get('a')).toBe('Redis')
  })

  it('长标签也能靠其中一段搜到', () => {
    const hits = tagHitsOf([note('a', ['啊实打实的'])], '实打实')
    expect(hits.get('a')).toBe('啊实打实的')
  })

  it('一篇命中多个标签时只取第一个(行上只需要一个解释)', () => {
    const hits = tagHitsOf([note('a', ['阿达的', '啊大师的'])], '的')
    expect(hits.get('a')).toBe('阿达的')
    expect(hits.size).toBe(1)
  })

  it('没有标签命中就是空表', () => {
    expect(tagHitsOf([note('a', ['事故'])], 'nginx').size).toBe(0)
  })

  it('没有标签的笔记不会命中', () => {
    expect(tagHitsOf([note('a', [])], '任何').size).toBe(0)
  })
})

describe('rankByTagHits', () => {
  it('命中的排到最前,其余保持原顺序', () => {
    const list = [note('x'), note('y', ['事故']), note('z'), note('w', ['事故'])]
    const hits = tagHitsOf(list, '事故')
    expect(rankByTagHits(list, hits).map((n) => n.id)).toEqual(['y', 'w', 'x', 'z'])
  })

  it('组内保持传入顺序(依赖 sort 的稳定性)—— 置顶仍在自己那组里靠前', () => {
    // 传进来的已经是「置顶在前」排好序的
    const list = [note('pinned', ['事故']), note('a', ['事故']), note('b')]
    expect(rankByTagHits(list, tagHitsOf(list, '事故')).map((n) => n.id)).toEqual([
      'pinned',
      'a',
      'b'
    ])
  })

  it('没有任何标签命中时**原样返回**,不做任何重排', () => {
    const list = [note('x'), note('y'), note('z')]
    const out = rankByTagHits(list, new Map())
    expect(out.map((n) => n.id)).toEqual(['x', 'y', 'z'])
    expect(out).toBe(list) // 连数组都不复制
  })

  it('不改原数组', () => {
    const list = [note('x'), note('y', ['事故'])]
    const before = list.map((n) => n.id)
    rankByTagHits(list, tagHitsOf(list, '事故'))
    expect(list.map((n) => n.id)).toEqual(before)
  })
})
