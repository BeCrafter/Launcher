// 子白板文件的读取:先 stat 拦大小,再读正文。
// 白板卡片预览和小地图缩略图共用同一套大小/编码语义。

import { dataSource } from '../../../data'
import { BOARD_PREVIEW_MAX_BYTES } from './canvas-board-preview'

export type BoardLoad =
  | { ok: true; text: string; size: number }
  | { ok: false; reason: 'missing' | 'unavailable' | 'too-large' }

/** 8 MiB 之外的白板不为了看一眼预览去搬整份文本。 */
export async function loadBoard(path: string): Promise<BoardLoad> {
  try {
    const stat = await dataSource().notes.statFile(path)
    if (stat === null) return { ok: false, reason: 'missing' }
    if (stat.size > BOARD_PREVIEW_MAX_BYTES) return { ok: false, reason: 'too-large' }
    const out = await dataSource().notes.readFile(path)
    if (!out.ok) {
      return { ok: false, reason: out.kind === 'not-found' ? 'missing' : 'unavailable' }
    }
    if (!out.doc.editable) {
      return { ok: false, reason: out.doc.tooLarge ? 'too-large' : 'unavailable' }
    }
    return { ok: true, text: out.doc.text, size: out.doc.size }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}
