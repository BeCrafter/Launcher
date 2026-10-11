// 附件路径的解析与放行(纯函数,不碰 fs)。
//
// 「读到笔记目录之外」一共有两个入口:预览用的 launcher-note:// 协议,和 AI 的按需读图。
// 三道闸收在**这一个**函数里,两条路共用 —— 各写一份必然漂移,而漂移的表现是
// 「某条路悄悄能读到笔记目录之外」,靠 review 看不出来。
//
// 不放在 services/notes-protocol.ts 里,是因为那个文件 import 了 electron:
// 独立进程(launcher-mcp)也要用这道闸,不能顺带把 electron 拖进去。

import { extname, resolve, sep } from 'node:path'
import { NOTES_ASSETS_DIR, noteAssetKind, type NoteAssetKind } from '../../shared/notes'

export interface ResolvedAsset {
  path: string
  kind: NoteAssetKind
}

/**
 * 相对路径(正文里写的那个,如 `assets/Pasted image 20261009150211.png`)
 * → 笔记目录内的绝对路径 + 附件类型。任何不合规的输入返回 null。
 *
 * 三道闸:
 *   ① 只服务 assets/ 下的文件;
 *   ② 扩展名走白名单(shared/notes.ts 的 ASSET_KINDS,**不含 svg**);
 *   ③ 解析后断言仍在笔记目录内(路径穿越)。
 *
 * 不做任何「猜一个近似的路径」—— 猜错就是读到别处去。
 */
export function resolveAssetRel(dir: string, rel: string): ResolvedAsset | null {
  if (rel === '') return null
  if (!rel.startsWith(`${NOTES_ASSETS_DIR}/`)) return null
  const kind = noteAssetKind(extname(rel).slice(1))
  if (kind === null) return null

  const root = resolve(dir)
  const full = resolve(root, rel)
  if (full !== root && !full.startsWith(root + sep)) return null
  return { path: full, kind }
}
