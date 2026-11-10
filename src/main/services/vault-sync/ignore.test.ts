import { describe, expect, it } from 'vitest'
import { compileIgnore, DEFAULT_SYNC_IGNORE } from './ignore'

describe('compileIgnore', () => {
  const ignore = compileIgnore(DEFAULT_SYNC_IGNORE)

  it('默认规则命中点号名与临时文件,不命中正文与附件', () => {
    expect(ignore.ignores('.obsidian', true)).toBe(true)
    expect(ignore.ignores('.obsidian/workspace.json', false)).toBe(true)
    expect(ignore.ignores('.DS_Store', false)).toBe(true)
    expect(ignore.ignores('.trash', true)).toBe(true)
    expect(ignore.ignores('笔记.md.tmp', false)).toBe(true)
    expect(ignore.ignores('a/b.md.tmp', false)).toBe(true)
    expect(ignore.ignores('assets', true)).toBe(false)
    expect(ignore.ignores('assets/Pasted image.png', false)).toBe(false)
    expect(ignore.ignores('笔记.md', false)).toBe(false)
  })

  it('末尾 / 只命中目录,其下整棵跳过', () => {
    const m = compileIgnore('cache/')
    expect(m.ignores('cache', true)).toBe(true)
    expect(m.ignores('cache', false)).toBe(false)
    expect(m.ignores('cache/a.txt', false)).toBe(true)
  })

  it('前导 / 只匹配根', () => {
    const m = compileIgnore('/secret.md')
    expect(m.ignores('secret.md', false)).toBe(true)
    expect(m.ignores('dir/secret.md', false)).toBe(false)
  })

  it('空规则不排除任何文件', () => {
    const m = compileIgnore('')
    expect(m.ignores('.obsidian', true)).toBe(false)
    expect(m.ignores('笔记.md.tmp', false)).toBe(false)
  })

  it('非法行跳过,不让整份失效', () => {
    const m = compileIgnore('**/*.md\n!keep.md\n*.log')
    expect(m.ignores('a/b.md', false)).toBe(false)
    expect(m.ignores('keep.md', false)).toBe(false)
    expect(m.ignores('a.log', false)).toBe(true)
  })

  it('# 注释与空行忽略', () => {
    const m = compileIgnore('# 说明\n\n*.bak\n')
    expect(m.ignores('说明', false)).toBe(false)
    expect(m.ignores('a.bak', false)).toBe(true)
  })
})
