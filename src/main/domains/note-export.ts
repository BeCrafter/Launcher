// 笔记文件的文本拼装：save 与 export 共用同一段逻辑。
//
// 为什么抽出来：导出「完整 .md」必须是**和保存一致**的那份字节，而不是另写一套
// 「正文 + 拼一个 frontmatter」—— 那会让未知键、BOM、CRLF、未闭合围栏的处理在两条路径上分叉。
// 这里只做拼装，不碰 fs；创建时间由调用方从 stat 算好传进来。

import type { NoteMetaPatch } from '../../shared/notes'
import {
  assembleFile,
  patchFrontmatter,
  readFrontmatter,
  renderFrontmatter,
  splitFrontmatter,
  type FrontmatterFields
} from './frontmatter'

export interface ComposeNoteInput {
  /** 磁盘上的原始文本（含 frontmatter / BOM / 原 EOL） */
  raw: string
  /** 当前编辑缓冲里的正文（LF 归一） */
  body: string
  meta: NoteMetaPatch
  /** 文件创建时间（已格式化成本地 ISO）；frontmatter 缺 created 时补这个 */
  createdIso: string
  /** 本次写入的时间戳（touchUpdated 时才用） */
  nowIso: string
  /**
   * 是否把 updated 推到 nowIso。
   * 保存传 true；导出传 false —— 导出不是一次编辑，不该改写「更新于」。
   */
  touchUpdated: boolean
}

export type ComposeNoteResult =
  | { ok: true; text: string }
  | { ok: false; error: string }

/**
 * 原文件 + 当前缓冲 → 完整文件文本。
 *
 * 行为与 notes-service.save() 的拼装段逐条一致：
 *   · 围栏未闭合 = 整份正文，改元数据直接拒绝；
 *   · 无围栏且没有 meta = 不凭空长出 frontmatter；
 *   · 有围栏 = patchFrontmatter 外科式替换，未知键 / 注释 / 空行逐字节透传；
 *   · BOM 与原 EOL 一起还原。
 */
export function composeNoteMarkdown(input: ComposeNoteInput): ComposeNoteResult {
  const split = splitFrontmatter(input.raw)
  const { fields } = readFrontmatter(split)
  const meta = input.meta
  const hasMeta = Object.keys(meta).length > 0

  let frontmatterLines: string[] | null
  if (split.unclosed) {
    if (hasMeta) return { ok: false, error: 'frontmatter 围栏未闭合,无法改写元数据' }
    frontmatterLines = null
  } else if (!split.present) {
    frontmatterLines = hasMeta
      ? renderFrontmatter({
          ...meta,
          created: input.createdIso,
          ...(input.touchUpdated ? { updated: input.nowIso } : {})
        })
      : null
  } else {
    const patch: Partial<FrontmatterFields> = { ...meta }
    if (input.touchUpdated) patch.updated = input.nowIso
    if (fields.created === undefined) patch.created = input.createdIso
    frontmatterLines = patchFrontmatter(split, patch)
  }

  return {
    ok: true,
    text: assembleFile({
      bom: split.bom,
      eol: split.eol,
      frontmatterLines,
      body: input.body
    })
  }
}
