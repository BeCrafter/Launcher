// 文件行的分类与图标。纯函数,渲染层与单测共用。
//
// 类型判断只有一份来源:shared/notes.ts 的 noteFileKind(扩展名 + 少数无扩展名文本文件)。
// 这里只负责「类型 → 图标」,以及给行上挂 data-kind 让 CSS 上色。
// 认不出来的扩展名先用通用图标;打开时再按内容尝试文本读取(见 files-store)。

import { noteFileKind, type NoteFileKind } from '@shared/notes'

export type FileKind = NoteFileKind

/** 类型 → FontAwesome 图标;与 noteFileKind 的取值一一对应 */
const KIND_ICONS: Record<NoteFileKind, string> = {
  text: 'fa-file-lines',
  code: 'fa-file-code',
  markdown: 'fa-file-lines',
  csv: 'fa-file-csv',
  html: 'fa-file-code',
  image: 'fa-file-image',
  psd: 'fa-file-image',
  tiff: 'fa-file-image',
  heic: 'fa-file-image',
  pdf: 'fa-file-pdf',
  video: 'fa-file-video',
  audio: 'fa-file-audio',
  docx: 'fa-file-word',
  xlsx: 'fa-file-excel',
  pptx: 'fa-file-powerpoint',
  archive: 'fa-file-zipper',
  'archive-unsupported': 'fa-file-zipper',
  model: 'fa-cube',
  'legacy-office': 'fa-file',
  unsupported: 'fa-file'
}

/** 扩展名 + 文件名 → 类型(未知扩展名 = unsupported) */
export function fileKind(ext: string, name?: string): NoteFileKind {
  return noteFileKind(ext, name)
}

export function noteFileIcon(ext: string, name?: string): string {
  return KIND_ICONS[noteFileKind(ext, name)]
}
