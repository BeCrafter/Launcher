// 白板元素的引用模型。纯函数,主进程与渲染层共用,不引 Excalidraw。
//
// Excalidraw 自带的链接气泡直接显示 element.link 原文,它没有可替换的入口。
// 所以 link 一律写成**人类可读的路径**(中文照常显示,不做转义),真实引用放进 customData:
//   · customData.launcher = { kind:'note', id } | { kind:'file', path }
//   · customData.embed    库外文件(源码 + 打包副本),见 canvas-external.ts
//
// 早先的白板把引用编码在协议地址里(note:<逐段编码 id>、launcher-note://file/<逐段编码路径>),
// 解析时仍然认,并在打开时升成可读路径;磁盘上的改名改写也走同一套解析。
//
// 旧协议 URL 只解析一次百分号编码;可读路径**不解码**,`50%20off.png` 才能原样保留。

import { readCanvasExternal, type CanvasExternalEmbed } from './canvas-external'
import { isSafeNoteId } from './notes'

/** customData 里放内部引用的键 */
export const CANVAS_REF_KEY = 'launcher'

const NOTE_LINK_PREFIX = 'note:'
const FILE_LINK_PREFIX = 'launcher-note://file/'
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/

export type CanvasInternalRef =
  | { kind: 'note'; id: string }
  | { kind: 'file'; path: string }

export type CanvasEmbedRef =
  | CanvasInternalRef
  | ({ kind: 'external' } & CanvasExternalEmbed)
  | { kind: 'web'; url: string }

/** 卡片角标:笔记 / 库内 / 库外 / 网页 */
export type CanvasEmbedBadge = 'note' | 'vault' | 'external' | 'web'

/**
 * 一次改名/移动。from/to 是相对笔记目录的路径身份:
 * 笔记带 `.md`,库内文件就是它的相对路径。
 * prefix 用于目录改名/移动,按 `/` 段边界匹配(改「旧」不会碰到「旧-2/」)。
 */
export interface CanvasRetarget {
  from: string
  to: string
  prefix?: boolean
}

/** 只收 http 与 https。返回用户输入的字符串本身,不补斜杠、不换 host。 */
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

/** 从 customData.launcher 取内部引用;缺字段、种类不认识、路径不安全都当没有。 */
export function readCanvasInternal(customData: unknown): CanvasInternalRef | null {
  if (customData === null || typeof customData !== 'object') return null
  const raw = (customData as Record<string, unknown>)[CANVAS_REF_KEY]
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (record.kind === 'note' && typeof record.id === 'string' && isSafeNoteId(record.id)) {
    return { kind: 'note', id: record.id }
  }
  if (record.kind === 'file' && typeof record.path === 'string' && isSafeNoteId(record.path)) {
    return { kind: 'file', path: record.path }
  }
  return null
}

/**
 * 写回 customData 的形状。保留其余自定义字段,只换 launcher。
 * 同时删掉 embed:外部优先,留着它会盖过内部引用(只有引用种类变了才会碰到)。
 */
export function canvasInternalData(
  ref: CanvasInternalRef,
  base?: unknown
): Record<string, unknown> {
  const out: Record<string, unknown> =
    base !== null && typeof base === 'object' ? { ...(base as Record<string, unknown>) } : {}
  out[CANVAS_REF_KEY] =
    ref.kind === 'note' ? { kind: 'note', id: ref.id } : { kind: 'file', path: ref.path }
  delete out.embed
  return out
}

/**
 * 只看 link 能认出什么。
 * 顺序有讲究:旧协议 → 网页 → 以 `.md` 结尾的笔记 → 绝对路径(库外兜底)→ 其余相对路径(库内文件)。
 * `.md` 放在 scheme 判断前:笔记名里带冒号也不该被当成协议丢掉。
 */
