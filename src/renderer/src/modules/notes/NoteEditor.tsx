// 笔记正文编辑器(CodeMirror 6)。
//
// 结构照 components/XmlEditor.tsx:一次性 mount、Compartment 动态重配、ref 桥接 value/onChange
// 避免外部赋值把光标顶走。几处是笔记特有的:
//   · 任务项勾选由预览触发 → 走 toggleTaskAtLine 做**定点 dispatch**,撤销栈记得到(Cmd+Z 可用);
//   · 粘贴/拖入图片 → 落盘到 assets/ 后插入相对路径引用;
//   · 滚动位置对外暴露(topLine / scrollToLine),给预览的双向同步用。
//
// ⚠ **这是源码模式,不是所见即所得。** 编辑区只做两件事:等宽字体 + 语法着色。
//   任何改变**排版**的东西都不属于这里 —— 标题不放大、不加留白、代码块不加底色、
//   引用不加竖条、正文不限宽居中。理由:一旦行高开始参差,它读起来就是「一份渲染过的文档」,
//   而用户要的是「我在改源码」。渲染是右边预览区的事。
//   字形层面(加粗/斜体/删除线)是唯一保留的例外 —— 源码编辑器(VS Code、Obsidian 源码模式)
//   都这么做,而且它们不改变行高。
//   配色词表与预览共用(lib/code-tokens.ts),同一个 `const` 在两边是同一个颜色。

import { useEffect, useImperativeHandle, useRef, type RefObject } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  placeholder as placeholderExt
} from '@codemirror/view'
import { indentUnit, syntaxHighlighting, unfoldAll } from '@codemirror/language'
import { autocompletion } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { dataSource } from '../../data'
import { cleanIpcErrorMessage } from '../../lib/ipc-error'
import { encodeNoteAssetPath } from '../../lib/note-asset'
import { languageFor } from '../../lib/code-langs'
import { TOKEN_STYLE } from '../../lib/code-tokens'
import { setBlockAlign } from '../../lib/note-align'
import { toggleTaskLine } from '../../lib/note-task'
import { showToast } from '../../lib/utils'
import { getCurrentLang, makeT } from '../../i18n'
import { calloutCompletion, calloutMarks, syntaxMarks } from './editor-marks'
import {
  handleBlockDragEnd,
  handleBlockDragOver,
  handleBlockDrop,
  isBlockDrag,
  markdownBlockFolding,
  markdownBlockGutter
} from '../../lib/editor-blocks'
import type { MarkdownBlock } from '../../lib/markdown-blocks'
import type { CalloutKind } from '../../lib/markdown'

const t = (): ((k: string) => string) => makeT(getCurrentLang())

