// 导出 PDF:隐藏窗口 + webContents.printToPDF。
//
// 为什么另开一个窗口而不是打印当前页面:导出的是文档内容,不是应用界面(侧栏、头部、
// 主题色都不该进 PDF)。隐藏窗口里只放「要导出的那份 HTML」,打印完立刻销毁。
//
// 为什么禁用页面脚本:导出是静态快照。需要动态渲染的页面导出出来会缺内容,
// 这是刻意的取舍(见 docs/help.md 的导出说明)。

import { BrowserWindow } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { injectExportHead } from '../domains/export-html-head'

/** 单次导出的总时限。20s 足够大文档排版;卡住就销毁窗口,不留后台进程 */
const TIMEOUT_MS = 20_000
/** did-finish-load 之后留给字体/图片解码的时间 */
const SETTLE_MS = 150

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer)
  }) as Promise<T>
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface RenderPdfInput {
  /** 要打印的完整 HTML(UTF-8) */
  html: string
}

/**
 * 把一份 HTML 打印成 PDF 字节。失败(加载错误 / 渲染进程崩溃 / 超时)一律抛错,
 * 由 IPC 层转成用户可见的失败提示;临时文件与隐藏窗口在 finally 里清理。
 */
export async function renderPdf(input: RenderPdfInput): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'launcher-export-'))
  const file = join(dir, 'index.html')
  await writeFile(file, injectExportHead(input.html), 'utf8')

  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 1600,
    webPreferences: {
      // 静态快照:不执行页内脚本,不给导出内容任何应用上下文
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  try {
    const loaded = new Promise<void>((resolve, reject) => {
      win.webContents.once('did-finish-load', () => resolve())
      win.webContents.once('did-fail-load', (_e, code, desc) => {
        reject(new Error(`导出页面加载失败:${desc} (${String(code)})`))
      })
      win.webContents.once('render-process-gone', (_e, details) => {
        reject(new Error(`导出页面渲染进程退出:${details.reason}`))
      })
    })

    await withTimeout(win.loadFile(file), '加载导出页面超时')
    await withTimeout(loaded, '等待导出页面加载超时')
    await delay(SETTLE_MS)

    return await withTimeout(
      win.webContents.printToPDF({ pageSize: 'A4', printBackground: true }),
      '生成 PDF 超时'
    )
  } finally {
    if (!win.isDestroyed()) win.destroy()
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
