// 白板外部文件:平时跟录入时的绝对路径,打包时才把当时的内容拷进项目。
//
// 纯函数,主进程与单测共用。不碰 fs。
// 场景元素的 customData.embed 记三条:
//   source  录入时的绝对路径。这台电脑上还在就读它,不管是不是录入的那台。
//   project 相对笔记目录的副本,嵌入时为空,打包成功后才填
//   host    旧记录里的电脑标识。不再参与判断,留着不改已有白板。
// 读取顺序:原文件还在 → 原文件;否则有项目副本 → 项目副本;都没有 → 找不到。
// 不按修改时间挑较新的那份,两边各改各的会来回跳。

import { isSafeNoteId, noteFileKind, type NoteFileKind } from './notes'

export const CANVAS_EMBED_KEY = 'embed'

/** gltf 外部引用最多跟这么多个兄弟。再多的跳过,不让一份坏 json 拖住打包。 */
export const GLTF_SIBLING_MAX = 32

/** 打包时读 gltf 文本的上限。超过就不解析引用,当普通文件拷一份。 */
export const GLTF_TEXT_MAX = 1024 * 1024

const PREVIEWABLE: ReadonlySet<NoteFileKind> = new Set([
  'image',
  'psd',
  'tiff',
  'heic',
  'video',
  'audio',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'archive',
  'model',
  'html',
  'csv',
  'markdown',
  'text',
  'code'
])

export interface CanvasExternalEmbed {
  source: string
  project: string
  host: string
}

export type CanvasExternalRead =
  | { kind: 'source'; path: string }
  | { kind: 'project'; path: string }
  | { kind: 'missing' }

/** 文件名能不能嵌进白板。白板自身、素材库、旧版 Office 和打不开的压缩包都不行。 */
export function isCanvasPreviewName(name: string): boolean {
  const base = fileNameOf(name)
  const dot = base.lastIndexOf('.')
  const ext = dot < 0 ? '' : base.slice(dot + 1)
  return PREVIEWABLE.has(noteFileKind(ext, base))
}

/** 扩展名(不带点)是不是可预览类型。给选择框的 accept 用。 */
export function isCanvasPreviewExt(ext: string): boolean {
  return PREVIEWABLE.has(noteFileKind(ext.replace(/^\./, ''), ''))
}

export interface CanvasEmbedKind {
  id: string
  /** 不带点的扩展名 */
  extensions: readonly string[]
}

/** 工具栏嵌入面板里的类型按钮。压缩包、网页和代码不单列,走「从这台电脑选择」。 */
export const CANVAS_EMBED_KINDS: readonly CanvasEmbedKind[] = [
  { id: 'video', extensions: ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv', 'avi'] },
  { id: 'slides', extensions: ['pptx', 'pptm'] },
  { id: 'document', extensions: ['docx', 'docm'] },
  { id: 'spreadsheet', extensions: ['xlsx', 'xlsm'] },
  { id: 'pdf', extensions: ['pdf'] },
  { id: 'model', extensions: ['glb', 'gltf', 'obj', 'stl'] },
  { id: 'audio', extensions: ['mp3', 'm4a', 'wav', 'ogg', 'oga', 'flac', 'aac', 'opus'] },
  {
    id: 'image',
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'apng', 'svg', 'psd', 'psb', 'tif', 'tiff', 'heic', 'heif']
  }
]

/** 全部可预览扩展名。不分类型的「从这台电脑选择」用这份。 */
export function canvasPreviewExtensions(): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (ext: string): void => {
    if (!isCanvasPreviewExt(ext) || seen.has(ext)) return
    seen.add(ext)
    out.push(ext)
  }
  for (const kind of CANVAS_EMBED_KINDS) {
    for (const ext of kind.extensions) add(ext)
  }
  // 类型按钮没收进去、但卡片已经能画的。
  for (const ext of ['zip', 'tar', 'gz', 'tgz', 'html', 'htm', 'csv', 'tsv', 'tab', 'md', 'markdown', 'txt']) {
    add(ext)
  }
  return out
}

/** 从元素的 customData 取出外部文件记录。缺字段或不是字符串就当没有。 */
export function readCanvasExternal(customData: unknown): CanvasExternalEmbed | null {
  if (customData === null || typeof customData !== 'object') return null
  const raw = (customData as Record<string, unknown>)[CANVAS_EMBED_KEY]
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (typeof record.source !== 'string' || typeof record.host !== 'string') return null
  const project = typeof record.project === 'string' ? record.project : ''
  if (record.source === '' && project === '') return null
  if (project !== '' && !isSafeNoteId(project)) return null
  return { source: record.source, project, host: record.host }
}

/**
 * 决定读哪一份。
 * sourcePresent 由调用方查过磁盘后传入:这里不碰 fs,单测才能不建文件。
 */
export function resolveCanvasExternalRead(
  embed: CanvasExternalEmbed,
  here: { sourcePresent: boolean }
): CanvasExternalRead {
  if (embed.source !== '' && here.sourcePresent) {
    return { kind: 'source', path: embed.source }
  }
  if (embed.project !== '') return { kind: 'project', path: embed.project }
  return { kind: 'missing' }
}

/** 写入 customData 的形状。project 为空表示还没打包。 */
export function canvasExternalData(embed: CanvasExternalEmbed): { embed: CanvasExternalEmbed } {
  return {
    embed: {
      source: embed.source,
      project: embed.project,
      host: embed.host
    }
  }
}

/**
 * gltf 文本里引用的同目录文件。只收相对路径:
 * 没有 scheme、不以 / 开头、不含 ..、不含空段。
 * 解不开、没有外部引用、或引用写在 buffers/images 之外,都返回空数组。
 */
export function gltfSiblingNames(text: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (parsed === null || typeof parsed !== 'object') return []
  const root = parsed as Record<string, unknown>
  const names: string[] = []
  const seen = new Set<string>()
  const take = (list: unknown, key: string): void => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (item === null || typeof item !== 'object') continue
      const uri = (item as Record<string, unknown>)[key]
      if (typeof uri !== 'string') continue
      const name = siblingName(uri)
      if (name === null || seen.has(name)) continue
      seen.add(name)
      names.push(name)
      if (names.length >= GLTF_SIBLING_MAX) return
    }
  }
  take(root.buffers, 'uri')
  if (names.length < GLTF_SIBLING_MAX) take(root.images, 'uri')
  return names
}

function siblingName(uri: string): string | null {
  const value = uri.trim()
  if (value === '' || value.length > 1024) return null
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return null
  if (value.startsWith('/') || value.startsWith('\\')) return null
  let decoded = value.split(/[?#]/, 1)[0] ?? ''
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    return null
  }
  if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('..')) return null
  if (decoded === '' || decoded === '.' || decoded.startsWith('.')) return null
  return decoded
}

function fileNameOf(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'))
  return slash < 0 ? name : name.slice(slash + 1)
}
