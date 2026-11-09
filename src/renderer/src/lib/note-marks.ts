// 笔记里的**行内标记**操作：包裹、清除。
//
// 纯函数 + 一层薄壳 dispatch。放这里而不是 NoteEditor.tsx 有两个原因：
//   1. 选区浮条（lib/editor-bubble.ts）也要用，而它被 NoteEditor 注册为扩展 ——
//      写在 NoteEditor 里就成了循环导入；
//   2. 「什么算标记」的正则**必须与预览同源**（下面 MARK_RE 逐字抄自
//      markdown.tsx 的 INLINE_EXT_RE），否则浮条清的格式和预览渲染的格式会漂移。

import { Annotation, type EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/**
 * 「这一段不是我选的、别弹浮条」的标记。块菜单的「先选中整块再套格式」用它 ——
 * 那条 dispatch 会造出一个非空选区，不加闩的话菜单一关就弹出一条浮条。
 */
export const suppressSelectionBubble = Annotation.define<boolean>()

/** 有非空选区。手柄让位、浮条出场，都问这一个判据。 */
export function hasTextSelection(state: EditorState): boolean {
  return !state.selection.main.empty
}

export interface WrapEdit {
  insert: string
  anchor: number
  head: number
}

/** 给选区套标记。`sel` 是选中的那段文本，`from` 用来算光标位置。 */
export function planWrap(sel: string, from: number, before: string, after?: string): WrapEdit {
  const tail = after ?? before
  return sel === ''
    ? { insert: `${before}${tail}`, anchor: from + before.length, head: from + before.length }
    : {
        insert: `${before}${sel}${tail}`,
        anchor: from,
        head: from + before.length + sel.length + tail.length
      }
}

/**
 * 把标记套到当前选区上（快捷键、工具条、浮条三处共用这一份）。
 * 没有选区时插入一对标记并把光标夹在中间 —— 与原来 `wrap()` 的行为一致。
 */
export function applyWrap(view: EditorView, before: string, after?: string): void {
  const { from, to } = view.state.selection.main
  const edit = planWrap(view.state.sliceDoc(from, to), from, before, after)
  view.dispatch({
    changes: { from, to, insert: edit.insert },
    selection: { anchor: edit.anchor, head: edit.head }
  })
  if (!view.hasFocus) view.focus()
}

/**
 * 与预览**同一套**行内语法。逐字抄自 `markdown.tsx` 的 `INLINE_EXT_RE`（见那边的注释），
 * 只把 `u` 之外的行为保持一致：分支顺序、`_` 的边界断言、图片/链接地址允许空格。
 * ⚠ 想改这里先改预览那一条 —— 两边必须是同一套。
 */
const MARK_RE =
  /(?<esc>\\(?<escChar>[\\`*_~[\]()!#>+\-.|]))|(?<bi>\*\*\*(?!\s)(?<biText>[\s\S]+?)(?<!\s)\*\*\*)|(?<b>\*\*(?!\s)(?<bText>[\s\S]+?)(?<!\s)\*\*)|(?<i>\*(?!\s)(?<iText>[^*\n]+?)(?<!\s)\*)|(?<bi2>___(?!\s)(?<bi2Text>[\s\S]+?)(?<!\s)___)|(?<b2>__(?!\s)(?<b2Text>[\s\S]+?)(?<!\s)__)|(?<i2>(?<![\p{L}\p{N}])_(?!\s)(?<i2Text>[^_\n]+?)(?<!\s)_(?![\p{L}\p{N}]))|(?<s>~~(?!\s)(?<sText>[\s\S]+?)(?<!\s)~~)|(?<sub>~(?!\s)(?<subText>[^~\n]+?)(?<!\s)~)|(?<sup>\^(?!\s)(?<supText>[^^\n]+?)(?<!\s)\^)|(?<hl>==(?!\s)(?<hlText>[\s\S]+?)(?<!\s)==)|(?<c>`(?<cText>[^`]+)`)|(?<img>!\[(?<imgAlt>[^\]]*)\]\((?<imgUrl>[^)\n]+?)\))|(?<l>\[(?<lText>[^\]]+)\]\((?<lUrl>[^)\n]+?)\))|(?<auto><(?<autoUrl>https?:\/\/[^>\s]+)>)/gu

const MAX_DEPTH = 8
/**
 * 剥一遍只能去掉一层：`====高亮====` → `==高亮==`。连着套两次高亮就会摞成这样，
 * 点一次「清除格式」却还剩一层，看起来就是「没清掉」。所以这里反复剥到稳定为止。
 * 每遍至少去掉两个字符，必然收敛；上限只是防御。
 */
const MAX_STRIP_PASSES = 8

/** 取出某个分支里「内层文本」；返回 null 表示这个分支不处理。 */
function innerText(g: Record<string, string | undefined>): string | null {
  if (g.bi !== undefined) return g.biText ?? ''
  if (g.b !== undefined) return g.bText ?? ''
  if (g.i !== undefined) return g.iText ?? ''
  if (g.bi2 !== undefined) return g.bi2Text ?? ''
  if (g.b2 !== undefined) return g.b2Text ?? ''
  if (g.i2 !== undefined) return g.i2Text ?? ''
  if (g.s !== undefined) return g.sText ?? ''
  if (g.sub !== undefined) return g.subText ?? ''
  if (g.sup !== undefined) return g.supText ?? ''
  if (g.hl !== undefined) return g.hlText ?? ''
  if (g.c !== undefined) return g.cText ?? ''
  if (g.l !== undefined) return g.lText ?? ''
  return null
}

/**
 * 去掉选区里的**行内**标记，返回替换文本。
 *
 * 三条保守原则，每一条都对应一种「会把文档改坏」：
 *   · 只认**成对**出现的标记；落单的 `**` 原样留下 —— 否则会把邻行的标记吃掉；
 *   · 转义（`\*`）当字面量，图片与自动链接一概不碰 —— 那不是格式，是内容；
 *   · 跨出选区的匹配一律跳过 —— 它有一半在选区外，剪掉就破坏了邻行；
 *   · **行级标记**（`# ` `> ` `- ` ```` ``` ```` 表格竖线 `<div align>`…）完全不碰 ——
 *     清掉一半会直接把结构弄坏（例如把引用块的某一行去掉 `> `）。
 *
 * `before` / `after` 是选区**外**紧邻的至多两个字符：`_` 的边界断言要看它们，
 * 否则「选区恰好从 `_` 开始」会做出与预览不一致的判断。
 *
 * 一遍只能剥一层，所以**剥到稳定为止** —— 重复套格式留下的 `====高亮====` 要一次清干净。
 */
export function stripInlineMarks(text: string, before = '', after = '', depth = 0): string {
  if (text === '' || depth > MAX_DEPTH) return text
  let current = text
  for (let pass = 0; pass < MAX_STRIP_PASSES; pass += 1) {
    const next = stripPass(current, before, after, depth)
    if (next === current) return current
    current = next
  }
  return current
}

/** 单遍剥离。递归时再交给 `stripInlineMarks`，内层摞起来的标记也一样能剥干净。 */
function stripPass(text: string, before: string, after: string, depth: number): string {
  const pad = Math.min(2, before.length)
  const src = before.slice(-pad) + text + after.slice(0, 2)
  const out: string[] = []
  let last = 0
  for (const m of src.matchAll(MARK_RE)) {
    if (m.index === undefined) continue
    const start = m.index - pad
    const end = start + m[0].length
    // 越过选区边界的匹配不动它（另一半在选区外）
    if (start < 0 || end > text.length) continue
    const g = m.groups ?? {}
    const inner = innerText(g)
    if (inner === null) continue
    out.push(text.slice(last, start))
    // 行内代码里的内容不再递归 —— 与预览一致（代码里的 `*` 就是星号）
    out.push(g.c === undefined ? stripInlineMarks(inner, '', '', depth + 1) : inner)
    last = end
  }
  out.push(text.slice(last))
  return out.join('')
}

export interface ClearMarksPlan {
  from: number
  to: number
  insert: string
}

/**
 * 找「正好把选区包在里面」的那一对标记，例如选区是 `高亮`、两边紧邻 `==`。
 *
 * 不能直接拿 MARK_RE 扫上下文：`====高亮====` 里正则会从最外层开始吞（内层文本
 * 变成 `==高亮`），反而认不出紧贴选区的那一对。所以先按候选标记检查选区两侧，
 * 再拿**最小窗口**（`==高亮==`）验证它确实是一对合法标记、内层文本就是选区内容。
 * 这样 `*a* 和 *b*` 里选中 `a* 和 *b` 不会被误判 —— 那两个 `*` 并不是一对。
 */
const ENCLOSING_DELIMITERS = ['***', '___', '**', '__', '~~', '==', '`', '*', '_', '^', '~'] as const

function enclosingMark(doc: string, from: number, to: number): { from: number; to: number } | null {
  const selected = doc.slice(from, to)
  if (selected === '') return null
  for (const delim of ENCLOSING_DELIMITERS) {
    const n = delim.length
    if (from < n || doc.length - to < n) continue
    if (doc.slice(from - n, from) !== delim || doc.slice(to, to + n) !== delim) continue
    // 单个 `_` 的贴边规则与预览一致：两侧紧邻字母/数字时不算斜体
    if (delim === '_') {
      const prev = doc.slice(from - n - 1, from - n)
      const next = doc.slice(to + n, to + n + 1)
      if (/[\p{L}\p{N}]/u.test(prev) || /[\p{L}\p{N}]/u.test(next)) continue
    }
    const win = doc.slice(from - n, to + n)
    for (const m of win.matchAll(MARK_RE)) {
      if (m.index !== 0 || m[0].length !== win.length) continue
      if (innerText(m.groups ?? {}) !== selected) continue
      return { from: from - n, to: to + n }
    }
  }
  return null
}

/**
 * 规划一次「清除格式」：返回要替换的文档区间和替换后的文本；null 表示没有可清的。
 *
 * 两种情形都清，且**一次清到底**：
 *   · 标记在选区**里面**（正常拖选整个 `==高亮==`，以及重复套格式摞出的 `====高亮====`）——
 *     反复剥到稳定；
 *   · 选区只选中了文字、标记紧贴在选区**外面**（双击选词、清一个词的高亮）——
 *     把包住选区的那对标记一并去掉，再继续剥。
 */
export function planClearMarks(doc: string, from: number, to: number): ClearMarksPlan | null {
  if (from >= to) return null
  let working = doc
  let a = from
  let b = to
  // 替换区间在**原文档**坐标系里，向外扩时同步推进
  let lo = from
  let hi = to
  let changed = false
  for (let pass = 0; pass < MAX_STRIP_PASSES; pass += 1) {
    const text = working.slice(a, b)
    if (text === '') break
    const before = working.slice(Math.max(0, a - 2), a)
    const after = working.slice(b, Math.min(working.length, b + 2))
    const stripped = stripInlineMarks(text, before, after)
    if (stripped !== text) {
      working = working.slice(0, a) + stripped + working.slice(b)
      b = a + stripped.length
      changed = true
      continue
    }
    const outer = enclosingMark(working, a, b)
    if (outer === null) break
    lo -= a - outer.from
    hi += outer.to - b
    working = working.slice(0, outer.from) + text + working.slice(outer.to)
    a = outer.from
    b = outer.from + text.length
    changed = true
  }
  if (!changed) return null
  return { from: lo, to: hi, insert: working.slice(a, b) }
}
