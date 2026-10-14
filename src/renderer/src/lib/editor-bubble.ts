// 选中文字时浮出的小工具条。
//
// 架构与块手柄浮层（editor-blocks.ts）同一套：**一个**浮层、读/写分相位、
// 位置写成 `transform`、状态类只挂在自己建的节点上。
//
// ⚠ 三条铁律（每一条都对应一种「看着像没做」的故障）：
//   1. **几何只在读相位取**。`ViewPlugin.update()` 里碰 `coordsAtPos` 会抛
//      「Reading the editor layout isn't allowed during an update」，
//      而插件抛异常会被 CodeMirror **销毁并永久停用** —— 症状只是「浮条再也不出现」。
//   2. **`mousedown` 必须 preventDefault**（挂在整个浮层上），否则点下去焦点离开正文 →
//      浮层自己收起 → 松手时 click 根本落不到按钮上（或者标记套到被塌陷的空选区上）。
//   3. **组字期间必须收起**。`compositionstart` 不产生任何 ViewUpdate，只认 update 标志的
//      实现会让浮条停在拼音候选窗上方一整个组字过程。

import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { getCurrentLang, makeT } from '../i18n'
import { iconNode } from './icon-dom'
import type { IconName } from './icon-paths'
import { applyWrap, stripInlineMarks, suppressSelectionBubble } from './note-marks'

const HIDDEN_CLASS = 'cm-selection-bubble-hidden'
const GAP = 6

interface BubbleAction {
  id: string
  icon: IconName
  labelKey: string
  before?: string
  after?: string
}

const ACTIONS: BubbleAction[] = [
  { id: 'bold', icon: 'bold', labelKey: 'notes.fmt.bold', before: '**' },
  { id: 'italic', icon: 'italic', labelKey: 'notes.fmt.italic', before: '*' },
  { id: 'strike', icon: 'strikethrough', labelKey: 'notes.fmt.strike', before: '~~' },
  { id: 'code', icon: 'code', labelKey: 'notes.fmt.code', before: '`' },
  { id: 'link', icon: 'link', labelKey: 'notes.fmt.link', before: '[', after: '](https://)' },
  { id: 'clear', icon: 'eraser', labelKey: 'notes.fmt.clear' }
]

interface BubbleView {
  root: HTMLElement
  key: object
}

const bubbles = new WeakMap<EditorView, BubbleView>()
/** 自己记组字状态：`compositionstart` 只改 CM 内部计数器，不产生 ViewUpdate */
const composing = new WeakSet<EditorView>()
/** 粘滞闩：块菜单「先选中整块再套格式」之后别弹；用户自己选一次就解除 */
const suppressed = new WeakSet<EditorView>()

interface BubblePlan {
  left: number
  top: number
}

function buildBubble(view: EditorView): BubbleView {
  const root = document.createElement('div')
  root.className = `cm-selection-bubble ${HIDDEN_CLASS}`
  root.tabIndex = -1
  const t = makeT(getCurrentLang())
  for (const action of ACTIONS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-bubble-btn'
    button.dataset.mark = action.id
    button.tabIndex = -1
    button.title = t(action.labelKey)
    button.setAttribute('aria-label', button.title)
    button.append(iconNode(action.icon, 15))
    root.append(button)
  }
  // 焦点与 DOM 选区都靠这一句留住 —— 见文件头第 2 条
  root.addEventListener('mousedown', (event) => event.preventDefault())
  root.addEventListener('click', (event) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-mark]')?.dataset.mark
    const action = ACTIONS.find((candidate) => candidate.id === id)
    if (action !== undefined) runAction(view, action)
  })
  view.dom.append(root)
  return { root, key: {} }
}

function runAction(view: EditorView, action: BubbleAction): void {
  if (action.id === 'clear') {
    clearMarks(view)
    return
  }
  applyWrap(view, action.before ?? '', action.after)
}

/** 清除格式：只去掉选区**内部**成对的行内标记，返回的选区落在新文本上（浮条不消失）。 */
function clearMarks(view: EditorView): void {
  const { from, to } = view.state.selection.main
  if (from === to) return
  const text = view.state.sliceDoc(from, to)
  const before = view.state.sliceDoc(Math.max(0, from - 2), from)
  const after = view.state.sliceDoc(to, Math.min(view.state.doc.length, to + 2))
  const next = stripInlineMarks(text, before, after)
  if (next === text) return
  view.dispatch({
    changes: { from, to, insert: next },
    selection: { anchor: from, head: from + next.length }
  })
  if (!view.hasFocus) view.focus()
}

/**
 * 读相位：要不要显示、显示在哪。**只能从读相位或 DOM 事件里调**。
 * 位置以选区**首行**为准 —— 多行选区的包围盒几乎等于整栏宽，拿来定位会离谱。
 */
