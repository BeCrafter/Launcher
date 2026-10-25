// 渲染层附件读取:图片压缩成 WebP/JPEG,文本按 UTF-8 截断。
// 只依赖浏览器 API;纯判定/截断逻辑与 main 共用 shared/attachment-types.ts + shared/text.ts。
import type { AiImageAttachment, AiTextAttachment } from '@shared/ai'
import {
  MAX_IMAGE_BASE64_BYTES,
  MAX_TEXT_ATTACHMENT_BYTES
} from '@shared/ai'
import { isSupportedImageName, isSupportedTextName } from '@shared/attachment-types'
import { cutUtf8, utf8Bytes } from '@shared/text'

/** 原图上限:再大就先拒绝,避免 createImageBitmap 解压炸弹 */
const MAX_IMAGE_SOURCE_BYTES = 20 * 1024 * 1024
/** 图片最长边(第一档),超过再降一档 */
const MAX_EDGE = 1600
const FALLBACK_EDGE = 1200

export const ATTACHMENT_IMAGE_TOO_LARGE = 'ATTACHMENT_IMAGE_TOO_LARGE'
export const ATTACHMENT_IMAGE_READ_FAILED = 'ATTACHMENT_IMAGE_READ_FAILED'
export const ATTACHMENT_TEXT_ENCODING = 'ATTACHMENT_TEXT_ENCODING'
export const ATTACHMENT_BINARY = 'ATTACHMENT_BINARY'

export const FILE_ACCEPT = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.jsonl',
  '.log',
  '.csv',
  '.tsv',
  '.yaml',
  '.yml',
  '.xml',
  '.plist',
  '.ini',
  '.conf',
  '.toml',
  '.js',
  '.mjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.css',
  '.html',
  '.sh',
  '.zsh',
  '.bash',
  '.py',
  '.go',
  '.rs',
  '.sql'
].join(',')

export function isSupportedImageFile(file: File): boolean {
  return isSupportedImageName(file.name || '', (file.type || '').toLowerCase())
}

export function isSupportedTextFile(file: File): boolean {
  return isSupportedTextName(file.name || '', (file.type || '').toLowerCase())
}

let keySeq = 0
export function makeAttachmentKey(prefix = 'att'): string {
  keySeq += 1
  return `${prefix}-${Date.now().toString(36)}-${keySeq.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

/** 附件卡片上的体积文案;只用于展示,不参与存储或校验 */
export function formatAttachmentBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const kb = bytes / 1024
  if (bytes < 10 * 1024) return `${kb.toFixed(1).replace(/\.0$/, '')} KB`
  if (bytes < 1024 * 1024) return `${Math.round(kb)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`
}

function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  // 一次性 String.fromCharCode(...bytes) 在几十万字节时会爆调用栈,分块拼
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function canvasFor(bitmap: ImageBitmap, maxEdge: number): HTMLCanvasElement {
  const longest = Math.max(bitmap.width, bitmap.height)
  const scale = longest > maxEdge ? maxEdge / longest : 1
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(ATTACHMENT_IMAGE_READ_FAILED)
  // 统一铺白底:透明 PNG 转 JPEG 时不会变黑
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  return canvas
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

async function encodeAt(
  bitmap: ImageBitmap,
  maxEdge: number,
  quality: number
): Promise<{ blob: Blob; mime: string } | null> {
  const canvas = canvasFor(bitmap, maxEdge)
  // WebP 体积更小;部分环境不支持时回退 JPEG
  let blob = await toBlob(canvas, 'image/webp', quality)
  let mime = 'image/webp'
  if (!blob) {
    blob = await toBlob(canvas, 'image/jpeg', quality)
    mime = 'image/jpeg'
  }
  if (!blob) return null
  if (blob.type) mime = blob.type
  return { blob, mime }
}

/** 图片文件 → 压缩后的 base64 附件;超过硬上限直接报错,不把超大负载送进 IPC */
export async function readImageAttachment(file: File): Promise<AiImageAttachment> {
  if (file.size > MAX_IMAGE_SOURCE_BYTES) throw new Error(ATTACHMENT_IMAGE_TOO_LARGE)
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(ATTACHMENT_IMAGE_READ_FAILED)
  }
  try {
    const attempts: Array<{ edge: number; quality: number }> = [
      { edge: MAX_EDGE, quality: 0.85 },
      { edge: FALLBACK_EDGE, quality: 0.75 }
    ]
    for (const attempt of attempts) {
      const encoded = await encodeAt(bitmap, attempt.edge, attempt.quality)
      if (!encoded) continue
      if (base64Length(encoded.blob.size) > MAX_IMAGE_BASE64_BYTES) continue
      const data = arrayBufferToBase64(await encoded.blob.arrayBuffer())
      const ext = encoded.mime === 'image/jpeg' ? 'jpg' : 'webp'
      const fallbackName = `screenshot-${Date.now()}.${ext}`
      return {
        type: 'image',
        key: makeAttachmentKey('img'),
        name: file.name || fallbackName,
        mimeType: encoded.mime,
        data
      }
    }
    throw new Error(ATTACHMENT_IMAGE_TOO_LARGE)
  } finally {
    bitmap.close()
  }
}

/** 文本文件 → UTF-8 文本附件;二进制/UTF-16 直接拒绝,避免把乱码喂给模型 */
export async function readTextAttachment(file: File): Promise<AiTextAttachment> {
  // 多读 4 字节:既够判断"是否截断",也能让读边界上的多字节字符完整
  const readBytes = MAX_TEXT_ATTACHMENT_BYTES + 4
  const buf = await file.slice(0, readBytes).arrayBuffer()
  const bytes = new Uint8Array(buf)
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    throw new Error(ATTACHMENT_TEXT_ENCODING)
  }
  let zeros = 0
  for (const b of bytes) if (b === 0) zeros++
  if (bytes.length > 0 && zeros / bytes.length > 0.01) throw new Error(ATTACHMENT_BINARY)

  let text = new TextDecoder('utf-8').decode(bytes)
  const truncatedByRead = file.size > readBytes
  if (truncatedByRead) text = text.replace(/�+$/, '')
  const cut = cutUtf8(text, MAX_TEXT_ATTACHMENT_BYTES)
  const attachment: AiTextAttachment = {
    type: 'text',
    key: makeAttachmentKey('txt'),
    name: file.name || 'file.txt',
    content: cut.text,
    bytes: utf8Bytes(cut.text)
  }
  if (cut.cut || truncatedByRead) attachment.truncated = true
  return attachment
}
