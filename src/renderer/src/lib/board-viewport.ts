// 白板视口记忆(只看本次会话):缩放与滚动。
//
// Excalidraw 存盘时把这些字段标成 export: false —— 它们不是文档内容,文件里没有。
// 但从卡片跳去文档再回来、或者从目录重开同一块白板时,人希望看到上次停在哪。
// 所以按库内路径记在模块里,重开时覆盖 restore() 填的默认视口。
//
// 撤销栈属于 Excalidraw 实例内存,重开必然丢失;这里只负责「看」的位置。

import type { AppState } from '@excalidraw/excalidraw/types'

export interface BoardViewport {
  scrollX: number
  scrollY: number
  zoom: AppState['zoom']
}

/** 只服务「刚离开又回来」,留最近 32 块足够,不随会话无限长。 */
const LIMIT = 32

const views = new Map<string, BoardViewport>()

export function rememberBoardViewport(path: string, view: BoardViewport): void {
  // 量到一半的尺寸(0/NaN)不记,免得下次打开是一片空白。
  if (!Number.isFinite(view.scrollX) || !Number.isFinite(view.scrollY)) return
  if (!Number.isFinite(view.zoom.value) || view.zoom.value <= 0) return
  views.delete(path)
  views.set(path, {
    scrollX: view.scrollX,
    scrollY: view.scrollY,
    zoom: { value: view.zoom.value }
  })
  while (views.size > LIMIT) {
    const oldest = views.keys().next().value
    if (oldest === undefined) break
    views.delete(oldest)
  }
}

export function recallBoardViewport(path: string): BoardViewport | null {
  return views.get(path) ?? null
}
