import { describe, expect, it } from 'vitest'
import type { NoteMeta } from '@shared/notes'
import { aggregateTags, filterNotesByTag, noteHasTag, noteTagsOf } from './note-tags'

function meta(id: string, tags: string[] = [], inlineTags?: string[]): NoteMeta {
  return {
    id,
    title: id,
    created: '',
    updated: '',
    tags,
    inlineTags,
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

describe('noteTagsOf', () => {
  it('合并 frontmatter 与正文标签,按大小写不敏感去重且保留首次大小写', () => {
    expect(noteTagsOf(meta('a', ['Tag', 'fm'], ['tag', 'inline']))).toEqual(['Tag', 'fm', 'inline'])
  })

  it('空标签被忽略', () => {
    expect(noteTagsOf(meta('a', ['', '  '], ['']))).toEqual([])
  })
})

describe('noteHasTag', () => {
  it('精确、大小写不敏感', () => {
    const n = meta('a', ['Project/Foo'], ['inline'])
    expect(noteHasTag(n, 'project/foo')).toBe(true)
    expect(noteHasTag(n, 'inline')).toBe(true)
    expect(noteHasTag(n, 'project')).toBe(false)
  })
})

describe('aggregateTags', () => {
  it('计数是笔记数,不是出现次数', () => {
    const list = [meta('a', ['x'], ['x']), meta('b', [], ['x']), meta('c', ['y'])]
    expect(aggregateTags(list)).toEqual([
      { key: 'x', tag: 'x', count: 2 },
      { key: 'y', tag: 'y', count: 1 }
    ])
  })

  it('按笔记数降序,同数按标签名排序', () => {
    const list = [meta('a', ['b']), meta('b', ['b']), meta('c', ['a']), meta('d', ['c'])]
    expect(aggregateTags(list).map((t) => t.tag)).toEqual(['b', 'a', 'c'])
  })

  it('保留首次出现的显示大小写,比较用小写 key', () => {
    const list = [meta('a', ['Redis']), meta('b', [], ['redis'])]
    expect(aggregateTags(list)).toEqual([{ key: 'redis', tag: 'Redis', count: 2 }])
  })

  it('上限生效', () => {
    expect(aggregateTags([meta('a', ['a', 'b', 'c'])], 2)).toHaveLength(2)
  })
})

describe('filterNotesByTag', () => {
  it('null 原样返回;否则按规范化 key 精确过滤', () => {
    const list = [meta('a', ['X']), meta('b', ['y']), meta('c', [], ['x'])]
    expect(filterNotesByTag(list, null)).toBe(list)
    expect(filterNotesByTag(list, 'x').map((n) => n.id)).toEqual(['a', 'c'])
  })
})
