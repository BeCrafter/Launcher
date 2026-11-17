// 文档导出的动作层:菜单只负责选格式,这里负责「取当前缓冲 → 生成目标内容 → 落盘」。
//
// 两条纪律:
//   · 导出的永远是**当前编辑缓冲**,不是磁盘旧版本 —— 笔记直接用 draft;文件先 flush,
//     再拿 file.text(flush 之后两者一致)。
//   · 失败一定要说出来:PDF 生成、frontmatter 拼装都可能失败,静默什么都不发生最糟。

import { splitFileExt } from '@shared/notes'
import { exportExt, exportFileName, exportFormatsFor, type ExportFormat } from '@shared/note-export'
import { fmt, t } from '../../i18n'
import { buildMarkdownHtml, buildPlainHtml } from '../../lib/note-export-html'
import { showToast } from '../../lib/utils'
import { useFilesStore, type FileDoc } from '../../state/files-store'
import type { NoteDraft } from '../../state/notes-store'

function failMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function filtersFor(ext: string, label: string): { name: string; extensions: string[] }[] {
  return [{ name: label, extensions: [ext] }]
}

function untitled(): string {
  return t('notes.export.untitled')
}

function done(path: string): void {
  showToast(fmt(t('notes.export.done'), { PATH: path }))
}

function failed(err: unknown): void {
  showToast(fmt(t('notes.export.failed'), { MESSAGE: failMessage(err) }), 'var(--red)')
}

export function canExportFile(file: FileDoc | null): boolean {
  if (file === null) return false
  // 占位(没有查看器)与格式矩阵为空(图片/白板/图表/HTML 文件等)都不挂入口
  return file.binaryReason === null && exportFormatsFor(file.kind).length > 0
}

/** 笔记:markdown 走主进程拼完整 .md;html/pdf 走静态渲染 */
export async function exportNote(draft: NoteDraft, format: ExportFormat): Promise<void> {
  try {
    const title = draft.title.trim() === '' ? untitled() : draft.title
    const ext = exportExt(format)
    const suggestedName = exportFileName(title, ext, untitled())

    let path: string | null = null
    if (format === 'markdown') {
      const res = await window.launcher.notes.exportMarkdown({
        id: draft.id,
        body: draft.body,
        meta: { title: draft.title, tags: draft.tags, pinned: draft.pinned, refs: draft.refs }
      })
      if (!res.ok) throw new Error(res.message)
      path = await window.launcher.saveTextFile({
        title: t('notes.export.title'),
        suggestedName,
        content: res.text,
        filters: filtersFor('md', 'Markdown')
      })
    } else if (format === 'html') {
      const html = await buildMarkdownHtml({ title, source: draft.body })
      path = await window.launcher.saveTextFile({
        title: t('notes.export.title'),
        suggestedName,
        content: html,
        filters: filtersFor('html', 'HTML')
      })
    } else {
      const html = await buildMarkdownHtml({ title, source: draft.body })
      path = await window.launcher.savePdf({
        title: t('notes.export.title'),
        suggestedName,
        html
      })
    }
    if (path !== null) done(path)
  } catch (err) {
    failed(err)
  }
}

/** 文件:原文保留编码/行尾,HTML 文件原样导出,其余用生成型 HTML / PDF */
export async function exportFile(file: FileDoc, format: ExportFormat): Promise<void> {
  try {
    // 导出前落盘:PDF 与「原样导出」都该和编辑器里看到的一致
    await useFilesStore.getState().flush()
    const current = useFilesStore.getState().file ?? file
    const stem = splitFileExt(current.name).base
    const ext = exportExt(format, current.ext)
    const suggestedName = exportFileName(stem, ext, untitled())

    let path: string | null = null
    if (format === 'text' || format === 'markdown') {
      path = await window.launcher.saveTextFile({
        title: t('notes.export.title'),
        suggestedName,
        content: current.text,
        filters: filtersFor(ext, ext.toUpperCase()),
        encoding: current.encoding ?? 'utf8',
        eol: current.eol
      })
    } else if (format === 'html') {
      // 能走到这里的文件类型只有 markdown / text / code / csv;HTML 文件不提供导出。
      const html =
        current.kind === 'markdown'
          ? await buildMarkdownHtml({ title: stem, source: current.text })
          : buildPlainHtml({ title: stem, text: current.text })
      path = await window.launcher.saveTextFile({
        title: t('notes.export.title'),
        suggestedName,
        content: html,
        filters: filtersFor('html', 'HTML')
      })
    } else {
      const html =
        current.kind === 'markdown'
          ? await buildMarkdownHtml({ title: stem, source: current.text })
          : buildPlainHtml({ title: stem, text: current.text })
      path = await window.launcher.savePdf({
        title: t('notes.export.title'),
        suggestedName,
        html
      })
    }
    if (path !== null) done(path)
  } catch (err) {
    failed(err)
  }
}
