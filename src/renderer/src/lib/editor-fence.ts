// 反引号输入自动化:行首成对围栏 + 选区「先包行内,第三下升级」。
//
// 三件事:
//   1. 空行 / 行首连续输入 3 个反引号 → 立刻补出首尾围栏,光标停在开头围栏之后
//      (可以马上输入语言,回车进入正文)。
//   2. 选中内容后输入反引号:第一下包成行内代码;第二下把首尾标记各自补成两个反引号
//      (立刻可见,像 `` ``` `` ... `` ``` `` 的中间态);第三下整体升级为围栏
//      (用户选择的「先包成行内代码,第三个升级」)。
//   3. 围栏 / 缩进代码块内部一律不介入 —— 那里的反引号是代码正文,或者是用来闭合围栏的。
//
// 为什么用 `EditorView.inputHandler` 而不是 keymap:输入法、组合输入、粘贴最终都落到
// 同一个 DOM 变更入口;而且我们要在**字符落盘之前**看到「已经有两个反引号」这件事。
//
// 块模型(`markdown-blocks.ts`)的 `consumeParagraph` 只认空行:围栏直接贴在段落后面会被
// 吞进段落块,块手柄 / 折叠就失效。所以补空行的规则与 `NoteEditor.insertFence` 一致:
// 文首 / 前面已经有空行不补,其余补一个;但本来就处在同一层引用里时不补(裸空行会把
// 引用拆成两个块)。
//
// 这是「输入时触发」,不是格式化器:除了这一次触发,不改写任何已有文本。

