// PDF 首页 → 小地图缩略图。
//
// 与 PdfViewer 用同一套 pdf.js 资源配置(worker / cmaps / 标准字体 / wasm),
// 但这里只要一页、一次,读完就销毁文档和渲染任务。PdfViewer 的交互路径不动。

import { getDocument, GlobalWorkerOptions, type RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import rendererUrl from 'pdfjs-dist/build/pdf.renderer.min.mjs?url'

if (typeof window !== 'undefined') {
  const base = window.location.href
  GlobalWorkerOptions.workerSrc = new URL(workerUrl, base).href
  GlobalWorkerOptions.rendererSrc = new URL(rendererUrl, base).href
}

function pdfjsAsset(dir: string): string {
  return new URL(`pdfjs/${dir}/`, window.location.href).href
}

/** 画第一页,宽度大致是 `maxWidth`(不放大到超过原页宽)。失败返回 null。 */
export async function renderPdfFirstPage(
  bytes: Uint8Array,
  maxWidth: number
): Promise<HTMLCanvasElement | null> {
  let task: ReturnType<typeof getDocument> | null = null
  let renderTask: RenderTask | null = null
  try {
    task = getDocument({
      data: bytes,
      cMapUrl: pdfjsAsset('cmaps'),
      cMapPacked: true,
      standardFontDataUrl: pdfjsAsset('standard_fonts'),
      wasmUrl: pdfjsAsset('wasm')
    })
    const pdf = await task.promise
    const page = await pdf.getPage(1)
    const unit = page.getViewport({ scale: 1 })
    if (!(unit.width > 0) || !(unit.height > 0)) return null
    const viewport = page.getViewport({ scale: maxWidth / unit.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(viewport.width))
    canvas.height = Math.max(1, Math.ceil(viewport.height))
    renderTask = page.render({ canvas, viewport })
    await renderTask.promise
    return canvas
  } catch {
    return null
  } finally {
    renderTask?.cancel()
    if (task !== null) {
      // destroy 会连 worker 一起收掉;失败时也不能留着。
      void task.destroy()
    }
  }
}
