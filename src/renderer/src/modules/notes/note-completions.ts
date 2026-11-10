// 编辑器里的 `[[` 自动补全。
//
// 触发判据、候选过滤都是**纯函数** —— 补全弹层的行为不该只能靠手点验证。
// 补全避开代码块与行内代码:那里面的 `[[` 只是代码正文。
//
// `apply` 只替换 `[[` 之后的查询词,前缀原样留在文档里:
// 用户在 `![[` 后面补全时,嵌入的前导 `![[` 不会被吃掉。

import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource
} from '@codemirror/autocomplete'
import { inCodeBlockState, inInlineCodeState } from '../../lib/editor-code-block'

/** 补全候选的上限。标题重的库不该把弹层撑成一张全表 */
export const COMPLETION_LIMIT = 50

/** 补全只需要这两样;`id` 用于重名消歧与 detail 展示 */
export interface WikiTarget {
  id: string
  title: string
}

/** `[[` / `![[` 已经打出、光标还在目标段里 */
const WIKI_TRIGGER_RE = /!?\[\[([^\[\]\n|#]*)$/

export interface CompletionTrigger {
  /** 替换起点(行内偏移):`[[` 之后的第一个字符 */
  from: number
  query: string
}

/** 光标前是 `[[` / `![[` 时返回查询词与替换起点 */
export function wikiTriggerAt(lineText: string, col: number): CompletionTrigger | null {
  const before = lineText.slice(0, Math.max(0, Math.min(col, lineText.length)))
  const m = WIKI_TRIGGER_RE.exec(before)
  if (m === null) return null
  const query = m[1] ?? ''
  return { from: before.length - query.length, query }
}

/** 标题里带这些字符时没法写进 `[[...]]`(会被解析成别名/标题/括号) */
function linkableTitle(title: string): boolean {
  return title !== '' && !/[[\]|#\p{Cc}]/u.test(title)
}

function folderOf(id: string): string {
  const i = id.lastIndexOf('/')
  return i < 0 ? '' : id.slice(0, i)
}

/**
 * 生成 wikilink 候选。
 *
 * - 标题唯一 → `[[标题]]`;
 * - 标题重名 → `[[id|标题]]`,靠 id(路径)把目标钉死,否则点开时 tie-break 可能选到另一篇;
 * - `detail` 始终显示 id:同名标题至少能从目录上看出来。
 */
export function buildWikiOptions(
  targets: readonly WikiTarget[],
  query: string,
  limit = COMPLETION_LIMIT
): Completion[] {
  const q = query.trim().toLowerCase()
  const titleCount = new Map<string, number>()
  for (const t of targets) {
    const key = t.title.toLowerCase()
    titleCount.set(key, (titleCount.get(key) ?? 0) + 1)
  }

  const matches = targets.filter((t) => {
    if (!linkableTitle(t.title)) return false
    if (q === '') return true
    return t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)
  })

  const rank = (t: WikiTarget): number => {
    if (q === '') return 0
    const title = t.title.toLowerCase()
    if (title.startsWith(q)) return 0
    if (t.id.toLowerCase().startsWith(q)) return 1
    return 2
  }
  matches.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id)
  )

  return matches.slice(0, limit).map((t) => {
    const duplicated = (titleCount.get(t.title.toLowerCase()) ?? 0) > 1
    const aliasable = duplicated && linkableTitle(t.id)
    // id 与标题完全相同时 detail 只是重复一遍,省掉(根层笔记大多如此)
    const detail = folderOf(t.id) === '' ? t.id : folderOf(t.id)
    return {
      label: t.title,
      detail: detail === t.title ? undefined : detail,
      // 前缀 `[[` 已留在文档里,这里补内容与收尾
      apply: aliasable ? `${t.id}|${t.title}]]` : `${t.title}]]`,
      type: 'text'
    }
  })
}

/** 代码块 / 行内代码里的 `[[` 不补全 */
function inLiteral(ctx: CompletionContext): boolean {
  return inCodeBlockState(ctx.state, ctx.pos) || inInlineCodeState(ctx.state, ctx.pos)
}

export function wikilinkCompletion(
  getTargets: () => readonly WikiTarget[]
): CompletionSource {
  return (ctx): CompletionResult | null => {
    if (inLiteral(ctx)) return null
    const line = ctx.state.doc.lineAt(ctx.pos)
    const trigger = wikiTriggerAt(ctx.state.sliceDoc(line.from, ctx.pos), ctx.pos - line.from)
    if (trigger === null) return null
    return {
      from: line.from + trigger.from,
      options: buildWikiOptions(getTargets(), trigger.query),
      validFor: /^[^\[\]\n|#]*$/
    }
  }
}
