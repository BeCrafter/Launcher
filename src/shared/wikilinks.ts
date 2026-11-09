// Obsidian 风格 `[[笔记]]` 的解析与目标解析。
//
// 注意:笔记没有稳定 ID(`id` 就是相对路径,重命名/移动会变),所以链接只能是
// 「点击时按标题/路径解析」的快照,不做持久引用。解析顺序固定,重名时按
// 同目录 → 短 id → 字典序兜底,避免同一篇库在不同机器上跳到不同笔记。

import { maskInlineLiterals } from './inline-scan'
import { baseNameOf, parentOf, type NoteMeta } from './notes'

export const WIKILINK_MAX_TARGET = 200
export const WIKILINK_MAX_HEADING = 128
export const WIKILINK_MAX_ALIAS = 200
/** 单行最多识别这么多条,防病态输入 */
export const WIKILINK_MAX_PER_LINE = 64

export interface WikiLink {
  target: string
  heading: string | null
  alias: string | null
  embed: boolean
}

export interface WikiResolution {
  id: string
  title: string
}

/** 去掉 `.md` 与常见的前导路径噪声 */
function cleanTarget(raw: string): string {
  let t = raw.trim()
  t = t.replace(/^\.\//, '').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+/, '')
  t = t.replace(/\.md$/i, '')
  return t.trim()
}

/**
 * `body` 是 `[[` 与 `]]` 之间的原文(不含括号),`embed` 由前导 `!` 决定。
 * 解析失败返回 null —— 调用方保持原文字面量,绝不猜。
 */
export function parseWikilink(body: string, embed: boolean): WikiLink | null {
  const raw = body.trim()
  if (raw === '') return null

  const bar = raw.indexOf('|')
  const beforeAlias = (bar >= 0 ? raw.slice(0, bar) : raw).trim()
  const aliasRaw = bar >= 0 ? raw.slice(bar + 1).trim() : ''
  const hash = beforeAlias.indexOf('#')
  const targetRaw = (hash >= 0 ? beforeAlias.slice(0, hash) : beforeAlias).trim()
  const headingRaw = hash >= 0 ? beforeAlias.slice(hash + 1).trim() : ''

  const target = cleanTarget(targetRaw)
  // `[[#标题]]` 不在本期范围(需要「当前笔记 + 标题」语义),按字面量处理
  if (target === '') return null

  const heading = headingRaw === '' ? null : headingRaw
  const alias = aliasRaw === '' ? null : aliasRaw

  if (Array.from(target).length > WIKILINK_MAX_TARGET) return null
  if (heading !== null && Array.from(heading).length > WIKILINK_MAX_HEADING) return null
  if (alias !== null && Array.from(alias).length > WIKILINK_MAX_ALIAS) return null

  return { target, heading, alias, embed }
}

const WIKI_RE = /!?\[\[[^\[\]\n]{1,600}\]\]/g

/** 一行里的 wikilink 区间(代码/转义/URL 内的不算) */
export function scanWikilinksInLine(line: string): Array<{ from: number; to: number; link: WikiLink }> {
  // 保留 `[[...]]` 本身,只屏蔽代码/转义/URL
  const masked = maskInlineLiterals(line, { maskWikilinks: false })
  const out: Array<{ from: number; to: number; link: WikiLink }> = []
  for (const m of masked.matchAll(WIKI_RE)) {
    if (m.index === undefined) continue
    const text = line.slice(m.index, m.index + m[0].length)
    const embed = text.startsWith('!')
    const open = embed ? 3 : 2
    const link = parseWikilink(text.slice(open, text.length - 2), embed)
    if (link !== null) out.push({ from: m.index, to: m.index + m[0].length, link })
    if (out.length >= WIKILINK_MAX_PER_LINE) break
  }
  return out
}

export interface WikiIndex {
  byId: Map<string, WikiResolution[]>
  byIdLower: Map<string, WikiResolution[]>
  byTitle: Map<string, WikiResolution[]>
  byTitleLower: Map<string, WikiResolution[]>
  byBase: Map<string, WikiResolution[]>
  byBaseLower: Map<string, WikiResolution[]>
}

function push(map: Map<string, WikiResolution[]>, key: string, value: WikiResolution): void {
  if (key === '') return
  const list = map.get(key)
  if (list === undefined) map.set(key, [value])
  else list.push(value)
}

/** 一次性建索引;解析每次点击只做 Map 查询,不扫笔记列表 */
export function buildWikiIndex(notes: NoteMeta[]): WikiIndex {
  const index: WikiIndex = {
    byId: new Map(),
    byIdLower: new Map(),
    byTitle: new Map(),
    byTitleLower: new Map(),
    byBase: new Map(),
    byBaseLower: new Map()
  }
  for (const n of notes) {
    const hit = { id: n.id, title: n.title }
    if (hit.title === '') continue
    push(index.byId, n.id, hit)
    push(index.byIdLower, n.id.toLowerCase(), hit)
    push(index.byTitle, n.title, hit)
    push(index.byTitleLower, n.title.toLowerCase(), hit)
    const base = baseNameOf(n.id)
    push(index.byBase, base, hit)
    push(index.byBaseLower, base.toLowerCase(), hit)
  }
  return index
}

/** 同一层多个候选:同目录优先 → id 更短 → id 字典序 */
function pick(candidates: WikiResolution[], currentId: string): WikiResolution {
  const dir = parentOf(currentId)
  const sameDir = candidates.filter((c) => parentOf(c.id) === dir)
  const pool = sameDir.length > 0 ? sameDir : candidates
  return [...pool].sort((a, b) => {
    const byLen = Array.from(a.id).length - Array.from(b.id).length
    if (byLen !== 0) return byLen
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })[0]!
}

/**
 * 解析顺序:id 精确 → id 忽略大小写 → title 精确 → title 忽略大小写 →
 * 文件名精确 → 文件名忽略大小写。逐级命中即停。
 */
export function resolveWikiTarget(
  index: WikiIndex,
  target: string,
  currentId: string
): WikiResolution | null {
  const t = cleanTarget(target)
  if (t === '') return null
  const lower = t.toLowerCase()
  const tiers = [
    index.byId.get(t),
    index.byIdLower.get(lower),
    index.byTitle.get(t),
    index.byTitleLower.get(lower),
    index.byBase.get(t),
    index.byBaseLower.get(lower)
  ]
  for (const tier of tiers) {
    if (tier !== undefined && tier.length > 0) return pick(tier, currentId)
  }
  return null
}
