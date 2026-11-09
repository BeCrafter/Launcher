// 正文里的 `#标签` —— 解析规则只此一份,渲染/索引/补全共用。
//
// 与 Obsidian 对齐的几条边界:
//   · 标签前必须是行首、空白或标点:`foo#bar`、`https://x/#frag`、`##tag` 都不算;
//   · 只允许字母/数字/下划线/连字符/斜杠,最长 64;
//   · 首尾必须是字母/数字/下划线(不能以 `-`、`/` 收尾);
//   · 至少含一个非数字字符 —— `#123` 不是标签,`#123abc` 是;
//   · 代码块、行内代码、转义、URL 里的一律不算。

import { fenceMask, maskInlineLiterals } from './inline-scan'

export const INLINE_TAG_MAX_LENGTH = 64
export const MAX_INLINE_TAGS_PER_NOTE = 128

const TAG_BODY_RE = /^[\p{L}\p{N}_/-]+$/u
const TAG_EDGE_RE = /^[\p{L}\p{N}_]$/u
const NON_NUMERIC_RE = /[^\p{N}]/u
/** `#` 前面出现这些字符就不算标签(URL 片段、HTML 实体、转义、行内连接) */
const BAD_PREV_RE = /[\p{L}\p{N}_/#&\\-]/u

/** 渲染/索引用的规范 key:去前导 #、NFC、小写。只用于比较,不用于显示。 */
export function normalizeTag(tag: string): string {
  return (tag.startsWith('#') ? tag.slice(1) : tag).trim().normalize('NFC').toLowerCase()
}

/** 标签名本身是否合法(可带前导 #) */
export function isValidInlineTag(tag: string): boolean {
  const name = tag.startsWith('#') ? tag.slice(1) : tag
  const chars = Array.from(name)
  if (chars.length === 0 || chars.length > INLINE_TAG_MAX_LENGTH) return false
  if (!TAG_BODY_RE.test(name)) return false
  if (!TAG_EDGE_RE.test(chars[0]!) || !TAG_EDGE_RE.test(chars[chars.length - 1]!)) return false
  return NON_NUMERIC_RE.test(name)
}

export interface TagRange {
  from: number
  to: number
  tag: string
}

const TAG_RE = /(?<![\p{L}\p{N}_/#&\\-])#([\p{L}\p{N}_/-]{1,64})(?![\p{L}\p{N}_/-])/gu

/** 一行里的标签区间(已屏蔽代码/转义/URL/链接地址/wikilink) */
export function scanInlineTagsInLine(line: string): TagRange[] {
  const masked = maskInlineLiterals(line, { maskWikilinks: true })
  const out: TagRange[] = []
  for (const m of masked.matchAll(TAG_RE)) {
    if (m.index === undefined) continue
    const name = m[1] ?? ''
    if (!isValidInlineTag(name)) continue
    // 用原串切片取显示大小写 —— masked 只用于判断位置
    out.push({ from: m.index, to: m.index + m[0].length, tag: line.slice(m.index + 1, m.index + m[0].length) })
  }
  return out
}

/** 整篇正文里的标签(去重、保留首次出现的显示大小写、最多 limit 个) */
export function scanInlineTags(text: string, limit = MAX_INLINE_TAGS_PER_NOTE): string[] {
  const lines = text.split('\n')
  const inFence = fenceMask(lines)
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue
    for (const hit of scanInlineTagsInLine(lines[i]!)) {
      const key = normalizeTag(hit.tag)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(hit.tag)
      if (out.length >= limit) return out
    }
  }
  return out
}
