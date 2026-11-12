// 素材库菜单里的「打开」不限文件类型,图片也能选进去,选完才报加载失败。
// 换成只接受 .excalidrawlib 的选择框。内容也先看过,不是素材库就不交给 Excalidraw。

import { useEffect } from 'react'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useT } from '../../../hooks/useT'
import { pickCanvasLibraryFile, readCanvasLibrary } from './canvas-library'

export function CanvasLibraryLoad({
  api,
  board
}: {
  api: ExcalidrawImperativeAPI
  board: HTMLElement
}): null {
  const t = useT()

  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const item = target.closest('[data-testid="lib-dropdown--load"]')
      if (item === null || !board.contains(item)) return
      event.stopPropagation()
      event.preventDefault()
      void loadLibrary(api, t('notes.canvas.library.unsupported'))
    }
    board.addEventListener('click', onClick, true)
    return () => board.removeEventListener('click', onClick, true)
  }, [api, board, t])

  return null
}

async function loadLibrary(api: ExcalidrawImperativeAPI, unsupported: string): Promise<void> {
  const file = await pickCanvasLibraryFile()
  if (file === null) return
  const blob = await readCanvasLibrary(file)
  if (blob === null) {
    api.setToast({ message: unsupported, closable: true, duration: 5000 })
    return
  }
  try {
    await api.updateLibrary({ libraryItems: blob, merge: true, openLibraryMenu: true })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    api.setToast({ message: unsupported, closable: true, duration: 5000 })
  }
}
