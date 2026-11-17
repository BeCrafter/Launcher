// 小地图里的嵌入卡片:把 embeddable 元素翻成「画什么」的描述。
//
// 纯逻辑,不碰 DOM / Excalidraw,node 单测直接跑。真正读笔记 / 图片 / PDF /
// 子白板在 canvas-embed-content.ts,画在 canvas-embed-draw.ts。
//
// Excalidraw 0.18 的导出不调用 renderEmbeddable,只会给嵌入元素画一块灰底占位,
// 所以小地图必须在导出结果上自己补一层卡片。这里只负责分类与几何。

import {
  canvasEmbedRef,
  type CanvasEmbedBadge,
  type CanvasEmbedRef
} from '@shared/canvas-ref'
import {
  baseNameOf,
  noteFileKind,
  splitFileExt,
  type NoteFileKind
} from '@shared/notes'
import type { ContentBounds } from './canvas-minimap'
import { isSelfBoardEmbed } from './canvas-board-preview'

/** 一次最多给这么多块卡片读真实内容,其余画类型卡。 */
export const EMBED_CONTENT_MAX = 12
/** 小于这个像素面积的卡片不值得去读文件(地图上只是一两个点)。 */
export const EMBED_CONTENT_MIN_AREA = 24

export type EmbedMode = 'text' | 'image' | 'pdf' | 'board' | 'type'

export interface EmbedCardRect {
  x: number
  y: number
  width: number
  height: number
  /** 弧度,和 Excalidraw 元素一致。 */
  angle: number
}

export interface EmbedCardSource {
  kind: 'note' | 'file' | 'external' | 'web'
  noteId?: string
  /** 库内相对路径,或库外绝对路径。 */
  path?: string
  url?: string
  /** 库外文件:源路径 / 打包副本 / 旧 host。 */
  embed?: { source: string; project: string; host: string }
  fileKind?: NoteFileKind
}

export interface EmbedCard {
  id: string
  /** 视觉分类:note / markdown / image / pdf / canvas / web / drawio / office … */
  kind: string
  mode: EmbedMode
  badge: CanvasEmbedBadge | 'none'
  /** 类型卡上的短标签;有真实内容时仍保留,失败回退用。 */
  token: string
  /** 类型色条 / 角标颜色。 */
  accent: string
  /** 卡片标题(文件名 / 笔记名 / 网页 host),宽卡片上会画出来。 */
  label: string
  rect: EmbedCardRect
  source: EmbedCardSource
  cacheKey: string | null
}

export interface EmbedCardElement {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  angle?: number
  link?: string | null
  customData?: unknown
  isDeleted?: boolean
}

/** 文件类型 → 小地图画法。external 在解析出 fileKind 后走同一张表。 */
function fileVisual(fileKind: NoteFileKind, name: string): {
  kind: string
  mode: EmbedMode
  token: string
} {
  const ext = splitFileExt(name).ext.toUpperCase()
  switch (fileKind) {
    case 'markdown':
      return { kind: 'markdown', mode: 'text', token: 'MD' }
    case 'text':
      return { kind: 'text', mode: 'text', token: ext === '' ? 'TXT' : ext.slice(0, 5) }
    case 'code':
      return { kind: 'code', mode: 'text', token: ext === '' ? 'CODE' : ext.slice(0, 5) }
    case 'csv':
      return { kind: 'csv', mode: 'text', token: 'CSV' }
    case 'image':
    case 'psd':
    case 'tiff':
    case 'heic':
      return { kind: 'image', mode: 'image', token: ext === '' ? 'IMG' : ext.slice(0, 5) }
    case 'pdf':
      return { kind: 'pdf', mode: 'pdf', token: 'PDF' }
    case 'canvas':
      return { kind: 'canvas', mode: 'board', token: 'BOARD' }
    case 'drawio':
      return { kind: 'drawio', mode: 'type', token: 'DRAW' }
    case 'html':
      return { kind: 'html', mode: 'type', token: 'HTML' }
    case 'docx':
    case 'xlsx':
    case 'pptx':
    case 'legacy-office':
      return { kind: 'office', mode: 'type', token: ext === '' ? 'DOC' : ext.slice(0, 5) }
    case 'archive':
    case 'archive-unsupported':
      return { kind: 'archive', mode: 'type', token: 'ZIP' }
    case 'model':
      return { kind: 'model', mode: 'type', token: ext === '' ? '3D' : ext.slice(0, 5) }
    case 'video':
      return { kind: 'video', mode: 'type', token: ext === '' ? 'VIDEO' : ext.slice(0, 5) }
    case 'audio':
      return { kind: 'audio', mode: 'type', token: ext === '' ? 'AUDIO' : ext.slice(0, 5) }
    default:
      return { kind: 'unknown', mode: 'type', token: ext === '' ? 'FILE' : ext.slice(0, 5) }
  }
}

const ACCENT: Record<string, string> = {
  note: '#6965db',
  markdown: '#7048e8',
  text: '#495057',
  code: '#4dabf7',
  csv: '#51cf66',
  image: '#f783ac',
  pdf: '#e03131',
  canvas: '#7048e8',
  web: '#15aabf',
  drawio: '#f76707',
  html: '#1098ad',
  office: '#4c6ef5',
  archive: '#fab005',
  model: '#20c997',
  video: '#f76707',
  audio: '#9775fa',
  unknown: '#868e96'
}

function accentOf(kind: string): string {
  return ACCENT[kind] ?? ACCENT.unknown
}

function refLabel(ref: CanvasEmbedRef): string {
  if (ref.kind === 'note') return ref.id
  if (ref.kind === 'file') return baseNameOf(ref.path)
  if (ref.kind === 'external') {
    const path = ref.source !== '' ? ref.source : ref.project
    return path === '' ? '' : baseNameOf(path)
  }
  try {
    return new URL(ref.url).host
  } catch {
    return ref.url
  }
}

