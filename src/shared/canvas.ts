// 判断一段文本是不是 Excalidraw 场景。
//
// 纯函数,主进程不参与:白板文件是普通文本文件,读写走现有的 notes.saveFile。
// 写盘用 @excalidraw/excalidraw 的 serializeAsJSON,这里不重新定义元素字段。
// 判断和包里的 isValidExcalidrawData 一致:type 是 "excalidraw",
// elements 缺失或是数组,appState 缺失或是对象。

export interface ExcalidrawSceneData {
  type?: string
  version?: number
  source?: string
  elements?: unknown
  appState?: unknown
  files?: unknown
}

export type CanvasParse =
  | { ok: true; blank: true }
  | { ok: true; blank: false; data: ExcalidrawSceneData }
  | { ok: false; error: 'invalid' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 空文本是还没写过的新文件;旧的 JSON Canvas 和解不开的文本都是 invalid,不当成空白板。 */
export function parseCanvas(text: string): CanvasParse {
  if (text.trim() === '') return { ok: true, blank: true }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, error: 'invalid' }
  }
  if (!isRecord(value)) return { ok: false, error: 'invalid' }
  if (value.type !== 'excalidraw') return { ok: false, error: 'invalid' }
  if (value.elements !== undefined && !Array.isArray(value.elements)) {
    return { ok: false, error: 'invalid' }
  }
  if (value.appState !== undefined && !isRecord(value.appState)) {
    return { ok: false, error: 'invalid' }
  }
  return { ok: true, blank: false, data: value }
}
