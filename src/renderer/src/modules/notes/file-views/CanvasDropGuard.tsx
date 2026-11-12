// 拦住落在画布上的非图片。场景文件会被 Excalidraw 整份读进去并换掉当前白板,
// 素材库文件也会被它自己的导入读完再报错。这里在捕获阶段拦下,不读内容。
// 可预览的文件不交给它,改成外部嵌入:平时跟原文件,打包时才进项目。

import { useEffect } from 'react'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useT } from '../../../hooks/useT'
import { showToast } from '../../../lib/utils'
import { picksFromLocalFiles } from './canvas-external-embed'
import { isCanvasDropImage, isCanvasDropPreview } from './canvas-drop'
import type { CanvasEmbedPick } from './CanvasEmbedPicker'

export function CanvasDropGuard({
  api,
  board,
  onEmbed
}: {
  api: ExcalidrawImperativeAPI
  board: HTMLElement
  onEmbed: (pick: CanvasEmbedPick) => void
}): null {
  const t = useT()

  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      if (!hasForeignFile(event)) return
      event.preventDefault()
    }
    const onDrop = (event: DragEvent): void => {
      const files = droppedFiles(event)
      if (files.length === 0) return
      if (files.every(isCanvasDropImage)) return
      event.preventDefault()
      event.stopPropagation()
      const preview = files.filter(isCanvasDropPreview)
      const skipped = files.filter((file) => !isCanvasDropPreview(file))
      if (skipped.length > 0) {
        const legacy = skipped.some((file) => isLegacyOffice(file.name))
        api.setToast({
          message: t(legacy ? 'notes.canvas.drop.legacyOffice' : 'notes.canvas.drop.unsupported'),
          closable: true,
          duration: 5000
        })
      }
      const unnamed = preview.filter((file) => window.launcher.filePath(file) === '')
      if (unnamed.length > 0) {
        showToast(t('notes.canvas.drop.unsupported'), '#fbbf24', 'fa-triangle-exclamation')
      }
      void picksFromLocalFiles(preview).then((picks) => {
        for (const pick of picks) onEmbed(pick)
      })
    }
    board.addEventListener('dragover', onDragOver)
    board.addEventListener('drop', onDrop, true)
    return () => {
      board.removeEventListener('dragover', onDragOver)
      board.removeEventListener('drop', onDrop, true)
    }
  }, [api, board, onEmbed, t])

  return null
}

function droppedFiles(event: DragEvent): File[] {
  const list = event.dataTransfer?.files
  if (list === undefined || list.length === 0) return []
  return [...list]
}

function hasForeignFile(event: DragEvent): boolean {
  const types = event.dataTransfer?.types
  if (types === undefined) return false
  return [...types].includes('Files')
}

function isLegacyOffice(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.doc') || lower.endsWith('.ppt') || lower.endsWith('.xls')
}
