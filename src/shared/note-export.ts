// 文档导出的格式矩阵与文件名规则（纯函数）。
//
// 这里只回答「这类文档能导出成什么」，不碰 DOM、不碰 fs：
//   · 矩阵决定文档页头部要不要显示「导出」按钮、菜单里列哪几项；
//   · 文件名清洗决定保存对话框里的建议名（也决定 E2E 桩落盘名，测试才对得上）。
// 文案不放这里 —— 渲染层按 ExportFormat 映射 i18n key。

import type { NoteFileKind } from './notes'

export type ExportFormat = 'markdown' | 'html' | 'pdf' | 'text'

/** 原生保存对话框的文件类型过滤项 */
export interface ExportFileFilter {
  name: string
  extensions: string[]
}

const NONE: readonly ExportFormat[] = []

/**
 * 按文件类型给出可导出的格式。
 *
 * 只覆盖文本类：笔记（`markdown`）、text/code/CSV。
 * 图片 / Office / 白板 / 图表本次不导出 —— 它们没有「换一种表示」的语义。
 * HTML 文件也不导出：应用内直接渲染就是最好的查看方式，再导出一份 HTML/PDF
 * 反而是绕路；而且「原样导出 HTML」与刚打开的文件完全相同。
 */
export function exportFormatsFor(kind: NoteFileKind | null | undefined): readonly ExportFormat[] {
  switch (kind) {
    case 'markdown':
      return ['markdown', 'html', 'pdf']
    case 'text':
    case 'code':
    case 'csv':
      return ['text', 'html', 'pdf']
    default:
      return NONE
  }
}

/**
 * 目标扩展名（不带点）。
 *
 * `text`（原文）保留文件自己的扩展名：导出一份 `.csv` 就该还是 `.csv`，
 * 而不是缩成 `.txt` 把结构信息丢掉。没有扩展名时回退 `txt`。
 */
export function exportExt(
  format: ExportFormat,
  originalExt: string | null | undefined = ''
): string {
  if (format === 'markdown') return 'md'
  if (format === 'html') return 'html'
  if (format === 'pdf') return 'pdf'
  const ext = (originalExt ?? '').trim().toLowerCase().replace(/^\.+/, '')
  return ext === '' ? 'txt' : ext
}

/** 文件名里不能出现的字符：路径分隔符、Windows 保留字符、控制字符 */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g
const MAX_STEM = 120

/**
 * 把一段名字清洗成文件名主体：非法字符换成 `_`，压掉连续空白，
 * 去掉首尾空格与点（macOS 上尾随点会被系统吞掉，导致「名字和显示的不一样」）。
 * 清洗后为空则用 fallback。
 */
export function sanitizeExportStem(stem: string, fallback = '未命名'): string {
  let out = stem.replace(ILLEGAL, '_').replace(/\s+/g, ' ').trim()
  out = out.replace(/^\.+/, '').replace(/\.+$/, '').trim()
  if (out.length > MAX_STEM) out = out.slice(0, MAX_STEM).replace(/\.+$/, '').trim()
  return out === '' ? fallback : out
}

/**
 * 建议文件名。`stem` 应当已经是「不含扩展名的主体」：
 * 笔记传标题，文件传 `baseNameOf(name)`（去掉原扩展名）。
 */
export function exportFileName(
  stem: string,
  ext: string,
  fallback = '未命名'
): string {
  return `${sanitizeExportStem(stem, fallback)}.${ext}`
}
