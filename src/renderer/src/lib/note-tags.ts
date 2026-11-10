// 标签的界面侧聚合:标签只有一个来源 —— frontmatter 的 tags。
//
// 正文里的 `#xxx` 是普通文字,不参与索引/筛选/搜索(颜色码就是 `#ff5733`,
// 和标签写法无法区分,所以干脆不把正文当标签来源)。标签统一在元数据行的
// 输入框里维护,写回文件。

import type { NoteMeta } from '@shared/notes'

/** 标签比较用的规范 key:去前导 #、NFC、小写。只用于比较,不用于显示。 */
export function normalizeTag(tag: string): string {
  return (tag.startsWith('#') ? tag.slice(1) : tag).trim().normalize('NFC').toLowerCase()
}

export interface TagCount {
  /** 规范化 key(小写),筛选与比较用 */
  key: string
  /** 首次出现的显示大小写 */
  tag: string
  /** 含该标签的**笔记数** */
  count: number
}

/** 一篇笔记的全部标签(只来自 frontmatter),按规范化 key 去重 */
export function noteTagsOf(note: NoteMeta): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of note.tags) {
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
