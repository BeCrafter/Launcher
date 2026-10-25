import { describe, expect, it } from 'vitest'
import { MAX_TEXT_ATTACHMENT_BYTES } from '@shared/ai'
import {
  ATTACHMENT_BINARY,
  ATTACHMENT_TEXT_ENCODING,
  formatAttachmentBytes,
  isSupportedImageFile,
  isSupportedTextFile,
  makeAttachmentKey,
  readTextAttachment
} from './ai-attachment'

const file = (name: string, type = '', content: BlobPart[] = ['x']): File =>
  new File(content, name, { type })

describe('附件类型判定', () => {
  it('图片按 MIME 或空 MIME + 扩展名识别,SVG 永远不支持', () => {
    expect(isSupportedImageFile(file('a.png', 'image/png'))).toBe(true)
    expect(isSupportedImageFile(file('a.jpg', ''))).toBe(true)
    expect(isSupportedImageFile(file('a.svg', 'image/svg+xml'))).toBe(false)
    expect(isSupportedImageFile(file('a.txt', 'text/plain'))).toBe(false)
  })

  it('文本按扩展名或 MIME 识别', () => {
    expect(isSupportedTextFile(file('a.md', ''))).toBe(true)
    expect(isSupportedTextFile(file('a.log', 'application/octet-stream'))).toBe(true)
    expect(isSupportedTextFile(file('a.txt', 'text/plain'))).toBe(true)
    expect(isSupportedTextFile(file('a.png', 'image/png'))).toBe(false)
    expect(isSupportedTextFile(file('a.exe', ''))).toBe(false)
  })
})

describe('makeAttachmentKey', () => {
  it('生成不重复的 key', () => {
    const keys = new Set(Array.from({ length: 100 }, () => makeAttachmentKey('img')))
    expect(keys.size).toBe(100)
    expect([...keys][0]).toMatch(/^img-/)
  })
})

describe('formatAttachmentBytes', () => {
  it('按 B/KB/MB 收敛为简短文案', () => {
    expect(formatAttachmentBytes(0)).toBe('0 B')
    expect(formatAttachmentBytes(512)).toBe('512 B')
    expect(formatAttachmentBytes(1024)).toBe('1 KB')
    expect(formatAttachmentBytes(1536)).toBe('1.5 KB')
    expect(formatAttachmentBytes(10 * 1024)).toBe('10 KB')
    expect(formatAttachmentBytes(32 * 1024)).toBe('32 KB')
    expect(formatAttachmentBytes(1024 * 1024)).toBe('1 MB')
  })
})

describe('readTextAttachment', () => {
  it('读取 UTF-8 文本并计算字节数', async () => {
    const att = await readTextAttachment(file('notes.md', '', ['你好\nworld']))
    expect(att).toMatchObject({ type: 'text', name: 'notes.md', content: '你好\nworld', bytes: 12 })
    expect(att.truncated).toBeUndefined()
  })

  it('超过上限时按 UTF-8 边界截断', async () => {
    const att = await readTextAttachment(
      file('big.log', '', ['你'.repeat(MAX_TEXT_ATTACHMENT_BYTES)])
    )
    expect(att.truncated).toBe(true)
    expect(att.bytes).toBeLessThanOrEqual(MAX_TEXT_ATTACHMENT_BYTES)
    expect(att.bytes % 3).toBe(0)
    expect(att.content).not.toContain('�')
  })

  it('拒绝 UTF-16 BOM', async () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x61, 0x00])
    await expect(readTextAttachment(file('utf16.txt', '', [bytes]))).rejects.toThrow(
      ATTACHMENT_TEXT_ENCODING
    )
  })

  it('拒绝 NUL 占比过高的二进制', async () => {
    const bytes = new Uint8Array(100)
    await expect(readTextAttachment(file('binary.txt', '', [bytes]))).rejects.toThrow(
      ATTACHMENT_BINARY
    )
  })
})
