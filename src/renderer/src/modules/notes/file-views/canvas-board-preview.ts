// 白板卡片预览的纯逻辑:大小上限、空白/坏文件判断、预览用 appState 和模式。
//
// 不碰 DOM,也不引 Excalidraw 运行时 —— 单测跑在 node 环境。
// 第一层预览在 CanvasBoardEmbed 里挂只读画布,更深一层才调 exportToSvg。

import { parseCanvas, type ExcalidrawSceneData } from '@shared/canvas'

/** 超过这个大小的白板不做预览。读 IPC 之前先用 stat 拦一道。 */
export const BOARD_PREVIEW_MAX_BYTES = 8 * 1024 * 1024

/** 元素太多的场景导出会卡住渲染进程。正常白板远到不了。 */
export const BOARD_PREVIEW_MAX_ELEMENTS = 4000

/** 导出留白。和 Excalidraw 自己导出图片的默认值同一量级。 */
export const BOARD_PREVIEW_PADDING = 16

export type BoardPreviewPlan =
  | { kind: 'blank' }
  | { kind: 'invalid' }
  | { kind: 'too-large' }
  | { kind: 'ready'; data: ExcalidrawSceneData }

/**
 * 判断一份白板文本能不能画成预览。
 * 先看大小再看内容:8 MiB 之外的 JSON 不值得解析。
 */
export function canvasBoardPreviewPlan(input: {
  text: string
  size: number
}): BoardPreviewPlan {
  if (!Number.isFinite(input.size) || input.size > BOARD_PREVIEW_MAX_BYTES) {
    return { kind: 'too-large' }
  }
  const parsed = parseCanvas(input.text)
  if (!parsed.ok) return { kind: 'invalid' }
  if (parsed.blank) return { kind: 'blank' }
  const raw = Array.isArray(parsed.data.elements) ? parsed.data.elements : []
  const live = raw.filter(
    (element) =>
      element !== null &&
      typeof element === 'object' &&
      (element as { isDeleted?: unknown }).isDeleted !== true
  )
  if (live.length === 0) return { kind: 'blank' }
  if (live.length > BOARD_PREVIEW_MAX_ELEMENTS) return { kind: 'too-large' }
  return { kind: 'ready', data: parsed.data }
}

export interface BoardExportAppState {
  exportBackground: true
  exportWithDarkMode: boolean
  exportScale: 1
  viewBackgroundColor: string
}

/**
 * 导出参数。背景色用场景里存的那一个(没存就是 Excalidraw 的浅色默认值);
 * 深色主题交给 exportWithDarkMode 的滤镜 —— 和白板自己的「保存为图片」同一条路,
 * 所以预览里看到的就是打开这份白板时看到的配色。
 */
export function canvasBoardExportAppState(
  sceneAppState: unknown,
  theme: 'light' | 'dark'
): BoardExportAppState {
  return {
    exportBackground: true,
    exportWithDarkMode: theme === 'dark',
    exportScale: 1,
    viewBackgroundColor: savedBackground(sceneAppState) ?? '#ffffff'
  }
}

/** 一张卡片是不是正指着当前打开的白板。 */
export function isSelfBoardEmbed(
  path: string,
  boardPath: string | null | undefined
): boolean {
  return typeof boardPath === 'string' && boardPath !== '' && path === boardPath
}

/**
 * 卡片里怎么画这块子白板。
 *
 * 第一层(`depth === 0`)挂一个只读的 Excalidraw:子白板里嵌的图片、网页、PDF
 * 走的是我们自己的渲染器,导出的 SVG 里只有一串路径。再往里(depth ≥ 1)就退回
 * 静态 SVG —— 一层只读画布足够了,再套会越挂越重,还可能无限套下去。
 */
export function boardPreviewMode(depth: number): 'live' | 'static' {
  return depth <= 0 ? 'live' : 'static'
}

function savedBackground(appState: unknown): string | null {
  if (appState === null || typeof appState !== 'object') return null
  const value = (appState as { viewBackgroundColor?: unknown }).viewBackgroundColor
  if (typeof value !== 'string' || value.trim() === '') return null
  return value
}
