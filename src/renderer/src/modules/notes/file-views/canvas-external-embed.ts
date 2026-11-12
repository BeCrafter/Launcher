// 把「这台电脑上的文件」收成白板嵌入。
//
// 已经在笔记目录里的走现有的相对路径,不写 customData,同步本来就会带上。
// 库外的记下绝对路径,平时跟原文件,打包时才拷进项目。
// 拿不到路径、扩展名不对的,都不嵌。

import { isCanvasPreviewName, type CanvasExternalEmbed } from '@shared/canvas-external'
import { dataSource } from '../../../data'
import { noteFileUrl } from '../../../lib/note-file-url'
import type { CanvasEmbedPick } from './CanvasEmbedPicker'

export async function picksFromLocalFiles(files: readonly File[]): Promise<CanvasEmbedPick[]> {
  const out: CanvasEmbedPick[] = []
  let root = ''
  for (const file of files) {
    const source = window.launcher.filePath(file)
    if (source === '' || !isCanvasPreviewName(file.name) || !isCanvasPreviewName(source)) continue
    if (root === '') root = await dataSource().notes.dir()
    const relative = relativeToNotes(root, source)
    if (relative !== null) {
      out.push({ link: noteFileUrl(relative), label: file.name })
      continue
    }
    const external: CanvasExternalEmbed = { source, project: '', host: '' }
    // 链接必须是 Excalidraw 认得的地址,悬停才会出现「点击以开始交互」。
    // 绝对路径只留在 customData,不写进 link。
    out.push({ link: noteFileUrl(file.name), label: file.name, external })
  }
  return out
}

/** 源路径在笔记目录里时返回相对路径。根本身、目录外、以及用 .. 逃出去的都不是。 */
export function relativeToNotes(root: string, source: string): string | null {
  const base = stripSlash(root)
  if (base === '' || source === base) return null
  const prefix = `${base}/`
  if (!source.startsWith(prefix)) return null
  const rel = source.slice(prefix.length)
  if (rel === '' || rel.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null
  }
  return rel
}

function stripSlash(value: string): string {
  return value.endsWith('/') && value !== '/' ? value.slice(0, -1) : value
}
