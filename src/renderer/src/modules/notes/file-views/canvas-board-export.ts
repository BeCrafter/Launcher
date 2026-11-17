// 子白板 → 小地图上的缩略图。
//
// 走和 CanvasBoardEmbed 同一套读取/校验,但不用 exportToSvg:小地图要的是位图,
// 直接 exportToCanvas 到 320 像素。子白板里自己的嵌入在导出里同样是灰块,
// 这里按 depth 1 再补一层类型卡 —— 只补一层,不递归,避免套娃和多次 IPC。

import {
  exportToCanvas,
  getCommonBounds,
  getNonDeletedElements,
  restore
} from '@excalidraw/excalidraw'
import type { ImportedDataState } from '@excalidraw/excalidraw/data/types'
import { loadBoard } from './canvas-board-load'
import {
  canvasBoardExportAppState,
  canvasBoardPreviewPlan
} from './canvas-board-preview'
import { embedCards } from './canvas-embed-cards'
import { compositeEmbedCards } from './canvas-embed-draw'

/** 子白板缩略图的长边像素。地图上只会更小,再高就是浪费。 */
export const BOARD_THUMB_MAX = 320

export async function renderBoardThumbnail(
  path: string,
  theme: 'light' | 'dark'
): Promise<HTMLCanvasElement | null> {
  const loaded = await loadBoard(path)
  if (!loaded.ok) return null
  const plan = canvasBoardPreviewPlan(loaded)
  if (plan.kind !== 'ready') return null
  try {
    const restored = restore(plan.data as ImportedDataState, null, null)
    const elements = getNonDeletedElements(restored.elements)
    if (elements.length === 0) return null
    const exported = await exportToCanvas({
      elements,
      files: restored.files,
      appState: canvasBoardExportAppState(restored.appState, theme),
      maxWidthOrHeight: BOARD_THUMB_MAX,
      exportPadding: 0
    })
    const [minX, minY, maxX, maxY] = getCommonBounds(elements)
    if (![minX, minY, maxX, maxY].every((value) => Number.isFinite(value))) return exported
    const cards = embedCards(elements, { boardPath: path, depth: 1 })
    if (cards.length === 0) return exported
    return compositeEmbedCards(exported, {
      cards,
      contents: new Map(),
      bounds: { minX, minY, maxX, maxY },
      theme
    })
  } catch {
    return null
  }
}
