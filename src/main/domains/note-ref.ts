// 关联条的校验与收敛(纯函数)。
//
// 关联可能来自三个入口:界面选择器、手改 frontmatter、LLM 的工具调用 —— 后两者不可信。
// 这里只做形状与上限的收敛;「这个 key 现在指向谁」是渲染层对着已加载 store 的活,不在这层。

import {
  MAX_REFS,
  REF_DETAIL_MAX,
  REF_KEY_MAX,
  REF_LABEL_MAX,
  REF_TYPE_MAX,
  type NoteRef
} from '../../shared/notes'

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/** 单条:type/key 都非空才算数;label 缺失时退化成 key(至少能显示点什么) */
function one(v: unknown): NoteRef | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const type = str(o.type, REF_TYPE_MAX)
  const key = str(o.key, REF_KEY_MAX)
  if (type === '' || key === '') return null
  const label = str(o.label, REF_LABEL_MAX)
  const detail = str(o.detail, REF_DETAIL_MAX)
  const ref: NoteRef = { type, key, label: label === '' ? key : label }
  if (detail !== '') ref.detail = detail
  return ref
}

/** 同一目标(类型 + 持久键)视为同一条 —— 重复添加不该在文件里堆两行 */
export function sameRef(a: NoteRef, b: NoteRef): boolean {
  return a.type === b.type && a.key === b.key
}

/** 校验 + 去重 + 截断。非法项**丢弃而不是报错** —— 手改坏一行不该让整篇笔记读不出来 */
export function normalizeRefs(v: unknown): NoteRef[] {
  if (!Array.isArray(v)) return []
  const out: NoteRef[] = []
  for (const item of v) {
    if (out.length >= MAX_REFS) break
    const ref = one(item)
    if (!ref) continue
    if (out.some((r) => sameRef(r, ref))) continue
    out.push(ref)
  }
  return out
}

/** 标签:trim + 截断 + 去重 + 丢弃空值 */
export function normalizeTags(v: unknown, maxTags: number, tagMax: number): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const item of v) {
    if (out.length >= maxTags) break
    const tag = str(item, tagMax)
    if (tag === '' || out.includes(tag)) continue
    out.push(tag)
  }
  return out
}
