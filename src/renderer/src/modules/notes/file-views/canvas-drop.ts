// 画布上的拖放。Excalidraw 会把落下来的场景文件整份读进去,还可能直接换掉当前白板。
// 图片交给它插成图像元素。其余可预览的文件由我们记成外部嵌入,不读内容。
// 白板、素材库和打不开的类型拦下来,只提示。

import { isCanvasPreviewName } from '@shared/canvas-external'

const IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.avif',
  '.apng',
  '.svg',
  '.jfif'
] as const

const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/avif',
  'image/apng',
  'image/svg+xml',
  'image/jfif'
])

export function isCanvasImageName(name: string): boolean {
  const lower = name.toLowerCase()
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function isCanvasImageType(type: string): boolean {
  return IMAGE_TYPES.has(type.toLowerCase())
}

/** 落在画布上的文件是否可以当图片插进去。没有名字时只看 MIME。 */
export function isCanvasDropImage(file: { name: string; type: string }): boolean {
  if (file.name !== '' && !isCanvasImageName(file.name)) return false
  if (file.type !== '' && !isCanvasImageType(file.type)) return false
  return file.name !== '' || file.type !== ''
}

/**
 * 能不能按外部文件嵌进白板。必须有名字,而且名字是可预览类型。
 * 带了类型时,不能和图片名单互相矛盾:一张改名成 .pdf 的图片不嵌。
 */
export function isCanvasDropPreview(file: { name: string; type: string }): boolean {
  if (file.name === '' || !isCanvasPreviewName(file.name)) return false
  if (file.type !== '' && isCanvasImageType(file.type) && !isCanvasImageName(file.name)) return false
  if (file.type !== '' && isCanvasImageName(file.name) && !isCanvasImageType(file.type)) return false
  return true
}