import { EditorSelection, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { completionStatus } from '@codemirror/autocomplete'
import { inCodeBlock } from './editor-code-block'
import { planWrap } from './note-marks'
import { linePrefix } from './note-media-size'

/** 行首成对围栏的计划(位置全部相对行首)。 */
export interface FencePairPlan {
  /** 替换整行的文本 */
  insert: string
  /** 光标位置,相对行首 */
  caret: number
}

/** 选区升级成围栏的计划(位置全部相对开头围栏所在行首)。 */
export interface FenceUpgradePlan {
  /** 替换起点:行首情况是 0,行中情况是开头反引号所在列 */
  openFrom: number
  /** 替换终点:行首情况是「前缀 + 开头反引号」之后,行中是开头反引号之后 */
  openTo: number
  openInsert: string
  closeInsert: string
  /** 光标位置,相对开头围栏所在行首 */
  caret: number
}

interface FenceUpgradeArgs {
  openLine: string
  openCol: number
  closeLine: string
  closeCol: number
  /** 开头围栏所在行的上一行;第一行为 null */
  prevLineText: string | null
  /** 首尾各是几个反引号(第二个反引号之后是 2) */
  ticks?: number
}

/**
 * 行内容起点的容器前缀:0–3 个前导空格,或引用前缀(可嵌套)后面再接 0–3 个空格。
 * 返回原文本;null 表示这段文本不是纯容器前缀(例如前面还有正文、列表标记、Tab)。
 *
 * 口径与 `linePrefix` 一致 —— 引用里的围栏必须带着 `> `,否则会跑到引用外面。
 * 4 个及以上空格是缩进代码块,按行中情况处理。
 */
function containerPrefix(text: string): string | null {
  const prefix = linePrefix(text)
  if (!/^ {0,3}(?:> ?)*$/.test(prefix)) return null
  const rest = text.slice(prefix.length)
  if (prefix.includes('>')) return /^ {0,3}$/.test(rest) ? text : null
  return rest === '' ? text : null
}

/**
 * 围栏前是否需要补一个空行。布在段落后面时必须补(块模型只认空行);
 * 但同层引用里不补 —— 裸空行会让 `consumeQuote` 把引用拆成两块。
 */
function leadBefore(prevLineText: string | null, prefix: string): string {
  if (prevLineText === null || prevLineText.trim() === '') return ''
  const prevIsQuote = linePrefix(prevLineText).includes('>')
  if (prefix.includes('>') && prevIsQuote) return ''
  return '\n'
}

/** 行首已经有两个反引号时,补出成对围栏。 */
export function planFencePair(
  lineText: string,
  caretCol: number,
  prevLineText: string | null
): FencePairPlan | null {
  const before = lineText.slice(0, caretCol)
  const after = lineText.slice(caretCol)
  if (!/^[ \t]*$/.test(after)) return null
  if (!before.endsWith('``')) return null
  const base = before.slice(0, -2)
  if (containerPrefix(base) === null) return null
  const lead = leadBefore(prevLineText, base)
  return {
    insert: `${lead}${base}\`\`\`\n${base}\`\`\``,
    caret: lead.length + base.length + 3
  }
}

/** 选区已经包成行内代码后,把首尾两个反引号升级成围栏。 */
export function planFenceUpgrade({
  openLine,
  openCol,
  closeLine,
  closeCol,
  prevLineText,
  ticks = 1
}: FenceUpgradeArgs): FenceUpgradePlan | null {
  const before = openLine.slice(0, openCol)
  const after = closeLine.slice(closeCol + ticks)
  if (ticks < 1) return null
  if (openLine.slice(openCol, openCol + ticks) !== '`'.repeat(ticks)) return null
  if (closeLine.slice(closeCol, closeCol + ticks) !== '`'.repeat(ticks)) return null
  const prefix = containerPrefix(before)

  if (prefix !== null) {
    // 选区从行内容起点开始:围栏留在本行,内容行与围栏共用同一容器前缀。
    // 替换范围从行首算起,补空行时 `\n` 落在行首,不会在前缀后面留下只有空格的空行。
    // 结束围栏用**闭合行**自己的前缀(多行选区可能停在另一层缩进 / 引用里)。
    const lead = leadBefore(prevLineText, prefix)
    const closePrefix = containerPrefix(linePrefix(closeLine)) ?? ''
    const openInsert = `${lead}${prefix}\`\`\`\n${prefix}`
    const closeInsert = `\n${closePrefix}\`\`\`${after.trim() === '' ? '' : `\n${closePrefix}`}`
    return {
      openFrom: 0,
      openTo: openCol + ticks,
      openInsert,
      closeInsert,
      caret: lead.length + prefix.length + 3
    }
  }

  // 行中选区:围栏各自独占一行。前面有正文时补空行,否则围栏会被上一段吞掉。
  // v1 不推断列表 / 引用容器,围栏落到顶层(见文件顶部的边界说明)。
  const lead = before.trim() === '' ? '\n' : '\n\n'
  const openInsert = `${lead}\`\`\`\n`
  const closeInsert = `\n\`\`\`${after.trim() === '' ? '' : '\n'}`
  return {
    openFrom: openCol,
    openTo: openCol + ticks,
    openInsert,
    closeInsert,
    caret: openCol + lead.length + 3
  }
}

interface PendingInlineFence {
  /** 开头 / 闭合反引号在文中的位置 */
  openFrom: number
  closeFrom: number
  /** 输入第二、第三个反引号时应处的光标位置 */
  caret: number
  docLength: number
  ticks: 1 | 2
  at: number
}

/** 第一个反引号之后的短暂状态。按 view 分开存,模块级扩展也不会串编辑器。 */
const pendingByView = new WeakMap<EditorView, PendingInlineFence>()

/** 停顿太久就当作「用户只是想要一段行内代码」,不再升级。 */
const PENDING_TTL = 10000

/**
 * 光标 / 选区端点是否在代码块里。文末的开放围栏有一个坑:位置正好在文档末尾时,
 * `resolveInner(pos, 1)` 会解析到 FencedCode 之外的 Document,所以要再看左边一个字符。
 * (没有结尾换行的已闭合围栏不要紧 —— 那时光标已经在围栏的闭合行上,本来就不该成对。)
 */
function inCodeAt(view: EditorView, pos: number): boolean {
  return inCodeBlock(view, pos) || (pos > 0 && inCodeBlock(view, pos - 1))
}

function wrapInlineCode(view: EditorView, from: number, to: number, now: number): void {
  const edit = planWrap(view.state.sliceDoc(from, to), from, '`')
  view.dispatch({
    changes: { from, to, insert: edit.insert },
    selection: EditorSelection.cursor(edit.head),
    userEvent: 'input.type',
    scrollIntoView: true
  })
  pendingByView.set(view, {
    openFrom: from,
    closeFrom: edit.head - 1,
    caret: edit.head,
    docLength: view.state.doc.length,
    ticks: 1,
    at: now
  })
}

function upgradeInlineFence(view: EditorView, pending: PendingInlineFence): boolean {
  const doc = view.state.doc
  const ticks = pending.ticks
  if (pending.closeFrom <= pending.openFrom) return false
  if (doc.sliceString(pending.openFrom, pending.openFrom + ticks) !== '`'.repeat(ticks)) return false
  if (doc.sliceString(pending.closeFrom, pending.closeFrom + ticks) !== '`'.repeat(ticks))
    return false

  const openLine = doc.lineAt(pending.openFrom)
  const closeLine = doc.lineAt(pending.closeFrom)
  const plan = planFenceUpgrade({
    openLine: openLine.text,
    openCol: pending.openFrom - openLine.from,
    closeLine: closeLine.text,
    closeCol: pending.closeFrom - closeLine.from,
    prevLineText: openLine.number > 1 ? doc.line(openLine.number - 1).text : null,
    ticks
  })
  if (plan === null) return false

  view.dispatch({
    changes: [
      {
        from: openLine.from + plan.openFrom,
        to: openLine.from + plan.openTo,
        insert: plan.openInsert
      },
      { from: pending.closeFrom, to: pending.closeFrom + ticks, insert: plan.closeInsert }
    ],
    selection: EditorSelection.cursor(openLine.from + plan.caret),
    userEvent: 'input.type',
    scrollIntoView: true
  })
  return true
}

/** 见文件顶部说明。注册到 `MD_EXTENSIONS` 即可。 */
export function markdownFenceInput(): Extension {
  return [
    EditorView.inputHandler.of((view, from, to, text) => {
      if (text !== '`') {
        pendingByView.delete(view)
        return false
      }
      if (
        view.composing ||
        view.compositionStarted ||
        completionStatus(view.state) === 'active' ||
        view.state.selection.ranges.length !== 1 ||
        inCodeAt(view, from) ||
        (to > from && inCodeAt(view, to - 1))
      ) {
        pendingByView.delete(view)
        return false
      }

      const now = Date.now()
      const pending = pendingByView.get(view)
      if (pending !== undefined) {
        const atCaret = from === pending.caret && to === pending.caret
        const unchanged = view.state.doc.length === pending.docLength
        if (atCaret && unchanged && now - pending.at < PENDING_TTL) {
          if (pending.ticks === 1) {
            // 第二个反引号:首尾标记各自补成两个反引号,肉眼立刻看得到这个字符;
            // 第三下再整体升级成围栏。pending 先改好再 dispatch,免得更新监听把它当失效清掉。
            const openFrom = pending.openFrom
            const closeAt = pending.caret
            pending.closeFrom = closeAt
            pending.caret = closeAt + 2
            pending.docLength = view.state.doc.length + 2
            pending.ticks = 2
            pending.at = now
            view.dispatch({
              changes: [
                { from: openFrom, insert: '`' },
                { from: closeAt, insert: '`' }
              ],
              selection: EditorSelection.cursor(closeAt + 2),
              userEvent: 'input.type',
              scrollIntoView: true
            })
            return true
          }
          pendingByView.delete(view)
          // 几何校验失败时交回默认插入,不要吞掉用户的反引号
          if (upgradeInlineFence(view, pending)) return true
          return false
        }
        pendingByView.delete(view)
      }

      const selection = view.state.selection.main
      if (to > from) {
        // 只有「输入正好覆盖当前选区」才包行内,别把奇怪的 DOM 变更也算进来
        if (from !== selection.from || to !== selection.to) return false
        wrapInlineCode(view, from, to, now)
        return true
      }

      const line = view.state.doc.lineAt(from)
      const plan = planFencePair(
        line.text,
        from - line.from,
        line.number > 1 ? view.state.doc.line(line.number - 1).text : null
      )
      if (plan === null) return false
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: plan.insert },
        selection: EditorSelection.cursor(line.from + plan.caret),
        userEvent: 'input.type',
        scrollIntoView: true
      })
      return true
    }),
    // 文档 / 光标一变就丢掉 pending,别等下一次输入才发现对不上。
    // 第一个反引号的 dispatch 发生在设置 pending 之前,所以这里不会误删。
    EditorView.updateListener.of((u) => {
      const pending = pendingByView.get(u.view)
      if (pending === undefined) return
      if (u.docChanged && u.state.doc.length !== pending.docLength) {
        pendingByView.delete(u.view)
        return
      }
      if (u.selectionSet) {
        const sel = u.state.selection
        if (sel.ranges.length !== 1 || sel.main.head !== pending.caret) {
          pendingByView.delete(u.view)
        }
      }
    })
  ]
}
