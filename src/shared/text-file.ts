// 文本文件的编码探测与还原(Node 与浏览器共用)。
//
// 只认三种确定能无损往返的写法:UTF-8(可带 BOM)、UTF-16LE/BE(带 BOM)。
// 其它编码(GBK、Latin-1、无 BOM 的 UTF-16…)一律当二进制占位 —— 猜错编码再保存
// 会永久改写用户的文件,比不支持更糟。
//
// 运行期文本统一以 LF 归一(CodeMirror 的文档模型就是这么处理的);
// 原文件的 EOL 记在 `eol` 里,保存时还原。

import type { NoteFileTextEncoding } from './notes'

export interface DecodedTextFile {
  /** LF 归一后的正文 */
  text: string
  encoding: NoteFileTextEncoding
  eol: '\n' | '\r\n'
}

export type TextDecodeFailure = 'binary' | 'unsupported-encoding'

export type TextDecodeResult =
  | { ok: true; decoded: DecodedTextFile }
  | { ok: false; reason: TextDecodeFailure }

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const
const UTF16LE_BOM = [0xff, 0xfe] as const
const UTF16BE_BOM = [0xfe, 0xff] as const

/** NUL 只在文件开头一段里找:中段出现 NUL 的文本本来就不是可编辑文本 */
const SNIFF_BYTES = 8192

function startsWith(bytes: Uint8Array, sig: readonly number[]): boolean {
  if (bytes.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false
  return true
}

function hasNul(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, SNIFF_BYTES)
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true
  return false
}

export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  // 奇数长度:丢掉最后一个不完整码元(截断的文件仍可编辑,不能因此整份拒绝)
  const len = bytes.length - (bytes.length % 2)
  const buf = new Uint8Array(len)
  if (littleEndian) {
    buf.set(bytes.subarray(0, len))
  } else {
    for (let i = 0; i < len; i += 2) {
      buf[i] = bytes[i + 1]
      buf[i + 1] = bytes[i]
    }
  }
  return new TextDecoder('utf-16le').decode(buf)
}

function encodeUtf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (littleEndian) {
      out[i * 2] = code & 0xff
      out[i * 2 + 1] = code >> 8
    } else {
      out[i * 2] = code >> 8
      out[i * 2 + 1] = code & 0xff
    }
  }
  return out
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/**
 * 原始字节 → 可编辑文本。失败时只回原因,不抛异常:
 * 调用方要据此把文件当二进制占位,**不能**把解码失败的字节猜成乱码文本。
 */
export function decodeTextBytes(bytes: Uint8Array): TextDecodeResult {
  if (bytes.length === 0) return { ok: true, decoded: { text: '', encoding: 'utf8', eol: '\n' } }

  if (startsWith(bytes, UTF8_BOM)) {
    if (hasNul(bytes)) return { ok: false, reason: 'binary' }
    const body = bytes.subarray(UTF8_BOM.length)
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(body)
      return {
        ok: true,
        decoded: { text: normalizeEol(text), encoding: 'utf8-bom', eol: eolOf(text) }
      }
    } catch {
      return { ok: false, reason: 'unsupported-encoding' }
    }
  }

  if (startsWith(bytes, UTF16LE_BOM)) {
    // FF FE 00 00 是 UTF-32LE 的 BOM:本应用不支持,按二进制占位
    if (bytes.length >= 4 && bytes[2] === 0 && bytes[3] === 0) {
      return { ok: false, reason: 'unsupported-encoding' }
    }
    const text = decodeUtf16(bytes.subarray(2), true)
    return {
      ok: true,
      decoded: { text: normalizeEol(text), encoding: 'utf16le', eol: eolOf(text) }
    }
  }

  if (startsWith(bytes, UTF16BE_BOM)) {
    const text = decodeUtf16(bytes.subarray(2), false)
    return {
      ok: true,
      decoded: { text: normalizeEol(text), encoding: 'utf16be', eol: eolOf(text) }
    }
  }

  // 无 BOM:开头有 NUL 基本就是二进制(UTF-16 无 BOM 也走这里,刻意不猜)
  if (hasNul(bytes)) return { ok: false, reason: 'binary' }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, reason: 'unsupported-encoding' }
  }
  return { ok: true, decoded: { text: normalizeEol(text), encoding: 'utf8', eol: eolOf(text) } }
}

function eolOf(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/** 编辑后的 LF 文本 → 按原编码 / BOM / EOL 还原的字节 */
export function encodeTextBytes(
  encoding: NoteFileTextEncoding,
  eol: '\n' | '\r\n',
  text: string
): Uint8Array {
  const normalized = normalizeEol(text)
  const body = eol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized
  switch (encoding) {
    case 'utf8-bom':
      return concatBytes(new Uint8Array(UTF8_BOM), new TextEncoder().encode(body))
    case 'utf16le':
      return concatBytes(new Uint8Array(UTF16LE_BOM), encodeUtf16(body, true))
    case 'utf16be':
      return concatBytes(new Uint8Array(UTF16BE_BOM), encodeUtf16(body, false))
    case 'utf8':
    default:
      return new TextEncoder().encode(body)
  }
}
