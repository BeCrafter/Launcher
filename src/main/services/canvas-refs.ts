// 改名 / 移动后改写白板里的引用。
//
// 只扫 `.excal` / `.excalidraw`,只改真的有变化的文件(tmp + rename 原子替换)。
// 单块白板读不动、写失败都只记日志:改名本身已经成功,不能因为一块坏白板就回滚。

import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { retargetCanvasText, type CanvasRetarget } from '../../shared/canvas-ref'
import { MAX_FOLDER_DEPTH, isSafeNoteId } from '../../shared/notes'

const BOARD_NAME = /\.(?:excal|excalidraw)$/i
/** 白板再多也不至于上千块;真有那么多,改名的代价也不该无上限。 */
const MAX_BOARDS = 5000
/** 单块白板的上限。超过它多半不是场景文本,不值得整份读进来。 */
const MAX_BOARD_BYTES = 64 * 1024 * 1024

export interface CanvasRetargetResult {
  /** 真正被改写、相对笔记目录的路径 */
  paths: string[]
  errors: { path: string; message: string }[]
}

export function retargetCanvasFiles(input: {
  dir: string
  changes: readonly CanvasRetarget[]
  log?: (message: string) => void
}): CanvasRetargetResult {
  const paths: string[] = []
  const errors: { path: string; message: string }[] = []
  if (input.changes.length === 0) return { paths, errors }

  const walk = (rel: string, depth: number): boolean => {
    if (depth > MAX_FOLDER_DEPTH || paths.length >= MAX_BOARDS) return paths.length >= MAX_BOARDS
    const abs = rel === '' ? input.dir : join(input.dir, rel)
    let entries
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch (err) {
      input.log?.(`retarget 读取目录失败,跳过 ${rel || '.'}: ${String(err)}`)
      return false
    }
    for (const entry of entries) {
      // .trash / .git 一类不进
      if (entry.name.startsWith('.')) continue
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        if (!isSafeNoteId(child)) continue
        if (walk(child, depth + 1)) return true
        continue
      }
      if (!entry.isFile() || !BOARD_NAME.test(entry.name)) continue
      retargetOne(join(abs, entry.name), child, input, paths, errors)
      if (paths.length >= MAX_BOARDS) return true
    }
    return false
  }

  walk('', 0)
  return { paths, errors }
}

function retargetOne(
  abs: string,
  rel: string,
  input: { changes: readonly CanvasRetarget[]; log?: (message: string) => void },
  paths: string[],
  errors: { path: string; message: string }[]
): void {
  try {
    const stat = statSync(abs)
    if (!stat.isFile() || stat.size > MAX_BOARD_BYTES) return
    const text = readFileSync(abs, 'utf8')
    const out = retargetCanvasText(text, input.changes)
    if (!out.changed) return
    const tmp = `${abs}.tmp`
    writeFileSync(tmp, out.text, 'utf8')
    renameSync(tmp, abs)
    paths.push(rel)
    input.log?.(`retargeted ${rel}`)
  } catch (err) {
    errors.push({ path: rel, message: String(err) })
    input.log?.(`retarget ${rel} 失败: ${String(err)}`)
  }
}
