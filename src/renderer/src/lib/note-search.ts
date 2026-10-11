// 搜索时的「标签联动」:命中标签的笔记排到最前。
//
// 为什么单独抽出来:这条规则是「搜索框里打标签名,先出这个标签下的东西」的全部依据,
// 塞在组件里没法测。抽成纯函数之后,排序行为有单测钉住,也不会被后续改动悄悄带偏。

import type { NoteMeta } from '@shared/notes'

/**
 * 查询命中了哪些笔记的标签,返回 `笔记 id → 命中的那个标签名`。
 *
 * 命中判定用**子串**(不区分大小写):标签短、且用户多半只记得其中一段,
 * 要求从头匹配会把「实打实的」这种长标签变得很难搜到。
 * 一篇笔记命中多个标签时只取第一个 —— 行上只需要一个能解释「为什么它排前面」的标记。
 */
export function tagHitsOf(notes: NoteMeta[], query: string): Map<string, string> {
  const q = query.trim().toLowerCase()
  const hit = new Map<string, string>()
  if (q === '') return hit
  for (const n of notes) {
    const tag = n.tags.find((tg) => tg.toLowerCase().includes(q))
    if (tag !== undefined) hit.set(n.id, tag)
  }
  return hit
}

/**
 * 把标签命中的排到最前,其余保持原顺序。
 *
 * 依赖 `Array.prototype.sort` 的**稳定性**(ES2019 起为规范行为):
 * 组内仍是传进来的顺序,也就是「置顶在前、其余按最近更新」。
 * 没有任何标签命中时返回原顺序 —— 那就是普通的内容搜索结果。
 */
export function rankByTagHits(list: NoteMeta[], hits: Map<string, string>): NoteMeta[] {
  if (hits.size === 0) return list
  return [...list].sort((a, b) => Number(hits.has(b.id)) - Number(hits.has(a.id)))
}
