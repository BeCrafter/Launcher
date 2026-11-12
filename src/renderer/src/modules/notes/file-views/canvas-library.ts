/** 素材库文件。Excalidraw 只认这种 JSON,图片和其他文件都不是。 */
export const CANVAS_LIBRARY_EXTENSION = '.excalidrawlib'

const LIBRARY_TYPE = 'excalidrawlib'
const LIBRARY_MIME = 'application/vnd.excalidrawlib+json'

export type CanvasLibraryFile = {
  name: string
  text: () => Promise<string>
}

type OpenFilePicker = (options: {
  multiple?: boolean
  excludeAcceptAllOption?: boolean
  types?: { description?: string; accept: Record<string, string[]> }[]
}) => Promise<{ getFile: () => Promise<File> }[]>

declare global {
  interface Window {
    showOpenFilePicker?: OpenFilePicker
  }
}

/** 系统选择框只列出素材库文件。取消时返回 null,不抛。 */
export function canvasLibraryPickerOptions(): {
  multiple: false
  excludeAcceptAllOption: true
  types: { description: string; accept: Record<string, string[]> }[]
} {
  return {
    multiple: false,
    excludeAcceptAllOption: true,
    types: [
      {
        description: 'Excalidraw library',
        accept: { [LIBRARY_MIME]: [CANVAS_LIBRARY_EXTENSION] }
      }
    ]
  }
}

export async function pickCanvasLibraryFile(): Promise<CanvasLibraryFile | null> {
  if (typeof window.showOpenFilePicker !== 'function') return null
  try {
    const [handle] = await window.showOpenFilePicker(canvasLibraryPickerOptions())
    if (handle === undefined) return null
    const file = await handle.getFile()
    return { name: file.name, text: () => file.text() }
  } catch (err) {
    if (isPickerAbort(err)) return null
    throw err
  }
}

function isPickerAbort(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'AbortError' || err.name === 'SecurityError')
}

/**
 * 读素材库文件。扩展名不对,或内容不是 type 为 excalidrawlib、version 为 1 或 2 的 JSON,
 * 都返回 null。调用方不要把 null 交给 Excalidraw。
 */
export async function readCanvasLibrary(file: CanvasLibraryFile): Promise<Blob | null> {
  if (!isCanvasLibraryName(file.name)) return null
  let text: string
  try {
    text = await file.text()
  } catch {
    return null
  }
  if (!isCanvasLibraryText(text)) return null
  return new Blob([text], { type: LIBRARY_MIME })
}

export function isCanvasLibraryName(name: string): boolean {
  return name.toLowerCase().endsWith(CANVAS_LIBRARY_EXTENSION)
}

export function isCanvasLibraryText(text: string): boolean {
  try {
    const data: unknown = JSON.parse(text)
    if (typeof data !== 'object' || data === null) return false
    const record = data as { type?: unknown; version?: unknown }
    return record.type === LIBRARY_TYPE && (record.version === 1 || record.version === 2)
  } catch {
    return false
  }
}
