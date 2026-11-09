import { describe, expect, it } from 'vitest'
import { decodeTextBytes, encodeTextBytes, normalizeEol } from './text-file'

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
const bytes = (...parts: (number[] | Uint8Array)[]): Uint8Array => {
  const flat: number[] = []
  for (const p of parts) flat.push(...p)
  return new Uint8Array(flat)
}
const utf16 = (s: string, littleEndian: boolean): Uint8Array => {
  const out = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out[i * 2] = littleEndian ? c & 0xff : c >> 8
    out[i * 2 + 1] = littleEndian ? c >> 8 : c & 0xff
  }
  return out
}

describe('decodeTextBytes', () => {
  it('空文件 → 空 UTF-8 文本', () => {
    expect(decodeTextBytes(new Uint8Array())).toEqual({
      ok: true,
      decoded: { text: '', encoding: 'utf8', eol: '\n' }
    })
  })

  it('无 BOM 的 UTF-8,CRLF 归一并记录', () => {
    const r = decodeTextBytes(utf8('a\r\nb\r\n'))
    expect(r).toEqual({
      ok: true,
      decoded: { text: 'a\nb\n', encoding: 'utf8', eol: '\r\n' }
    })
  })

  it('UTF-8 BOM 被剥掉但保留标记', () => {
    const r = decodeTextBytes(bytes([0xef, 0xbb, 0xbf], utf8('你好')))
    expect(r).toMatchObject({
      ok: true,
      decoded: { text: '你好', encoding: 'utf8-bom', eol: '\n' }
    })
  })

  it('UTF-16LE / UTF-16BE BOM', () => {
    expect(decodeTextBytes(bytes([0xff, 0xfe], utf16('你好\n', true)))).toMatchObject({
      ok: true,
      decoded: { text: '你好\n', encoding: 'utf16le' }
    })
    expect(decodeTextBytes(bytes([0xfe, 0xff], utf16('你好\n', false)))).toMatchObject({
      ok: true,
      decoded: { text: '你好\n', encoding: 'utf16be' }
    })
  })

  it('UTF-32LE 的 BOM 不当作 UTF-16', () => {
    expect(decodeTextBytes(bytes([0xff, 0xfe, 0x00, 0x00], [0x41, 0, 0, 0]))).toEqual({
      ok: false,
      reason: 'unsupported-encoding'
    })
  })

  it('开头含 NUL → binary', () => {
    expect(decodeTextBytes(bytes([0x41, 0x00, 0x42]))).toEqual({ ok: false, reason: 'binary' })
  })

  it('非法 UTF-8 → unsupported-encoding(不猜编码)', () => {
    expect(decodeTextBytes(bytes([0x41, 0xff, 0xfe, 0x42]))).toEqual({
      ok: false,
      reason: 'unsupported-encoding'
    })
  })

  it('BOM 的 UTF-8 里出现 NUL 也按 binary', () => {
    expect(decodeTextBytes(bytes([0xef, 0xbb, 0xbf, 0x41, 0x00]))).toEqual({
      ok: false,
      reason: 'binary'
    })
  })
})

describe('encodeTextBytes', () => {
  it('往返守恒:UTF-8 / BOM / UTF-16 × LF / CRLF', () => {
    const cases = [
      { encoding: 'utf8', eol: '\n', raw: utf8('a\nb\n') },
      { encoding: 'utf8-bom', eol: '\r\n', raw: bytes([0xef, 0xbb, 0xbf], utf8('a\r\nb\r\n')) },
      { encoding: 'utf16le', eol: '\n', raw: bytes([0xff, 0xfe], utf16('a\nb\n', true)) },
      { encoding: 'utf16be', eol: '\r\n', raw: bytes([0xfe, 0xff], utf16('a\r\nb\r\n', false)) }
    ] as const
    for (const c of cases) {
      const decoded = decodeTextBytes(c.raw)
      expect(decoded.ok).toBe(true)
      if (!decoded.ok) continue
      expect(decoded.decoded.encoding).toBe(c.encoding)
      expect(decoded.decoded.eol).toBe(c.eol)
      expect(Array.from(encodeTextBytes(decoded.decoded.encoding, decoded.decoded.eol, decoded.decoded.text))).toEqual(
        Array.from(c.raw)
      )
    }
  })

  it('编辑后的 CRLF 文本会被归一,再按原 EOL 写回', () => {
    const out = encodeTextBytes('utf8', '\r\n', 'a\r\nb\nc\r\n')
    expect(new TextDecoder().decode(out)).toBe('a\r\nb\r\nc\r\n')
  })

  it('UTF-16 保留代理对', () => {
    const out = encodeTextBytes('utf16le', '\n', '😀')
    expect(decodeTextBytes(out)).toMatchObject({ ok: true, decoded: { text: '😀' } })
  })
})

describe('normalizeEol', () => {
  it('CRLF 与单独 CR 都变成 LF', () => {
    expect(normalizeEol('a\r\nb\rc')).toBe('a\nb\nc')
  })
})
