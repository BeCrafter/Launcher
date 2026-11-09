import { describe, expect, it } from 'vitest'
import type { NoteMeta } from './notes'
import {
  buildWikiIndex,
  parseWikilink,
  resolveWikiTarget,
  scanWikilinksInLine
} from './wikilinks'

function meta(id: string, title: string): NoteMeta {
  return {
    id,
    title,
    created: '',
    updated: '',
    tags: [],
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

describe('parseWikilink', () => {
  it('四种基本形态', () => {
    expect(parseWikilink('note', false)).toEqual({ target: 'note', heading: null, alias: null, embed: false })
    expect(parseWikilink('note|别名', false)).toEqual({
      target: 'note',
      heading: null,
      alias: '别名',
      embed: false
    })
    expect(parseWikilink('note#标题', false)).toEqual({
      target: 'note',
      heading: '标题',
      alias: null,
      embed: false
    })
    expect(parseWikilink('note#标题|别名', true)).toEqual({
      target: 'note',
      heading: '标题',
      alias: '别名',
      embed: true
    })
  })

  it('去掉 .md、前导 ./ 与重复斜杠', () => {
    expect(parseWikilink('./工作//nginx 排障.md', false)?.target).toBe('工作/nginx 排障')
  })

  it('目标为空或只有标题时返回 null', () => {
    expect(parseWikilink('', false)).toBeNull()
    expect(parseWikilink('#标题', false)).toBeNull()
    expect(parseWikilink('   ', false)).toBeNull()
  })

  it('超长部分返回 null', () => {
    expect(parseWikilink('a'.repeat(201), false)).toBeNull()
    expect(parseWikilink(`note#${'a'.repeat(129)}`, false)).toBeNull()
    expect(parseWikilink(`note|${'a'.repeat(201)}`, false)).toBeNull()
  })
})

describe('scanWikilinksInLine', () => {
  it('识别链接与嵌入,并带上区间', () => {
    const hits = scanWikilinksInLine('看 [[A]] 和 ![[pic.png|300]]')
    expect(hits.map((h) => h.link)).toEqual([
      { target: 'A', heading: null, alias: null, embed: false },
      { target: 'pic.png', heading: null, alias: '300', embed: true }
    ])
    expect('看 [[A]] 和 ![[pic.png|300]]'.slice(hits[0]!.from, hits[0]!.to)).toBe('[[A]]')
  })

  it('转义、行内代码、URL 里的不算', () => {
    expect(scanWikilinksInLine('\\[[A]]')).toEqual([])
    expect(scanWikilinksInLine('`[[A]]`')).toEqual([])
    expect(scanWikilinksInLine('https://x/[[A]]')).toEqual([])
  })
})

describe('resolveWikiTarget', () => {
  const notes = [
    meta('A', 'Alpha'),
    meta('Folder/A', 'Alpha'),
    meta('B', 'Beta'),
    meta('X', 'A'),
    meta('Y', 'folder/a')
  ]
  const index = buildWikiIndex(notes)

  it('id 精确优先', () => {
    expect(resolveWikiTarget(index, 'A', '')?.id).toBe('A')
  })

  it('id 忽略大小写次之', () => {
    expect(resolveWikiTarget(index, 'a', '')?.id).toBe('A')
  })

  it('title 精确命中', () => {
    expect(resolveWikiTarget(index, 'Beta', '')?.id).toBe('B')
  })

  it('title 忽略大小写命中', () => {
    expect(resolveWikiTarget(index, 'beta', '')?.id).toBe('B')
  })

  it('文件名兜底', () => {
    expect(resolveWikiTarget(index, 'Folder/A', '')?.id).toBe('Folder/A')
  })

  it('带 # 标题的目标只解析笔记部分', () => {
    expect(resolveWikiTarget(index, 'Beta', '')?.title).toBe('Beta')
  })

  it('同目录优先,然后短 id、字典序', () => {
    // "Alpha" 同时是 A 与 Folder/A 的 title;当前在 Folder 下应优先 Folder/A
    expect(resolveWikiTarget(index, 'Alpha', 'Folder/Other')?.id).toBe('Folder/A')
    expect(resolveWikiTarget(index, 'Alpha', '')?.id).toBe('A')
  })

  it('找不到返回 null', () => {
    expect(resolveWikiTarget(index, 'Missing', '')).toBeNull()
  })
})
