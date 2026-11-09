// 笔记编辑器内查找 / 替换的**纯逻辑**。
//
// 不碰 DOM、不依赖 CodeMirror，偏移量就是 `EditorState.doc` 的 UTF-16 偏移 ——
// 面板（NoteFindBar）与高亮扩展（editor-find）共用这一份匹配结果，保证
// 「计数 / 高亮 / 替换」永远说的是同一批区间。
//
// 为什么不用 @codemirror/search:那个包把面板、快捷键、高亮都绑死了，
// 视觉上没法按应用的主题 token 调；这里自己算匹配，换完全可控的 UI。

export interface FindOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

/** 面板关闭再打开要保留的输入。存进 NotesView 的 ref，避免每敲一个字重渲染整页。 */
export interface FindState {
  query: string
  replacement: string
  options: FindOptions
}

export interface FindMatch {
  from: number
  to: number
}

export interface FindResult {
  matches: FindMatch[]
  error: 'invalid-regex' | null
  truncated: boolean
}

/** 一次最多算这么多匹配。再多就只高亮前 5000 个并禁用「全部替换」。 */
export const MAX_FIND_MATCHES = 5000

export const DEFAULT_FIND_OPTIONS: FindOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false
}

const WORD_CHAR = /[\p{L}\p{N}_]/u

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 全词边界：匹配两侧都不能是字母 / 数字 / 下划线（中文按字母处理）。 */
function isWholeWord(text: string, from: number, to: number): boolean {
  if (from > 0) {
    const before = [...text.slice(Math.max(0, from - 2), from)].pop() ?? ''
    if (before !== '' && WORD_CHAR.test(before)) return false
  }
  if (to < text.length) {
    const after = [...text.slice(to, Math.min(text.length, to + 2))][0] ?? ''
    if (after !== '' && WORD_CHAR.test(after)) return false
  }
  return true
}

/** 零长度匹配不进入结果；把 lastIndex 按码点推进一步，避免 `a*` / `^` 卡死。 */
function advanceCodePoint(text: string, index: number): number {
  if (index >= text.length) return index + 1
  const code = text.codePointAt(index) ?? 0
  return index + (code > 0xffff ? 2 : 1)
}

export function findMatches(text: string, query: string, options: FindOptions): FindResult {
  if (query === '') return { matches: [], error: null, truncated: false }

  const flags = `g${options.caseSensitive ? '' : 'i'}${options.regex ? 'm' : ''}u`
  let pattern: RegExp
  try {
    pattern = new RegExp(options.regex ? query : escapeRegExp(query), flags)
  } catch {
    return { matches: [], error: 'invalid-regex', truncated: false }
  }

  const matches: FindMatch[] = []
  let truncated = false
  let current: RegExpExecArray | null
  while ((current = pattern.exec(text)) !== null) {
    const from = current.index
    const to = from + current[0].length
    if (to === from) {
      pattern.lastIndex = advanceCodePoint(text, pattern.lastIndex)
      continue
    }
    if (options.wholeWord && !isWholeWord(text, from, to)) continue
    if (matches.length >= MAX_FIND_MATCHES) {
      truncated = true
      break
    }
    matches.push({ from, to })
  }
  return { matches, error: null, truncated }
}

/** 循环导航：`delta` 为 ±1；没有匹配时固定返回 0。 */
export function nextMatchIndex(current: number, total: number, delta: number): number {
  if (total <= 0) return 0
  return ((current + delta) % total + total) % total
}

/**
 * 活动匹配：第一处**结束位置在光标之后**的匹配（`to > cursor`）。
 * 光标正好停在某处末尾时跳过它 —— 「打开查找」不会原地选中刚打完的那个词。
 * 光标在文末、后面没有匹配时回到第一处。
 */
export function initialMatchIndex(matches: readonly FindMatch[], cursor: number): number {
  const index = matches.findIndex((match) => match.to > cursor)
  return index === -1 ? 0 : index
}

/** 单处替换要插入的文本。纯文本按字面量；正则支持 `$1` / `$&`。 */
export function replacementAt(
  text: string,
  match: FindMatch,
  query: string,
  options: FindOptions,
  replacement: string
): string {
  if (!options.regex) return replacement
  const flags = `${options.caseSensitive ? '' : 'i'}mu`
  try {
    const single = new RegExp(query, flags)
    return text.slice(match.from, match.to).replace(single, replacement)
  } catch {
    // 走到这里说明 query 在算匹配时还是合法的，理论上不会发生；按字面量兜底。
    return replacement
  }
}

/** 「全部替换」的整批 changes：升序、互不重叠，能塞进同一个 transaction。 */
export function buildReplaceAll(
  text: string,
  matches: readonly FindMatch[],
  query: string,
  options: FindOptions,
  replacement: string
): { from: number; to: number; insert: string }[] {
  return matches.map((match) => ({
    from: match.from,
    to: match.to,
    insert: replacementAt(text, match, query, options, replacement)
  }))
}
