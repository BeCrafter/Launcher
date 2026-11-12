// 白板上嵌入的链接规则。纯函数:渲染层与单测共用,不引 Excalidraw。
//
// 认三种东西:
//   · note:<笔记 id>        笔记正文,按预览样式渲染
//   · launcher-note://file/<相对路径>  库内文件,按类型用现有查看器
//   · http(s) 地址           网页,用沙箱 iframe 预览
// javascript:、data:、file: 和其他 scheme 不放行。

import { noteFileRelFromUrl } from '../../../lib/note-file-url'

const NOTE_LINK_PREFIX = 'note:'

export type CanvasEmbedTarget =
  | { kind: 'note'; id: string }
  | { kind: 'file'; path: string }
  | { kind: 'web'; url: string }

/** 笔记 id 写成白板元素的 link。id 就是相对路径(可以带中文和空格),逐段编码。 */
export function canvasNoteLink(id: string): string {
  return `${NOTE_LINK_PREFIX}${encodePath(id)}`
}

/**
 * 只收 http 与 https。返回用户输入的字符串本身,不补斜杠、不换 host。
 * 空的、其他 scheme、解不开的都返回 null。
 */
export function canvasWebLink(raw: string): string | null {
  const value = raw.trim()
  if (value === '') return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.hostname === '') return null
  return value
}

/** 从元素的 link 取回嵌入目标;不认识的返回 null。 */
export function canvasEmbedTarget(link: string | null): CanvasEmbedTarget | null {
  if (link === null) return null
  const value = link.trim()
  if (value.startsWith(NOTE_LINK_PREFIX)) {
    const id = decodePath(value.slice(NOTE_LINK_PREFIX.length))
    return id === '' ? null : { kind: 'note', id }
  }
  const path = noteFileRelFromUrl(value)
  if (path !== null && path !== '') return { kind: 'file', path }
  const web = canvasWebLink(value)
  return web === null ? null : { kind: 'web', url: web }
}

/**
 * 交给 Excalidraw 的 validateEmbeddable。
 *
 * 它只在链接合法时给卡片悬停提示。笔记、库内文件和网页按原规则放行;
 * 库外文件的 link 是文件名,同样是 launcher-note://file/ 地址,也放行。
 * 真正读哪一份由 customData 决定,不看这个返回值。
 */
export function canvasEmbedAllowed(link: string): boolean {
  if (link.startsWith('launcher-note://file/')) return true
  return canvasEmbedTarget(link) !== null
}

function encodePath(value: string): string {
  return value
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function decodePath(value: string): string {
  try {
    return value
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/')
  } catch {
    return ''
  }
}
