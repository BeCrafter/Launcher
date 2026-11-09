// 标签的界面侧聚合:frontmatter tags 与正文 inlineTags 在这里合并。
//
// 两者存储上**故意分开**:frontmatter 的 tags 会被保存写回文件,正文标签只是派生索引。
// 合并只发生在展示/筛选/补全这一层,避免一次保存把正文里的 #tag 塞进 frontmatter。

import { normalizeTag } from '@shared/inline-tags'
import type { NoteMeta } from '@shared/notes'

export interface TagCount {
  /** 规范化 key(小写),筛选与比较用 */
  key: string
  /** 首次出现的显示大小写 */
  tag: string
  /** 含该标签的**笔记数** */
  count: number
}

/** 一篇笔记的全部标签(frontmatter + 正文),按规范化 key 去重 */
export function noteTagsOf(note: NoteMeta): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of [...note.tags, ...(note.inlineTags ?? [])]) {
    const key = normalizeTag(tag)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

/** `key` 必须是 normalizeTag 之后的值 */
export function noteHasTag(note: NoteMeta, key: string): boolean {
  return noteTagsOf(note).some((tag) => normalizeTag(tag) === key)
}

/** 全库标签墙:按笔记数降序,同数按标签名排序 */
export function aggregateTags(notes: NoteMeta[], limit = 200): TagCount[] {
  const map = new Map<string, TagCount>()
  for (const note of notes) {
    for (const tag of noteTagsOf(note)) {
      const key = normalizeTag(tag)
      const cur = map.get(key)
      if (cur === undefined) map.set(key, { key, tag, count: 1 })
      else cur.count++
    }
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit)
}

export function filterNotesByTag(notes: NoteMeta[], key: string | null): NoteMeta[] {
  return key === null ? notes : notes.filter((n) => noteHasTag(n, key))
}