/** 编辑器对外的命令式接口(预览勾选任务项、底部工具条排版按钮、滚动同步) */
export interface NoteEditorHandle {
  toggleTaskAtLine(line: number, next: boolean): void
  /** 在选区两侧包标记(如 `**`)。没有选区时插入标记并把光标放到中间 */
  wrapSelection(before: string, after?: string): void
  /** 给选中的每一行加前缀(如 `## ` / `- [ ] `);已有同样前缀则去掉(可切换) */
  prefixLines(prefix: string): void
  /** 在光标处插入整段文本,并把光标放到 `caretOffset` 处 */
  insertBlock(text: string, caretOffset?: number): void
  /** 在指定源码行插入文本并把光标放到插入内容内 */
  insertAtLine(line: number, text: string, caretOffset?: number): void
  /** 将光标放到指定源码行 */
  focusLine(line: number): void
  /** 选中指定源码行范围(0 起,含首尾)。块菜单的格式化按钮先选中块再套用 */
  selectLines(from: number, to: number): void
  /** 删除包含首尾的源码行范围 */
  deleteLines(from: number, to: number): void
  /** 复制包含首尾的源码行范围 */
  duplicateLines(from: number, to: number): void
  /** 将指定行转换成 ATX 标题级别 */
  setHeadingLevel(line: number, level: 1 | 2 | 3): void
  /**
   * 把 `line` 所在的引用块首行换成指定样式:普通引用 ↔ 提示块。
   * `kind` 为 null 是普通引用;提示块换类型只换标记,普通引用升级时标记独占一行。
   * 作用于**块首行** —— 解析器只认块的第一行。
   */
  setQuoteStyle(line: number, kind: CalloutKind | null): void
  /** 把 `line` 行设成指定列表标记;已是该标记则取消(变回普通行),不同标记直接替换 */
  setListMarker(line: number, marker: '- ' | '1. ' | '- [ ] '): void
  /** 整行缩进/反缩进 2 空格(列表嵌套) */
  indentLine(line: number, dir: 'in' | 'out'): void
  /** 插入一个围栏块(图表 / 网页嵌入)。自动补围栏与前后空行 —— 光标在哪都不会和上一段粘在一起 */
  insertFence(lang: string, body: string): void
  /** 整段替换若干行(含首尾)。图表的「编辑」走这里 —— 定点替换,能进撤销栈 */
  replaceLines(from: number, to: number, text: string): void
  /**
   * 把**选中的那几行**(没选区就是光标所在行)设成指定对齐。
   * `'left'` 等于去掉包裹 —— 左对齐就是 Markdown 的默认。
   */
  alignBlock(dir: 'left' | 'center' | 'right'): void
  /** 当前视口顶部的源行号(0 起) */
  topLine(): number
  /** 滚到指定行;小数部分在行内插值,同步时不会一跳一跳 */
  scrollToLine(line: number): void
  /** 清空当前会话的折叠状态(切换笔记/编辑模式时调用) */
  resetFolds(): void
  /** 滚动容器的可滚动余量,同步时用来判断「还能不能滚」 */
  scrollMetrics(): { top: number; max: number }
  /**
   * 当前选中的文本;**没有选区返回空串**。
   * 「引用到 AI」用它决定引整篇还是引这一段 —— 编辑区是源码,选中的就是原文,
   * 不需要任何转换。
   */
  selectionText(): string
  focus(): void
}

export interface NoteEditorBlockCallbacks {
  onBlockMenu?: (block: MarkdownBlock, anchor: DOMRect, line: number) => void
  onEmptyMenu?: (line: number, anchor: DOMRect) => void
}

// ── 主题 ──
//
// 源码模式的全部「版式」都在这里,一共三条:等宽字体、铺满、行高固定。
// 任何一条被打破(标题放大、给某类行加纵向留白、正文限宽居中),
// 编辑区就会开始像一份渲染过的文档 —— 那正是它不该有的样子。

const MD_THEME = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--text)',
    /*
     * 拉丁等宽 + 中文黑体。
     * 全等宽在 macOS 上做不到:中文等宽字体基本只有宋体类,深色背景上又细又碎。
     * 字体回退是**逐字符**的,所以 SF Mono 管英文与代码、Noto Sans SC 接管汉字,
     * 两边都不会被拉变形 —— Obsidian 的源码模式也是这个组合。
     */
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Noto Sans SC', monospace",
    fontSize: '13px',
    height: '100%',
    width: '100%'
  },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: 'inherit' },
  // 铺满编辑区,不限宽也不居中 —— 限宽居中那是文档版式,不是编辑器版式
  '.cm-content': {
    padding: '18px 0 200px',
    // 固定行高:所有行严格等高,代码块与标题都不例外
    lineHeight: '1.6',
    caretColor: 'var(--accent2)'
  },
  '.cm-line': { padding: '0 22px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent2)', borderLeftWidth: '2px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': { display: 'flex', backgroundColor: 'transparent', border: 'none' },
  '.cm-gutter': { backgroundColor: 'transparent' },
  '.cm-activeLine': { backgroundColor: 'var(--wash-accent)' },
  '.cm-selectionLayer .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
    { backgroundColor: 'var(--wash-accent)' },
  '.cm-placeholder': { color: 'var(--dim)', fontStyle: 'normal' }
})

/** 快捷键与按钮共用同一套包裹逻辑 */
function wrap(view: EditorView, before: string, after?: string): void {
  const tail = after ?? before
  const { from, to } = view.state.selection.main
  const sel = view.state.sliceDoc(from, to)
  view.dispatch({
    changes: { from, to, insert: `${before}${sel}${tail}` },
    selection:
      sel === ''
        ? { anchor: from + before.length }
        : { anchor: from, head: from + before.length + sel.length + tail.length }
  })
}