/**
 * 元素 → 卡片描述。没有可识别引用、已删除、尺寸非法的元素直接跳过。
 * `depth` ≥ 1 表示已经在子白板导出里:那层不再递归渲染更深的子白板。
 */
export function embedCards(
  elements: readonly EmbedCardElement[],
  opts: { boardPath?: string | null; depth?: number } = {}
): EmbedCard[] {
  const depth = opts.depth ?? 0
  const cards: EmbedCard[] = []
  for (const element of elements) {
    if (element.isDeleted === true || element.type !== 'embeddable') continue
    if (
      !Number.isFinite(element.x) ||
      !Number.isFinite(element.y) ||
      !Number.isFinite(element.width) ||
      !Number.isFinite(element.height) ||
      element.width <= 0 ||
      element.height <= 0
    ) {
      continue
    }
    const ref = canvasEmbedRef(element.customData, element.link ?? null)
    if (ref === null) continue
    const card = cardFor(element, ref, opts.boardPath ?? null, depth)
    if (card !== null) cards.push(card)
  }
  return cards
}

function cardFor(
  element: EmbedCardElement,
  ref: CanvasEmbedRef,
  boardPath: string | null,
  depth: number
): EmbedCard | null {
  const rect: EmbedCardRect = {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    angle: typeof element.angle === 'number' && Number.isFinite(element.angle) ? element.angle : 0
  }
  const base = {
    id: element.id,
    rect,
    label: refLabel(ref)
  }

  if (ref.kind === 'note') {
    return {
      ...base,
      badge: 'note',
      kind: 'note',
      mode: 'text',
      token: 'NOTE',
      accent: accentOf('note'),
      source: { kind: 'note', noteId: ref.id },
      cacheKey: `note:${ref.id}`
    }
  }

  if (ref.kind === 'web') {
    return {
      ...base,
      badge: 'web',
      kind: 'web',
      mode: 'type',
      token: 'WEB',
      accent: accentOf('web'),
      source: { kind: 'web', url: ref.url },
      cacheKey: null
    }
  }

  if (ref.kind === 'external') {
    const path = ref.source !== '' ? ref.source : ref.project
    const name = baseNameOf(path)
    const fileKind = path === '' ? 'unsupported' : noteFileKind(splitFileExt(name).ext, name)
    const visual = fileVisual(fileKind, name)
    // 库外的白板没有可信的库内路径,不做子画布导出,统一类型卡。
    const mode: EmbedMode = fileKind === 'canvas' ? 'type' : visual.mode
    return {
      ...base,
      badge: 'external',
      kind: visual.kind,
      mode,
      token: visual.token,
      accent: accentOf(visual.kind),
      source: {
        kind: 'external',
        path: ref.source !== '' ? ref.source : ref.project,
        embed: { source: ref.source, project: ref.project, host: ref.host },
        fileKind
      },
      cacheKey:
        path === '' ? null : `ext:${fileKind}:${ref.host}:${ref.source}|${ref.project}`
    }
  }

  const name = baseNameOf(ref.path)
  const fileKind = noteFileKind(splitFileExt(name).ext, name)
  const visual = fileVisual(fileKind, name)
  const self = fileKind === 'canvas' && isSelfBoardEmbed(ref.path, boardPath)
  const mode: EmbedMode =
    visual.mode === 'board' && (self || depth >= 1) ? 'type' : visual.mode
  return {
    ...base,
    badge: ref.path.endsWith('.excal') || fileKind === 'canvas' ? 'canvas' : 'vault',
    kind: visual.kind,
    mode,
    token: visual.token,
    accent: accentOf(visual.kind),
    source: { kind: 'file', path: ref.path, fileKind },
    cacheKey: mode === 'type' && fileKind !== 'canvas' ? null : `file:${fileKind}:${ref.path}`
  }
}

/** 场景矩形 → 基础导出画布的像素矩形。旋转卡片取四角 AABB(绘制时仍按角度转)。 */
export function sceneRectToCanvas(
  rect: EmbedCardRect,
  bounds: ContentBounds,
  exportSize: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6)
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-6)
  const sx = exportSize.width / spanX
  const sy = exportSize.height / spanY
  if (rect.angle === 0) {
    return {
      x: (rect.x - bounds.minX) * sx,
      y: (rect.y - bounds.minY) * sy,
      width: rect.width * sx,
      height: rect.height * sy
    }
  }
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const hw = rect.width / 2
  const hh = rect.height / 2
  const cos = Math.cos(rect.angle)
  const sin = Math.sin(rect.angle)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [dx, dy] of [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh]
  ] as const) {
    const x = (cx + dx * cos - dy * sin - bounds.minX) * sx
    const y = (cy + dx * sin + dy * cos - bounds.minY) * sy
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * 挑要读真实内容的卡片:像素面积够大、不是纯类型卡,按面积取前 `limit` 块,
 * 返回时恢复场景顺序。
 */
export function pickContentCards(
  cards: readonly EmbedCard[],
  exportSize: { width: number; height: number },
  bounds: ContentBounds,
  limit = EMBED_CONTENT_MAX
): EmbedCard[] {
  const candidates = cards
    .map((card, index) => {
      const rect = sceneRectToCanvas(card.rect, bounds, exportSize)
      return { card, index, area: rect.width * rect.height }
    })
    .filter((entry) => entry.card.mode !== 'type' && entry.area >= EMBED_CONTENT_MIN_AREA)
  candidates.sort((a, b) => b.area - a.area)
  return candidates
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.card)
}
