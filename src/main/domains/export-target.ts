// 导出落点的唯一出口:生产环境弹系统保存框,E2E 落进固定目录。
//
// 为什么不把对话框散在各 handler 里:E2E 从不驱动原生弹窗,必须有一个可替换的落点。
// 收在一个函数里,「测试模式」就只影响导出,不影响其它对话框(打开文件/截图仍走原路)。

import { BrowserWindow, dialog } from 'electron'
import { mkdirSync } from 'node:fs'
import { e2eExportDir, nextFreePath, safeSuggestedName, type ExportFilters } from './export-path'

export type { ExportFilters }

export interface PickExportOptions {
  suggestedName: string
  filters?: ExportFilters[]
  title?: string
}

/**
 * 选一个导出落点。取消 → null。
 *
 * `win` 由调用方从发起请求的 webContents 取;拿不到时仍可弹框(无父窗口)。
 */
export async function pickExportPath(
  win: BrowserWindow | null,
  opts: PickExportOptions
): Promise<string | null> {
  const suggestedName = safeSuggestedName(opts.suggestedName)
  const stubbed = e2eExportDir()
  if (stubbed !== null) {
    mkdirSync(stubbed, { recursive: true })
    return nextFreePath(stubbed, suggestedName)
  }

  const r = await dialog.showSaveDialog(win ?? (undefined as never), {
    title: opts.title,
    defaultPath: suggestedName,
    filters: opts.filters
  })
  if (r.canceled || !r.filePath) return null
  return r.filePath
}
