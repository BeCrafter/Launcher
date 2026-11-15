// 把「这台电脑上的文件」收成白板嵌入。
//
// 已经在笔记目录里的走现有的相对路径,不写 customData,同步本来就会带上。
// 库外的记下绝对路径,平时跟原文件,打包时才拷进项目。
// 拿不到路径、扩展名不对的,都不嵌。

import { isCanvasPreviewName } from '@shared/canvas-external'
import { dataSource } from '../../../data'
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
      out.push({ link: relative, label: file.name, ref: { kind: 'file', path: relative } })
      continue
    }
    // 链接直接放绝对路径:链接气泡里看得到引用的是哪一份文件。
    // 真实引用仍以 customData.embed 为准(链接会被 Excalidraw 归一化)。
    out.push({
      link: source,
      label: file.name,
      external: { source, project: '', host: '' }
    })
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
