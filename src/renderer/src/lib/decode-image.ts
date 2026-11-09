// PSD / TIFF / HEIC → 位图 URL。解码器按需 import,首屏不加载。
// 返回值里的 objectUrl 标记来源:blob URL 必须由调用方在卸载时 revoke,data URL 不用。

import { IMAGE_MAX_PIXELS } from '@shared/notes'

export type DecodedImageKind = 'psd' | 'tiff' | 'heic'

export interface DecodedImage {
  url: string
  objectUrl: boolean
}

function canvasUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png')
}

async function psdToUrl(bytes: Uint8Array): Promise<DecodedImage> {
  const { readPsd } = await import('ag-psd')
  const psd = readPsd(bytes, { useImageData: false })
  const canvas = psd.canvas
  if (canvas === undefined) throw new Error('PSD has no composite image')
  if (canvas.width * canvas.height > IMAGE_MAX_PIXELS) throw new Error('too many pixels')
  return { url: canvasUrl(canvas), objectUrl: false }
}

async function tiffToUrl(bytes: Uint8Array): Promise<DecodedImage> {
  const mod = await import('utif')
  const UTIF = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const ifds = UTIF.decode(buffer)
  if (ifds.length === 0) throw new Error('TIFF has no image')
  const first = ifds[0]
  UTIF.decodeImage(buffer, first)
  const width = first.width as number
  const height = first.height as number
  if (width * height > IMAGE_MAX_PIXELS) throw new Error('too many pixels')
  const rgba = UTIF.toRGBA8(first)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('no 2d context')
  const image = ctx.createImageData(width, height)
  image.data.set(rgba)
  ctx.putImageData(image, 0, 0)
  return { url: canvasUrl(canvas), objectUrl: false }
}

async function heicToUrl(bytes: Uint8Array): Promise<DecodedImage> {
  const mod = await import('heic2any')
  const heic2any = ((mod as unknown as { default?: typeof mod.default }).default ?? mod.default) as (
    opts: unknown
  ) => Promise<Blob | Blob[]>
  const blob = new Blob([new Uint8Array(bytes)], { type: 'image/heic' })
  const out = await heic2any({ blob, toType: 'image/jpeg', quality: 0.92 })
  const result = Array.isArray(out) ? out[0] : out
  return { url: URL.createObjectURL(result), objectUrl: true }
}

export async function decodeImage(kind: DecodedImageKind, bytes: Uint8Array): Promise<DecodedImage> {
  if (kind === 'psd') return psdToUrl(bytes)
  if (kind === 'tiff') return tiffToUrl(bytes)
  return heicToUrl(bytes)
}