const MD_EXTENSIONS: Extension[] = [
  // `base: markdownLanguage` 才带 GFM(表格 / 任务清单 / 删除线)。
  // 默认的 commonmarkLanguage **不认表格** —— 预览里渲染成表格、编辑区里却是一堆竖线。
  // codeLanguages:围栏里的代码在编辑器里也高亮,且与预览共用同一套 token 配色。
  markdown({ base: markdownLanguage, codeLanguages: (info) => languageFor(info) }),
  syntaxHighlighting(TOKEN_STYLE),
  // 语法树没覆盖到的那几处(表格分隔符 / 表头 / 任务标记)与提示块标记 ——
  // 只有着色,不改变行高,见 editor-marks.ts 顶部
  syntaxMarks,
  calloutMarks,
  // 输入 `> ` 后提示五种提示块(GitHub / Obsidian 的 `> [!NOTE]`)
  autocompletion({ override: [calloutCompletion((kind) => t()(`notes.callout.${kind}`))] }),
  EditorView.lineWrapping
]

export function NoteEditor({
  value,
  onChange,
  handleRef,
  placeholder,
  onScroll,
  onBlockMenu,
  onEmptyMenu
}: {
  value: string
  onChange: (v: string) => void
  handleRef?: RefObject<NoteEditorHandle | null>
  placeholder?: string
  /** 编辑器滚动。滚动同步由调用方接,编辑器本身不知道预览的存在 */
  onScroll?: () => void
  onBlockMenu?: (block: MarkdownBlock, anchor: DOMRect, line: number) => void
  onEmptyMenu?: (line: number, anchor: DOMRect) => void
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 外部 value 变化(切笔记 / 冲突用磁盘版本)→ 替换文档;内部输入不回灌(避免光标跳动)
  const externalValue = useRef(value)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onScrollRef = useRef(onScroll)
  onScrollRef.current = onScroll
  const onBlockMenuRef = useRef(onBlockMenu)
  onBlockMenuRef.current = onBlockMenu
  const onEmptyMenuRef = useRef(onEmptyMenu)
  onEmptyMenuRef.current = onEmptyMenu

  useImperativeHandle(
    handleRef,
    () => ({
      toggleTaskAtLine(line, next) {
        const view = viewRef.current
        if (!view) return
        if (!Number.isInteger(line) || line < 0 || line >= view.state.doc.lines) return
        const l = view.state.doc.line(line + 1) // CodeMirror 的行号是 1 起
        // 复用共享的纯函数:把单行当「第 0 行」传进去
        const updated = toggleTaskLine(l.text, 0, next)
        if (updated === null) return
        // 定点替换:只动这一行 —— history 记得到,且不会清空撤销栈(整体替换文档会)
        view.dispatch({ changes: { from: l.from, to: l.to, insert: updated } })
      },

      wrapSelection(before, after) {
        const view = viewRef.current
        if (!view) return
        const tail = after ?? before
        const { from, to } = view.state.selection.main
        const sel = view.state.sliceDoc(from, to)
        view.dispatch({
          changes: { from, to, insert: `${before}${sel}${tail}` },
          selection:
            sel === ''
              ? { anchor: from + before.length } // 空选区:光标停在标记中间,直接接着打
              : { anchor: from, head: from + before.length + sel.length + tail.length }
        })
        view.focus()
      },

      prefixLines(prefix) {
        const view = viewRef.current
        if (!view) return
        const { from, to } = view.state.selection.main
        const first = view.state.doc.lineAt(from).number
        const last = view.state.doc.lineAt(to).number
        const changes: { from: number; to: number; insert: string }[] = []
        for (let n = first; n <= last; n++) {
          const line = view.state.doc.line(n)
          // 已经有同样前缀 → 去掉。按钮因此是「切换」而不是「越点越多」
          if (line.text.startsWith(prefix)) {
            changes.push({ from: line.from, to: line.from + prefix.length, insert: '' })
          } else {
            changes.push({ from: line.from, to: line.from, insert: prefix })
          }
        }
        view.dispatch({ changes })
        view.focus()
      },

      insertBlock(text, caretOffset) {
        const view = viewRef.current
        if (!view) return
        const at = view.state.selection.main.from
        view.dispatch({
          changes: { from: at, insert: text },
          selection: { anchor: at + (caretOffset ?? text.length) }
        })
        view.focus()
      },

      insertAtLine(line, text, caretOffset) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const n = Math.min(Math.max(line, 0), doc.lines - 1)
        const at = doc.line(n + 1).from
        view.dispatch({
          changes: { from: at, insert: text },
          selection: { anchor: at + Math.min(caretOffset ?? text.length, text.length) }
        })
        view.focus()
      },

      focusLine(line) {
        const view = viewRef.current
        if (!view) return
        const n = Math.min(Math.max(line, 0), view.state.doc.lines - 1)
        view.dispatch({ selection: { anchor: view.state.doc.line(n + 1).from } })
        view.focus()
      },

      selectLines(from, to) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const a = Math.min(Math.max(from, 0), doc.lines - 1)
        const b = Math.min(Math.max(to, a), doc.lines - 1)
        const anchor = doc.line(a + 1).from
        const head = doc.line(b + 1).to
        view.dispatch({ selection: { anchor, head } })
        view.focus()
      },

      deleteLines(from, to) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const a = Math.min(Math.max(from, 0), doc.lines - 1)
        const b = Math.min(Math.max(to, a), doc.lines - 1)
        const start = doc.line(a + 1).from
        const end = b < doc.lines - 1 ? doc.line(b + 2).from : doc.length
        view.dispatch({ changes: { from: start, to: end, insert: '' }, selection: { anchor: start } })
        view.focus()
      },

      duplicateLines(from, to) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const a = Math.min(Math.max(from, 0), doc.lines - 1)
        const b = Math.min(Math.max(to, a), doc.lines - 1)
        const start = doc.line(a + 1).from
        const end = doc.line(b + 1).to
        const source = doc.sliceString(start, end)
        view.dispatch({
          changes: { from: end, insert: `\n${source}` },
          selection: { anchor: end + source.length + 1 }
        })
        view.focus()
      },

      setHeadingLevel(line, level) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const n = Math.min(Math.max(line, 0), doc.lines - 1)
        const current = doc.line(n + 1)
        const match = /^( {0,3})#{1,6}(?:[ \t]+|$)/.exec(current.text)
        const indent = match?.[1] ?? ''
        const content = match === null ? current.text : current.text.slice(match[0].length)
        const next = `${indent}${'#'.repeat(level)} ${content}`
        view.dispatch({ changes: { from: current.from, to: current.to, insert: next }, selection: { anchor: current.from + next.length } })
        view.focus()
      },

      setQuoteStyle(line, kind) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const n = Math.min(Math.max(line, 0), doc.lines - 1)
        const cur = doc.line(n + 1)
        const m = /^(\s*)>\s?(.*)$/.exec(cur.text)
        if (m === null) return
        const indent = m[1]
        const cm = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i.exec(m[2])
        const hasCallout = cm !== null
        const rest = cm !== null ? cm[2] : m[2]
        // 提示块标记只认块首行,调用方传的就是 block.from
        if (kind === null) {
          if (!hasCallout) return
          if (rest.trim() === '') {
            // 标记独占一行 → 整行删掉(含换行),后面的 > 行自然成为新块首
            if (n + 1 >= doc.lines) {
              view.dispatch({ changes: { from: cur.from, to: cur.to, insert: `${indent}>`.trimEnd() || '>' } })
            } else {
              view.dispatch({ changes: { from: cur.from, to: doc.line(n + 2).from, insert: '' } })
            }
          } else {
            view.dispatch({ changes: { from: cur.from, to: cur.to, insert: `${indent}> ${rest}` } })
          }
        } else {
          const tag = `> [!${kind.toUpperCase()}]`
          if (hasCallout) {
            view.dispatch({ changes: { from: cur.from, to: cur.to, insert: `${indent}${tag}${rest === '' ? '' : ` ${rest}`}` } })
          } else if (rest.trim() === '') {
            view.dispatch({ changes: { from: cur.from, to: cur.to, insert: `${indent}${tag}` } })
          } else {
            // 普通引用升级:标记独占一行,原文本下移一行 —— 与示例笔记的写法一致
            view.dispatch({ changes: { from: cur.from, to: cur.to, insert: `${indent}${tag}\n${indent}> ${rest}` } })
          }
        }
        view.focus()
      },

      setListMarker(line, marker) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const n = Math.min(Math.max(line, 0), doc.lines - 1)
        const cur = doc.line(n + 1)
        const m = /^(\s*)(?:[-+*] |\d+[.)] |[-+*] \[[ xX]\] )?/.exec(cur.text)
        const indent = m?.[1] ?? ''
        const current = m?.[0].slice(indent.length) ?? ''
        const rest = cur.text.slice(indent.length + current.length)
        const insert = current === marker ? `${indent}${rest}` : `${indent}${marker}${rest}`
        view.dispatch({ changes: { from: cur.from, to: cur.to, insert } })
        view.focus()
      },

      indentLine(line, dir) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const n = Math.min(Math.max(line, 0), doc.lines - 1)
        const cur = doc.line(n + 1)
        if (dir === 'in') {
          view.dispatch({ changes: { from: cur.from, to: cur.from, insert: '  ' } })
        } else {
          const m = /^(?: {1,2}|\t)/.exec(cur.text)
          if (m !== null) view.dispatch({ changes: { from: cur.from, to: cur.from + m[0].length, insert: '' } })
        }
        view.focus()
      },

      insertFence(lang, body) {
        const view = viewRef.current
        if (!view) return
        const at = view.state.selection.main.from
        // 前后空行:Markdown 里围栏必须自成一块,否则会粘进上一段变成行内代码。
        // 已经在段首/文首就不重复补。
        const before = view.state.sliceDoc(0, at)
        const lead = before === '' ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
        const block = `${lead}\`\`\`${lang}\n${body.trim()}\n\`\`\`\n`
        view.dispatch({
          changes: { from: at, insert: block },
          selection: { anchor: at + block.length }
        })
        view.focus()
      },

      replaceLines(from, to, text) {        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const a = Math.min(Math.max(from, 0), doc.lines - 1)
        const b = Math.min(Math.max(to, a), doc.lines - 1)
        const start = doc.line(a + 1).from
        const end = doc.line(b + 1).to
        view.dispatch({
          changes: { from: start, to: end, insert: text },
          selection: { anchor: start + text.length }
        })
        view.focus()
      },

      alignBlock(dir) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const { from, to } = view.state.selection.main
        const next = setBlockAlign(doc.toString(), doc.lineAt(from).number - 1, doc.lineAt(to).number - 1, dir)
        if (next === null) return
        // 整篇替换:CodeMirror 的 history 照常记得到,一次 Cmd+Z 就能整体撤销
        view.dispatch({ changes: { from: 0, to: doc.length, insert: next }, selection: { anchor: 0 } })
        view.focus()
      },

      resetFolds() {
        const view = viewRef.current
        if (!view) return
        unfoldAll(view)
      },

      topLine() {
        const view = viewRef.current
        if (!view) return 0
        const box = view.scrollDOM.getBoundingClientRect()
        // 取视口顶端稍下一点的位置:正好在边界上时 posAtCoords 会返回 null
        const pos = view.posAtCoords({ x: box.left + 12, y: box.top + 2 })
        if (pos === null) return 0
        return view.state.doc.lineAt(pos).number - 1
      },

      scrollToLine(line) {
        const view = viewRef.current
        if (!view) return
        const doc = view.state.doc
        const whole = Math.floor(line)
        const n = Math.min(Math.max(whole, 0), doc.lines - 1)
        const block = view.lineBlockAt(doc.line(n + 1).from)
        view.scrollDOM.scrollTop = block.top + (line - whole) * block.height
      },

      scrollMetrics() {
        const el = viewRef.current?.scrollDOM
        if (!el) return { top: 0, max: 0 }
        return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight }
      },

      selectionText() {
        const view = viewRef.current
        if (!view) return ''
        const { from, to } = view.state.selection.main
        // 光标(空选区)不算选中:那会让「引用整篇」变成「引用 0 个字」
        return from === to ? '' : view.state.sliceDoc(from, to)
      },

      focus() {
        viewRef.current?.focus()
      }
    }),
    []
  )

  useEffect(() => {
    if (!hostRef.current) return

    /** 粘贴/拖入的图片 → 落盘到 assets/,在光标处插入相对路径引用 */
    async function insertImages(view: EditorView, files: File[]): Promise<void> {
      for (const f of files) {
        try {
          const data = await f.arrayBuffer()
          const { relPath } = await dataSource().notes.saveAsset({
            fileName: f.name !== '' ? f.name : 'pasted.png',
            data
          })
          const at = view.state.selection.main.from
          // 编码后再写:CommonMark 的链接地址不允许裸空格,而附件名是
          // `Pasted image 20261009150211.png`。编码一次 Obsidian 与 GitHub 都能开,
          // 解析侧两种写法都收,所以用户手写的旧引用照样渲染。
          const snippet = `![](${encodeNoteAssetPath(relPath)})`
          view.dispatch({
            changes: { from: at, insert: snippet },
            selection: { anchor: at + snippet.length }
          })
        } catch (err) {
          showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
        }
      }
    }

    const imagesOf = (dt: DataTransfer | null): File[] =>
      dt === null ? [] : [...dt.files].filter((f) => f.type.startsWith('image/'))

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          MD_EXTENSIONS,
          // gutter 顺序 = 视觉左右顺序：拖动手柄在左，折叠箭头在右（飞书风格）
          markdownBlockGutter({
            onBlockMenu: (block, anchor, line) => onBlockMenuRef.current?.(block, anchor, line),
            onEmptyMenu: (line, anchor) => onEmptyMenuRef.current?.(line, anchor)
          }),
          markdownBlockFolding(),
          indentUnit.of('  '),
          history(),
          drawSelection(),
          highlightActiveLine(),
          keymap.of(defaultKeymap),
          keymap.of(historyKeymap),
          // 排版快捷键:与底部工具条按钮的 tooltip 一一对应。
          // 只挑三个不会与系统/CodeMirror 默认键位打架的(Mod-e 是 macOS 的「用所选内容查找」,不碰)
          keymap.of([
            { key: 'Mod-b', run: (v) => { wrap(v, '**'); return true } },
            { key: 'Mod-i', run: (v) => { wrap(v, '*'); return true } },
            { key: 'Mod-k', run: (v) => { wrap(v, '[', '](https://)'); return true } }
          ]),
          EditorView.domEventHandlers({
            dragover: (e, v) => handleBlockDragOver(v, e),
            dragend: (e, v) => handleBlockDragEnd(v, e),
            paste: (e, v) => {
              const files = imagesOf(e.clipboardData)
              if (files.length === 0) return false // 普通文本粘贴照旧交给 CodeMirror
              e.preventDefault()
              void insertImages(v, files)
              return true
            },
            drop: (e, v) => {
              if (isBlockDrag(v)) return handleBlockDrop(v, e)
              const files = imagesOf(e.dataTransfer)
              if (files.length === 0) return false
              e.preventDefault()
              void insertImages(v, files)
              return true
            }
          }),
          MD_THEME,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              externalValue.current = u.state.doc.toString()
              onChangeRef.current(externalValue.current)
            }
          }),
          EditorView.domEventHandlers({
            scroll: () => {
              onScrollRef.current?.()
              return false
            }
          }),
          placeholder !== undefined && placeholder !== '' ? placeholderExt(placeholder) : []
        ].flat()
      })
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 仅挂载一次;value/onChange 经 ref 桥接
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value !== externalValue.current) {
      externalValue.current = value
      /*
       * ⚠ 整篇替换会把**光标与滚动位置一起挤到开头** —— 然后滚动联动把预览也拖到顶部。
       * 触发路径很日常:在预览里拖完表格列宽 → 回写换掉正文 → 这里整篇替换 → 编辑区跳到顶部
       * → `onEditorScroll` → 预览跟着跳。用户报过:「编辑+预览模式下拖完表格,页面回到最上面」。
       * 所以替换前后把这两样按原样放回去(长度变了就夹一下)。
       */
      const prevTop = view.scrollDOM.scrollTop
      const sel = view.state.selection.main
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
      const len = view.state.doc.length
      view.dispatch({
        selection: { anchor: Math.min(sel.anchor, len), head: Math.min(sel.head, len) }
      })
      view.scrollDOM.scrollTop = prevTop
    }
  }, [value])

  return <div className="note-editor-host" ref={hostRef} />
}
