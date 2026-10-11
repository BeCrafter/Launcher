// 笔记 id(= 文件名去扩展名)与文件名生成。
//
// id 就是文件名,不往 frontmatter 里塞 `id:` 字段:零改动用户文件,且外部丢进来的 .md 立即可用。
// 代价是 id 来自外部输入(渲染层**和 LLM**),所以 isSafeNoteId 是本功能最重要的一道检查。

import { MAX_TITLE } from '../../shared/notes'
import { slugifyNoteTitle } from '../../shared/note-slug'

// 标题 → 文件名片段的实现已搬到 @shared/note-slug(渲染层也要用它判断是否该改名)。
export { slugifyNoteTitle } from '../../shared/note-slug'

/** 目录名:与标题同一套清洗规则(非法字符、前导点、长度),只是语义上叫目录 */
export const slugifyFolderName = slugifyNoteTitle

/**
 * 在已占用的 id 集合里挑一个不冲突的:本体 → `-2` … `-99` → 时间戳兜底。
 * 时间戳分支带自增序号,同一毫秒内重复调用也能收敛。
 */
export function uniqueNoteId(base: string, taken: ReadonlySet<string>, now: number): string {
  if (!taken.has(base)) return base
  for (let n = 2; n <= 99; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  const stamp = now.toString(36)
  let candidate = `${base}-${stamp}`
  for (let i = 1; taken.has(candidate); i++) candidate = `${base}-${stamp}-${i}`
  return candidate
}

/**
 * 没有 frontmatter title 时的标题来源:正文首个 `# 标题` → 调用方给的兜底(通常是文件名)。
 * 跳过围栏代码块 —— 里面的 `# 注释` 不是标题(与 lib/markdown.tsx 的块级扫描同口径)。
 */
export function titleFromBody(body: string, fallback: string): string {
  let inFence = false
  for (const line of body.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = /^#\s+(\S.*)$/.exec(line)
    if (m) return m[1].trim().slice(0, MAX_TITLE)
  }
  return fallback
}
