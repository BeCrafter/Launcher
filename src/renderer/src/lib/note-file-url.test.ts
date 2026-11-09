import { describe, expect, it } from 'vitest'
import { noteFileRelFromUrl, noteFileUrl } from './note-file-url'

describe('noteFileUrl', () => {
  it('逐段编码,保留 / 分隔', () => {
    expect(noteFileUrl('dir/sub/a.txt')).toBe('launcher-note://file/dir/sub/a.txt')
  })

  it('空格 / 中文 / # / ? 都编码进路径', () => {
    expect(noteFileUrl('我的 笔记/a#b?c.md')).toBe(
      'launcher-note://file/%E6%88%91%E7%9A%84%20%E7%AC%94%E8%AE%B0/a%23b%3Fc.md'
    )
  })

  it('查询串只做版本号', () => {
    expect(noteFileUrl('a.html', 7)).toBe('launcher-note://file/a.html?v=7')
    expect(noteFileUrl('a.html', 'abc')).toBe('launcher-note://file/a.html?v=abc')
  })
})

describe('noteFileRelFromUrl', () => {
  it('还原相对路径,忽略查询串', () => {
    expect(noteFileRelFromUrl('launcher-note://file/dir/a%20b.md?v=3')).toBe('dir/a b.md')
    expect(noteFileRelFromUrl(noteFileUrl('中文/文件.txt'))).toBe('中文/文件.txt')
  })

  it('不是 file host 或编码损坏返回 null', () => {
    expect(noteFileRelFromUrl('launcher-note://asset/x.png')).toBeNull()
    expect(noteFileRelFromUrl('https://example.com/a')).toBeNull()
    expect(noteFileRelFromUrl('launcher-note://file/%E0%A4%A')).toBeNull()
  })
})