function planBubble(view: EditorView): BubblePlan | null {
  if (suppressed.has(view) || composing.has(view) || view.compositionStarted) return null
  const sel = view.state.selection.main
  if (sel.empty || !view.hasFocus) return null
  const vp = view.viewport
  if (sel.to <= vp.from || sel.from >= vp.to) return null
  const start = view.coordsAtPos(sel.from, 1)
  if (start === null) return null
  const last = view.coordsAtPos(Math.min(sel.to, vp.to - 1), -1)
  const bubble = bubbles.get(view)
  if (bubble === undefined) return null
  const host = view.dom.getBoundingClientRect()
  const bubbleRect = bubble.root.getBoundingClientRect()
  const scroller = view.scrollDOM.getBoundingClientRect()
  const width = bubbleRect.width
  const height = bubbleRect.height
  const left = Math.min(Math.max(start.left - host.left, 0), Math.max(0, host.width - width))
  const visibleTop = Math.max(scroller.top, host.top)
  const roomAbove = start.top - visibleTop
  const top = roomAbove >= height + GAP ? start.top - host.top - height - GAP : (last ?? start).bottom - host.top + GAP
  return { left, top }
}

function applyBubble(view: EditorView, plan: BubblePlan | null): void {
  const bubble = bubbles.get(view)
  if (bubble === undefined) return
  if (plan === null) {
    bubble.root.classList.add(HIDDEN_CLASS)
    return
  }
  bubble.root.style.transform = `translate(${plan.left.toFixed(1)}px, ${plan.top.toFixed(1)}px)`
  bubble.root.classList.remove(HIDDEN_CLASS)
}

/**
 * 立即重画。**只能从 DOM 事件回调里调**（那里的读布局是允许的）。
 * ⚠ 千万别从 `ViewPlugin.update()` 调 —— 那里 `coordsAtPos` 会抛
 * 「Reading the editor layout isn't allowed during an update」，
 * 而插件抛一次异常就被 CodeMirror **销毁并永久停用**：症状只是浮条再也不出现。
 */
function repaintBubble(view: EditorView): void {
  applyBubble(view, planBubble(view))
}

/**
 * update 相位里只能排重画，不能当场读布局。
 *
 * 用**微任务**而不是 `requestMeasure`：后者的请求会被 CM 的测量循环推迟
 * （viewport 一变就整批不做，实测 6 次只跑 2 次），更新发生在这一批之后，
 * 于是「排了但永远不执行」。微任务在当前同步任务跑完、`updateState` 回到 Idle 之后执行 ——
 * 那时读布局是合法的，也不依赖 rAF（后台窗口里 rAF 会被冻住）。
 */
const pendingRepaint = new WeakSet<EditorView>()

function scheduleBubble(view: EditorView): void {
  if (pendingRepaint.has(view)) return
  pendingRepaint.add(view)
  queueMicrotask(() => {
    pendingRepaint.delete(view)
    const bubble = bubbles.get(view)
    if (bubble === undefined || !view.dom.isConnected) return
    repaintBubble(view)
  })
}

/** 选中文字浮条。与块手柄互斥（有选区时手柄自己让位）。 */
export function markdownSelectionBubble(): Extension[] {
  const plugin = ViewPlugin.fromClass(
    class {
      private readonly onResize = (): void => repaintBubble(this.view)
      constructor(private readonly view: EditorView) {
        bubbles.set(view, buildBubble(view))
        window.addEventListener('resize', this.onResize)
      }
      update(update: ViewUpdate): void {
        for (const tr of update.transactions) {
          if (tr.annotation(suppressSelectionBubble) === true) suppressed.add(update.view)
          else if (tr.isUserEvent('select')) suppressed.delete(update.view)
        }
        if (
          update.selectionSet ||
          update.docChanged ||
          update.focusChanged ||
          update.geometryChanged ||
          update.viewportChanged
        ) {
          // ⚠ 这里只能排测量，不能同步取几何（见 repaintBubble 的注释）
          scheduleBubble(update.view)
        }
      }
      destroy(): void {
        window.removeEventListener('resize', this.onResize)
        bubbles.get(this.view)?.root.remove()
        bubbles.delete(this.view)
        composing.delete(this.view)
        suppressed.delete(this.view)
      }
    }
  )
  return [
    plugin,
    // 组字：`compositionstart` 不产生事务，只能自己观察（⚠ 自己的观察者比 CM 内建的先跑，
    // 处理器里 `view.compositionStarted` 还是旧值，所以要记在自己的集合里）
    EditorView.domEventObservers({
      compositionstart: (_event, view) => {
        composing.add(view)
        repaintBubble(view)
      },
      compositionend: (_event, view) => {
        composing.delete(view)
        repaintBubble(view)
      }
    }),
    // 视口内的小幅滚动不产生任何 ViewUpdate 标志
    EditorView.domEventObservers({
      scroll: (_event, view) => {
        repaintBubble(view)
      }
    })
  ]
}
