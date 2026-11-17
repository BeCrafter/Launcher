// 导出落点的纯逻辑(不 import electron,单测可直接跑):测试目录判定与重名去重。

import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { ExportFileFilter } from '../../shared/note-export'

export type ExportFilters = ExportFileFilter

/**
 * E2E 落点目录。存在时跳过原生对话框,直接把文件落到该目录下。
 *
 * 名字里的 `E2E` 是刻意的:这个分支只在测试运行器注入环境变量时生效,
 * 生产路径永远走 dialog.showSaveDialog。
 */
export function e2eExportDir(): string | null {
  const dir = process.env['LAUNCHER_E2E_EXPORT_DIR']
  return dir !== undefined && dir.trim() !== '' ? dir : null
}

/**
 * 在 `dir` 下取一个还没被占用的路径:`名字.ext`、`名字 (1).ext`、`名字 (2).ext`…
 * 只做存在性探测,不创建文件 —— 调用方写文件时仍然由自己负责。
 */
export function nextFreePath(dir: string, name: string): string {
  const ext = extname(name)
  const stem = ext === '' ? name : name.slice(0, -ext.length)
  let candidate = join(dir, name)
  for (let i = 1; existsSync(candidate); i += 1) {
    candidate = join(dir, `${stem} (${i})${ext}`)
  }
  return candidate
}

/** 建议名只留文件名本身,防止渲染层传进来的字符串带路径 */
export function safeSuggestedName(name: string): string {
  const base = basename(String(name ?? '')).replace(/^\.+/, '')
  return base === '' ? 'export' : base
}
