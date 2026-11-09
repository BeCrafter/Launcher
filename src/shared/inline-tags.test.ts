import { describe, expect, it } from 'vitest'
import {
  INLINE_TAG_MAX_LENGTH,
  isValidInlineTag,
  normalizeTag,
  scanInlineTags,
  scanInlineTagsInLine
} from './inline-tags'

describe('isValidInlineTag', () => {
  it.each(['tag', '中文标签', 'project/foo', 'a_b-c', '123abc', '#tag', 'A/B_c-1'])(
    '合法:%s',
    (tag) => expect(isValidInlineTag(tag)).toBe(true)
  )

  it.each(['', '#', '123', '---', '/x', 'tag/', '-tag', 'has space', 'a#b'])(
    '非法:%s',
    (tag) => expect(isValidInlineTag(tag)).toBe(false)
  )

  it('超过长度上限不合法', () => {
    expect(isValidInlineTag('a'.repeat(INLINE_TAG_MAX_LENGTH))).toBe(true)
    expect(isValidInlineTag('a'.repeat(INLINE_TAG_MAX_LENGTH + 1))).toBe(false)
  })

  it('normalizeTag 去 #、统一大小写', () => {
    expect(normalizeTag('#Project/Foo')).toBe('project/foo')
    expect(normalizeTag('TAG')).toBe('tag')
  })
})

describe('scanInlineTagsInLine', () => {
  const tags = (line: string): string[] => scanInlineTagsInLine(line).map((t) => t.tag)

  it('识别正文标签并保留显示大小写', () => {
    expect(tags('前面 #Tag 后面 #中文')).toEqual(['Tag', '中文'])
  })

  it('行首、标点后可以识别;紧贴文字不行', () => {
    expect(tags('#tag')).toEqual(['tag'])
    expect(tags('(#tag)')).toEqual(['tag'])
    expect(tags('foo#bar')).toEqual([])
    expect(tags('中文#标签')).toEqual([])
  })

  it('标题标记与重复井号不算', () => {
    expect(tags('# 标题')).toEqual([])
    expect(tags('##tag')).toEqual([])
    expect(tags('## 关于 #tag')).toEqual(['tag'])
  })

  it('URL、链接地址、自动链接里的 # 不算', () => {
    expect(tags('https://example.com/#frag')).toEqual([])
    expect(tags('[x](note.md#heading)')).toEqual([])
    expect(tags('<https://example.com/#frag>')).toEqual([])
    expect(tags('www.example.com/#frag')).toEqual([])
  })

  it('行内代码、转义、wikilink 里的 # 不算', () => {
    expect(tags('`#code` 和 #real')).toEqual(['real'])
    expect(tags('\\#escaped 和 #real')).toEqual(['real'])
    expect(tags('[[note#heading]] 和 #real')).toEqual(['real'])
  })

  it('纯数字标签不算,带字母数字算', () => {
    expect(tags('#123')).toEqual([])
    expect(tags('#123abc')).toEqual(['123abc'])
  })

  it('返回区间对应原串位置', () => {
    const hit = scanInlineTagsInLine('a #tag b')[0]!
    expect(hit.from).toBe(2)
    expect(hit.to).toBe(6)
    expect('a #tag b'.slice(hit.from, hit.to)).toBe('#tag')
  })
})

describe('scanInlineTags', () => {
  it('跳过围栏代码块(含引用里的围栏与未闭合围栏)', () => {
    const src = ['#yes', '> ```', '> #inside', '> ```', '#yes2', '~~~', '#no2'].join('\n')
    expect(scanInlineTags(src)).toEqual(['yes', 'yes2'])
  })

  it('按规范化 key 去重,保留首次显示大小写', () => {
    expect(scanInlineTags('#Tag #tag #TAG #other')).toEqual(['Tag', 'other'])
  })

  it('达到上限就停止', () => {
    expect(scanInlineTags('#a #b #c #d', 2)).toEqual(['a', 'b'])
  })
})
