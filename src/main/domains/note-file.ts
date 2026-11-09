// 笔记目录里的普通文件 → 绝对路径。
//
// 所有入口(列表点击、读、写、预览协议)共用这一道闸:
//   ① 相对路径必须能通过 isSafeNoteId(`..`、绝对路径、超深、隐藏段全部挡住);
//   ② resolve 之后仍在笔记目录内;
//   ③ lstat 必须是普通文件且不是符号链接;
//   ④ realpath 也必须在笔记目录内(防祖先目录被换成指向外部的链接)。
//
// `assets/` 是应用自己的附件目录:文件行(读/写/删)不允许进入它,
// 只有只读的预览协议可以(`index.html` 引用 `assets/logo.png` 是常见写法)。

import { lstatSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { NOTES_ASSETS_DIR, isSafeNoteId } from '../../shared/notes'

/** p 是否在 root 内(含 root 本身) */
function inside(root: string, p: string): boolean {
  const base = root.endsWith('/') ? root : `${root}/`
  return p === root || p.startsWith(base)
}

function isRootAssets(rel: string): boolean {
  return rel === NOTES_ASSETS_DIR || rel.startsWith(`${NOTES_ASSETS_DIR}/`)
}

export interface ContainedFileOptions {
  /** 允许根层 assets/(只给只读协议用) */
  allowRootAssets?: boolean
}

export function resolveContainedFile(
  dir: string,
  rel: string,
  opts: ContainedFileOptions = {}
): string | null {
  if (rel === '' || !isSafeNoteId(rel)) return null
  if (opts.allowRootAssets !== true && isRootAssets(rel)) return null
  const root = resolve(dir)
  const abs = resolve(root, rel)
  if (abs === root || !inside(root, abs)) return null
  try {
    const st = lstatSync(abs)
    if (!st.isFile() || st.isSymbolicLink()) return null
    // realpath 也要在目录内:上面只排除了文件本身是链接,没有排除它上层的目录
    if (!inside(realpathSync(root), realpathSync(abs))) return null
  } catch {
    return null
  }
  return abs
}

/** 只读入口:允许根层 assets/,其余安全规则与文件行完全一致 */
export function resolveReadableFile(dir: string, rel: string): string | null {
  return resolveContainedFile(dir, rel, { allowRootAssets: true })
}