export function canvasRefFromLink(link: string | null): CanvasEmbedRef | null {
  if (link === null) return null
  const value = link.trim()
  if (value === '') return null

  if (value.startsWith(NOTE_LINK_PREFIX)) {
    const id = decodeSegments(value.slice(NOTE_LINK_PREFIX.length))
    return id === null || !isSafeNoteId(id) ? null : { kind: 'note', id }
  }
  if (value.startsWith(FILE_LINK_PREFIX)) {
    const body = value.slice(FILE_LINK_PREFIX.length).split(/[?#]/, 1)[0] ?? ''
    const path = decodeSegments(body)
    return path === null || !isSafeNoteId(path) ? null : { kind: 'file', path }
  }

  const web = canvasWebLink(value)
  if (web !== null) return { kind: 'web', url: web }

  if (value.endsWith('.md')) {
    const id = value.slice(0, -3)
    if (isSafeNoteId(id)) return { kind: 'note', id }
  }
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) {
    return { kind: 'external', source: value, project: '', host: '' }
  }
  if (SCHEME.test(value)) return null
  if (isSafeNoteId(value)) return { kind: 'file', path: value }
  return null
}

/** customData 优先(embed → launcher),都认不出再看 link。 */
export function canvasEmbedRef(customData: unknown, link: string | null): CanvasEmbedRef | null {
  const external = readCanvasExternal(customData)
  if (external !== null) return { kind: 'external', ...external }
  const internal = readCanvasInternal(customData)
  if (internal !== null) return internal
  return canvasRefFromLink(link)
}

/** 给人看的路径。网页返回 null(它自己带地址栏)。 */
export function canvasDisplayPath(ref: CanvasEmbedRef): string | null {
  if (ref.kind === 'note') return `${ref.id}.md`
  if (ref.kind === 'file') return ref.path
  if (ref.kind === 'external') {
    const path = ref.source !== '' ? ref.source : ref.project
    return path === '' ? null : path
  }
  return null
}

export function canvasRefBadge(ref: CanvasEmbedRef): CanvasEmbedBadge {
  if (ref.kind === 'note') return 'note'
  if (ref.kind === 'file') return 'vault'
  return ref.kind
}

/** 交给 Excalidraw 的 validateEmbeddable:认不出就当作不能嵌入。 */
export function canvasEmbedAllowed(link: string): boolean {
  return canvasRefFromLink(link) !== null
}

/**
 * 改写一份白板文本里的内部引用。没有变化时原样返回(text 逐字不变)。
 * 只动 embeddable 元素;网页和库外文件不动(库外只跟它的打包副本 project)。
 */
export function retargetCanvasText(
  text: string,
  changes: readonly CanvasRetarget[]
): { text: string; changed: boolean } {
  if (changes.length === 0) return { text, changed: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { text, changed: false }
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.elements)) return { text, changed: false }

  let changed = false
  const elements = parsed.elements.map((element: unknown) => {
    if (!isRecord(element) || element.type !== 'embeddable') return element
    const next = retargetElement(element, changes)
    if (next !== null) changed = true
    return next ?? element
  })
  if (!changed) return { text, changed: false }

  const trailing = text.endsWith('\n') ? '\n' : ''
  const nextText = JSON.stringify({ ...parsed, elements }, null, 2) + trailing
  return { text: nextText, changed: true }
}

/** 返回新的元素;不用改时返回 null。 */
function retargetElement(
  element: Record<string, unknown>,
  changes: readonly CanvasRetarget[]
): Record<string, unknown> | null {
  const link = typeof element.link === 'string' ? element.link : null
  const ref = canvasEmbedRef(element.customData, link)
  if (ref === null || ref.kind === 'web') return null

  if (ref.kind === 'external') {
    // 打包副本是库内的相对路径,会跟着文件/目录改名走。源文件的绝对路径不动。
    if (ref.project === '') return null
    const project = mapPath(ref.project, changes)
    if (project === null || project === ref.project || !isSafeNoteId(project)) return null
    const embed = readCanvasExternal(element.customData)
    if (embed === null) return null
    const nextLink = embed.source !== '' ? embed.source : project
    return {
      ...element,
      link: nextLink,
      customData: {
        ...(isRecord(element.customData) ? element.customData : {}),
        embed: { ...embed, project }
      }
    }
  }

  const from = ref.kind === 'note' ? `${ref.id}.md` : ref.path
  const to = mapPath(from, changes)
  if (to === null || to === from || !isSafeNoteId(to)) return null
  // 白板上任何 `.md` 都是笔记(目录扫描就是这么收的),其余是普通文件。
  const next: CanvasInternalRef = to.endsWith('.md')
    ? { kind: 'note', id: to.slice(0, -3) }
    : { kind: 'file', path: to }
  return {
    ...element,
    link: canvasDisplayPath(next),
    customData: canvasInternalData(next, element.customData)
  }
}

function mapPath(path: string, changes: readonly CanvasRetarget[]): string | null {
  for (const change of changes) {
    if (change.prefix === true) {
      if (path === change.from || path.startsWith(`${change.from}/`)) {
        return `${change.to}${path.slice(change.from.length)}`
      }
      continue
    }
    if (path === change.from) return change.to
  }
  return null
}

function decodeSegments(value: string): string | null {
  try {
    return value
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/')
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
