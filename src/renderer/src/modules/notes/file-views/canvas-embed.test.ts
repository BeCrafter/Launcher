import { describe, expect, it } from 'vitest'
import { noteFileUrl } from '../../../lib/note-file-url'
import {
  canvasEmbedAllowed,
  canvasEmbedTarget,
  canvasNoteLink,
  canvasWebLink
} from './canvas-embed'

describe('canvas embed links', () => {
  it('笔记 id 带中文、空格和目录也能原样取回', () => {
    const id = '资料/我的 笔记'
    const link = canvasNoteLink(id)
    expect(link.startsWith('note:')).toBe(true)
    expect(link.includes(' ')).toBe(false)
    expect(canvasEmbedTarget(link)).toEqual({ kind: 'note', id })
    expect(canvasEmbedAllowed(link)).toBe(true)
  })

  it('库内文件走 launcher-note 协议,带缓存版本也能取回路径', () => {
    const link = noteFileUrl('图/a b.png', 7)
    expect(canvasEmbedTarget(link)).toEqual({ kind: 'file', path: '图/a b.png' })
    expect(canvasEmbedAllowed(link)).toBe(true)
  })

  it('http 与 https 原样取回,首尾空白去掉,不改写地址', () => {
    expect(canvasEmbedTarget('https://example.com/a')).toEqual({
      kind: 'web',
      url: 'https://example.com/a'
    })
    expect(canvasWebLink('  http://example.com/a  ')).toBe('http://example.com/a')
    expect(canvasEmbedTarget('  https://example.com/a b ')).toEqual({
      kind: 'web',
      url: 'https://example.com/a b'
    })
    expect(canvasEmbedAllowed('https://example.com/a')).toBe(true)
  })

  it('空链接、非 http 地址和解不开的编码都不放行', () => {
    expect(canvasEmbedTarget('note:')).toBeNull()
    expect(canvasEmbedTarget(null)).toBeNull()
    expect(canvasEmbedTarget('note:%E0%A4%A')).toBeNull()
    expect(canvasWebLink('javascript:alert(1)')).toBeNull()
    expect(canvasEmbedTarget('javascript:alert(1)')).toBeNull()
    expect(canvasEmbedTarget('data:text/html,hi')).toBeNull()
    expect(canvasEmbedTarget('file:///etc/passwd')).toBeNull()
    expect(canvasWebLink('https://')).toBeNull()
    expect(canvasEmbedTarget('https://')).toBeNull()
    expect(canvasEmbedAllowed('javascript:alert(1)')).toBe(false)
  })
})
