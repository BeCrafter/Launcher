// 小地图内容加载的浏览器实现:IPC 读文件、协议 URL 取库外文件、图片解码、
// PDF 首页、子白板导出。编排在 canvas-embed-content.ts,这里只提供 deps。
//
// 图片一律走「字节 → 同源 Blob URL → Image」:直接画 launcher-note:// 上的像素
// 会把 canvas 标成跨源污染,之后导出/getImageData 都会抛 SecurityError。

import { decodeTextBytes } from '@shared/text-file'
import { dataSource } from '../../../data'
import { decodeImage } from '../../../lib/decode-image'
import { noteExternalUrl } from '../../../lib/note-file-url'
import { renderBoardThumbnail } from './canvas-board-export'
import { createCardContentLoader, type CardContentDeps } from './canvas-embed-content'
import { renderPdfFirstPage } from './pdf-page-thumb'

export function createMinimapContentLoader() {
  return createCardContentLoader(cardContentDeps())
}

export function cardContentDeps(): CardContentDeps {
  return {
    async readNote(id) {
      const note = await dataSource().notes.read(id)
      return note?.body ?? null
    },
    async readTextFile(path) {
      const out = await dataSource().notes.readFile(path)
      return out.ok && out.doc.editable ? out.doc.text : null
    },
    async statFile(path) {
      const stat = await dataSource().notes.statFile(path)
      return stat === null ? null : { size: stat.size, mime: stat.mime }
    },
    async readBytes(path, maxBytes) {
      const out = await dataSource().notes.readFileBytes(path, maxBytes)
      return out.ok ? out.data : null
    },
    async probeExternal(input) {
      const result = await dataSource().notes.probeExternal(input)
      return result.present
    },
    fetchExternalText: (abs, maxBytes) => fetchText(noteExternalUrl(abs), maxBytes),
    fetchExternalBytes: (abs, maxBytes) => fetchBytes(noteExternalUrl(abs), maxBytes),
    decodeImage: (kind, bytes) => decodeImage(kind, bytes),
    loadImage,
    loadImageBytes,
    revokeUrl: (url) => URL.revokeObjectURL(url),
    renderPdfFirstPage,
    renderBoardThumbnail
  }
}

function loadImage(url: string): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('image decode failed'))
    image.src = url
  })
}

async function loadImageBytes(
  bytes: Uint8Array,
  mime: string
): Promise<CanvasImageSource> {
  const url = URL.createObjectURL(new Blob([bufferOf(bytes)], { type: mime }))
  try {
    return await loadImage(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function fetchText(url: string, maxBytes: number): Promise<string | null> {
  const bytes = await fetchBytes(url, maxBytes)
  if (bytes === null) return null
  const decoded = decodeTextBytes(bytes)
  return decoded.ok ? decoded.decoded.text : null
}

async function fetchBytes(url: string, maxBytes: number): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const announced = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(announced) && announced > maxBytes) return null
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > maxBytes) return null
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
}
