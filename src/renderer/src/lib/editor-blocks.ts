import { type EditorState, type Extension, type Text } from '@codemirror/state'
import {
  codeFolding,
  foldEffect,
  foldedRanges,
  foldService,
  unfoldEffect
} from '@codemirror/language'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { getCurrentLang, makeT } from '../i18n'
import { hasTextSelection } from './note-marks'
import { blockIcon, caretIcon, dragIcon, headingText, plusIcon } from './block-icons'
import { blockTypeLabelKey } from './block-labels'
import {
  blockContainsLine,
  blockOwnersByLine,
  canDropBeside,
  inSameDropScope,
  isMarkdownBlockDraggable,
  isMarkdownBlockFoldable,
  isTopLevelScoped,
  narrowestBlockAtLine,
  permutationOffsets,
  parseMarkdownBlocks,
  reorderMarkdownBlocks,
  resolveDropAnchor,
  type BlockSlot,
  type DropSlot,
  type MarkdownBlock
} from './markdown-blocks'
import {
  crossSectionMoveSlot,
  foldSpansOf,
  locateBlock,
  matchBlockAfterMove,
  resolveFoldSpans,
  resolveMoveTarget,
  siblingMoveSlot,
  type BlockLocator,
  type BlockMoveStatus,
  type BlockMoveTarget
} from './block-move'
import {
  buildOutlineEntries,
  destinationForSlot,
  type OutlineEntry
} from './block-outline'

export interface MarkdownBlockEditorCallbacks {
  onBlockMenu?: (block: MarkdownBlock, anchor: DOMRect, line: number) => void
  onEmptyMenu?: (line: number, anchor: DOMRect) => void
}

// ── 解析备忘 ──
//
// `state.doc` 是持久化数据结构 —— 同一份内容就是同一个对象，所以按对象身份缓存既正确
// 又免费。折叠服务会对**每一行**问一次，没有这层备忘就是每行重解析整篇。

const blockCache = new WeakMap<Text, MarkdownBlock[]>()
const ownerCache = new WeakMap<Text, Map<number, MarkdownBlock>>()

function blocksOf(doc: Text): MarkdownBlock[] {
  let blocks = blockCache.get(doc)
  if (blocks === undefined) {
    blocks = parseMarkdownBlocks(doc.toString())
    blockCache.set(doc, blocks)
  }
  return blocks
}

/**
 * 行 → 归属块（最内层）。用来决定「这一行的手柄/菜单/折叠属于哪个块」。
 * ⚠ **悬停底色不用它** —— 底色要盖住块的完整范围（含子内容），用 `blockContainsLine`。
 */
function ownersOf(doc: Text): Map<number, MarkdownBlock> {
  let owners = ownerCache.get(doc)
  if (owners === undefined) {
    owners = blockOwnersByLine(blocksOf(doc))
    ownerCache.set(doc, owners)
  }
  return owners
}

// ── 折叠 ──

/** 该块可折叠时的折叠区间，否则 null。 */
function foldRangeOf(state: EditorState, block: MarkdownBlock | undefined): { from: number; to: number } | null {
  if (block === undefined || !isMarkdownBlockFoldable(block)) return null
  const from = state.doc.line(block.from + 1).to
  // Fold through the last meaningful line, not through the newline before the
  // next block. Leaving that newline outside the range keeps the next block on
  // its own line after CodeMirror inserts the fold placeholder.
  const lastContentLine = Math.min(Math.max(block.contentTo, 1), state.doc.lines)
  const to = state.doc.line(lastContentLine).to
  return to > from ? { from, to } : null
}

function blockRange(state: EditorState, lineStart: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart)
  return foldRangeOf(state, blocksOf(state.doc).find((candidate) => candidate.from === line.number - 1))
}

function isFoldedAt(state: EditorState, from: number): boolean {
  let folded = false
  foldedRanges(state).between(from, from, (rangeFrom) => {
    if (rangeFrom === from) {
      folded = true
      return false
    }
    return
  })
  return folded
}

/** Our parser takes precedence over Markdown's default heading-only fold service. */
export const markdownBlockFoldService = foldService.of((state, lineStart) => blockRange(state, lineStart))

function toggleBlockFold(view: EditorView, lineStart: number): boolean {
  const range = blockRange(view.state, lineStart)
  if (range === null) return false
  const effect = isFoldedAt(view.state, range.from) ? unfoldEffect : foldEffect
  view.dispatch({ effects: effect.of(range) })
  return true
}

// ── DOM 小工具 ──

function lineElement(view: EditorView, line: number): HTMLElement | null {
  if (line < 0 || line >= view.state.doc.lines) return null
  const pos = view.state.doc.line(line + 1).from
  let node: Node | null = view.domAtPos(pos).node
  while (node !== null) {
    if (node instanceof HTMLElement && node.classList.contains('cm-line')) return node
    node = node.parentNode
  }
  return null
}

// ── 手柄浮层 ──
//
// 整个编辑区只有**一个**手柄，绝对定位挂在 `view.dom` 上（CM 的 MutationObserver 只盯
// contentDOM，挂在外面不会被它量到）。位置写成 `transform: translateY()`，配一段过渡 ——
// 鼠标换行时手柄是从上一行**滑**过去的。之前每行一个 gutter marker 的写法做不到这一点，
// 结构上只能「这行消失、那行出现」；飞书也是浮层。

interface HandleView {
  root: HTMLElement
  pill: HTMLElement
  badge: HTMLElement
  caretSlot: HTMLElement
  /** requestMeasure 的去重键 */
  key: object
}

const handleViews = new WeakMap<EditorView, HandleView>()
const hoverLines = new WeakMap<EditorView, number>()
const pinnedLines = new WeakMap<EditorView, number>()

const HIDDEN_CLASS = 'cm-block-handle-hidden'
const PILL_HEIGHT = 26
/** 胶囊宽度（与 CSS 里的 .cm-block-pill 对齐）—— 「+」按钮的右边界要跟它对齐 */
const PILL_WIDTH = 42
const EMPTY_INSERT_SIZE = 20

/**
 * 拖拽标志挂这里，**不要挂 `view.dom`** —— CM 的 `updateAttrs` 会重写
 * `view.dom` / `contentDOM` 的 class 与 style，挂上去中途就被抹掉了。
 * 父节点是 React 渲染的 `.note-editor-host`，CM 不碰。
 */
function dragFlagHost(view: EditorView): HTMLElement | null {
  return view.dom.parentElement
}

interface HandlePlan {
  line: number
  block: MarkdownBlock
  /** 相对编辑器顶边的纵坐标（胶囊垂直居中在那一行上） */
  top: number
  foldFrom: number | null
}

function buildHandle(view: EditorView, callbacks: MarkdownBlockEditorCallbacks): HandleView {
  const root = document.createElement('div')
  root.className = 'cm-block-handle cm-block-handle-hidden'

  const pill = document.createElement('div')
  pill.className = 'cm-block-pill'
  const badge = document.createElement('span')
  badge.className = 'cm-block-type'
  const grip = document.createElement('span')
  grip.className = 'cm-block-grip'
  grip.append(dragIcon())
  pill.append(badge, grip)

  const caretSlot = document.createElement('span')
  caretSlot.className = 'cm-block-caret-slot'
  root.append(pill, caretSlot)

  // 整颗胶囊都是拖拽入口（含类型徽标与抓手）—— 与飞书一致。
  // 用指针事件而不是原生 DnD：胶囊为了「点击不抢焦点」必须 preventDefault(pointerdown)，
  // 而那正好会掐掉原生 dragstart（以前只有 14px 的抓手能拖，按胶囊本体看起来就是拖不动）。
  pill.addEventListener('pointerdown', (event) => beginPillPress(view, event, callbacks, pill))
  caretSlot.addEventListener('click', (event) => {
    const line = hoverLines.get(view)
    const block = line === undefined ? undefined : ownersOf(view.state.doc).get(line)
    if (block === undefined) return
    event.stopPropagation()
    toggleBlockFold(view, view.state.doc.line(block.from + 1).from)
  })

  view.dom.append(root)
  return { root, pill, badge, caretSlot, key: {} }
}

/** 读相位：算出「手柄该长在哪儿、长什么样」。不写 DOM。 */
function planHandle(view: EditorView): HandlePlan | null {
  // 拖拽中手柄让位给跟手卡片 —— 它停在源块处会被源行位移带得对不上
  if (dragStates.has(view)) return null
  // 有选区时手柄让位给选区浮条 —— 两者同处左侧那 60px，会打架（与空行同理）
  if (hasTextSelection(view.state)) return null
  const doc = view.state.doc
  const pinned = pinnedLines.get(view)
  const line = pinned ?? hoverLines.get(view)
  if (line === undefined || line < 0 || line >= doc.lines) return null

  // 空行显示的是「+ 插入」而不是手柄（两者同处左侧那 60px，会打架）
  const empty = doc.line(line + 1).text.trim() === ''
  if (empty && pinned === undefined) return null

  const block = ownersOf(doc).get(line)
  if (block === undefined) return null
  const el = lineElement(view, line)
  if (el === null) return null
  const lineRect = el.getBoundingClientRect()
  const hostRect = view.dom.getBoundingClientRect()
  // 折叠三角只画在**块的首行**：多行块首行有（点它折整块），其余行与单行块都没有。
  // 以前每行都出三角，一个 10 行代码块就是十个一模一样的箭头，纯噪音。
  const foldFrom = line === block.from ? (foldRangeOf(view.state, block)?.from ?? null) : null
  // 折行时行元素有好几行高，胶囊要贴**第一行**（不然会浮在两行之间）——
  // 行高从计算样式读（一行的高度），别用元素高度。
  const rowHeight = Number.parseFloat(window.getComputedStyle(el).lineHeight) || lineRect.height
  return {
    line,
    block,
    top: lineRect.top - hostRect.top + (rowHeight - PILL_HEIGHT) / 2,
    foldFrom
  }
}

/** 写相位：把 plan 落到 DOM 上。 */
function applyHandle(view: EditorView, plan: HandlePlan | null): void {
  const handle = handleViews.get(view)
  if (handle === undefined) return
  const t = makeT(getCurrentLang())

  if (plan === null) {
    handle.root.classList.add(HIDDEN_CLASS)
    paintHoverWash(view, null)
    return
  }

  const collapsed = plan.foldFrom !== null && isFoldedAt(view.state, plan.foldFrom)
  handle.badge.replaceChildren(
    plan.block.kind === 'heading' ? document.createTextNode(headingText(plan.block.level)) : blockIcon(plan.block)
  )
  handle.caretSlot.replaceChildren()
  if (plan.foldFrom !== null) {
    const caret = document.createElement('button')
    caret.type = 'button'
    caret.className = 'cm-block-caret'
    caret.title = t(collapsed ? 'notes.editor.expand' : 'notes.editor.collapse')
    caret.setAttribute('aria-label', caret.title)
    caret.append(caretIcon(collapsed))
    handle.caretSlot.append(caret)
  }

  handle.pill.title = t('notes.editor.dragBlock')
  handle.pill.dataset.blockId = String(plan.block.id)
  handle.root.style.transform = `translateY(${plan.top.toFixed(1)}px)`
  handle.root.classList.remove(HIDDEN_CLASS)
  paintHoverWash(view, plan.block)
}

/**
 * 焦点在当前块里时不要铺整块 hover 背景。
 *
 * 输入（尤其中文组字）会让 CodeMirror 重建行 DOM；如果每次 update 都把
 * `.cm-block-hovered` 全删再全加，键盘候选窗/布局变化时中间会露出无背景的一帧，
 * 表现就是整块背景跟着输入闪动。输入期间只保留当前行已有的 `.cm-activeLine` 高亮，
 * 失焦或悬停另一块时再恢复整块背景。
 */
export function suppressBlockWash(hasFocus: boolean, selectionLine: number, block: MarkdownBlock): boolean {
  return hasFocus && blockContainsLine(block, selectionLine)
}

/**
 * 鼠标停在哪一块，那一块就加一层极淡底色 —— 一眼看出手柄属于谁。
 *
 * 判据是块的**完整范围** `[from, contentTo)`（含子树），不是「行归属」：
 * 归属取最内层块（标题子树里的正文归属各自的段落/列表），拿它来上色的话，
 * 悬停标题时只有标题行和没人认领的空白行会亮，正文反而不会 —— 用户报的就是这个。
 * 高亮 / 拖拽 / 折叠现在用同一个范围。
 */
function paintHoverWash(view: EditorView, block: MarkdownBlock | null): void {
  // 每次都重扫、重挂，**不做「同一个块跳过」的缓存**：行 DOM 会被 CodeMirror 重建
  // （同步文档、视口变化…），inline class 随之丢失；缓存的「已经画过」会让我们
  // 再也不补，表现就是「有时亮有时不亮」。行数很少，重扫的代价可以忽略。
  view.dom.querySelectorAll<HTMLElement>('.cm-line.cm-block-hovered').forEach((el) => {
    el.classList.remove('cm-block-hovered')
  })
  if (block === null) return
  const selectionLine = view.state.doc.lineAt(view.state.selection.main.head).number - 1
  if (suppressBlockWash(view.hasFocus, selectionLine, block)) return
  view.dom.querySelectorAll<HTMLElement>('.cm-line').forEach((el) => {
    const index = view.state.doc.lineAt(view.posAtDOM(el, 0)).number - 1
    if (blockContainsLine(block, index)) el.classList.add('cm-block-hovered')
  })
}

/**
 * 立即重画（mousemove / 滚动 / 折叠 / 钉住变化走这条，反馈不延迟一帧）。
 * 只读 DOM 矩形与 `domAtPos` —— 这两个在 CM 的 update 相位里也允许，
 * 但**不要**在这里碰 `coordsAtPos`/`posAtCoords`：那会抛异常，而插件抛一次就被永久停用。
 */
function repaintHandle(view: EditorView): void {
  applyHandle(view, planHandle(view))
}

/**
 * update 相位里只能排重画，不能当场读布局（`coordsAtPos` 会抛，插件抛一次就被永久停用）。
 * 用微任务而不是 `requestMeasure`：后者的请求会被 CM 的测量循环推迟（viewport 一变整批不做），
 * 而微任务在 `updateState` 回到 Idle 之后、当前同步任务末尾执行 —— 既合法又不依赖 rAF。
 */
function scheduleHandle(view: EditorView): void {
  if (pendingRepaint.has(view)) return
  pendingRepaint.add(view)
  queueMicrotask(() => {
    pendingRepaint.delete(view)
    if (!handleViews.has(view) || !view.dom.isConnected) return
    repaintHandle(view)
  })
}

/** 菜单开着时把手柄钉在那一行（`null` 解除）——鼠标移进菜单也不收起。 */
export function setPinnedLine(view: EditorView, line: number | null): void {
  if (line === null) pinnedLines.delete(view)
  else pinnedLines.set(view, line)
  repaintHandle(view)
}

// ── 悬停 ──

function setHoverLine(view: EditorView, line: number): void {
  const unchanged = hoverLines.get(view) === line
  hoverLines.set(view, line)
  // 同一行也要在「高亮丢了」时重画：切笔记 / 整篇替换会把行 DOM 换掉、class 随之消失，
  // 而 hoverLines 记的行号可能刚好没变（比如鼠标一直停在第 3 行，换了篇笔记还是第 3 行）
  if (!unchanged || view.dom.querySelector('.cm-line.cm-block-hovered') === null) repaintHandle(view)
}

function clearHover(view: EditorView): void {
  if (hoverLines.get(view) === undefined) return
  hoverLines.delete(view)
  repaintHandle(view)
}

/** 指针仍在编辑器里（正文 → 左侧手柄 → 再加号）就别清悬停态。 */
function staysInsideEditor(view: EditorView, event: Event): boolean {
  const next = (event as MouseEvent).relatedTarget
  return next instanceof Node && view.dom.contains(next)
}

function removeEmptyInsert(view: EditorView): void {
  view.dom.querySelector('.cm-empty-insert')?.remove()
}

function updateEmptyInsertAtLine(
  view: EditorView,
  lineNumber: number,
  callback?: (line: number, anchor: DOMRect) => void
): void {
  const docLine = view.state.doc.line(lineNumber + 1)
  if (docLine.text.trim() !== '') {
    removeEmptyInsert(view)
    return
  }
  const line = lineElement(view, lineNumber)
  if (line === null) return
  const editorRect = view.dom.getBoundingClientRect()
  const lineRect = line.getBoundingClientRect()
  let button = view.dom.querySelector<HTMLButtonElement>('.cm-empty-insert')
  if (button === null) {
    button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-empty-insert'
    button.title = makeT(getCurrentLang())('notes.editor.insert')
    button.setAttribute('aria-label', button.title)
    button.append(plusIcon())
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const currentLine = Number(button?.dataset.line)
      if (Number.isInteger(currentLine)) callback?.(currentLine, button!.getBoundingClientRect())
    })
    view.dom.append(button)
  }
  button.dataset.line = String(lineNumber)
  button.style.top = `${lineRect.top - editorRect.top}px`
  // 右对齐：右边界与胶囊（42px）齐平，而不是贴编辑器左边缘
  button.style.left = `${PILL_WIDTH - EMPTY_INSERT_SIZE}px`
}

/**
 * 指针在哪一行 —— **用 DOM 命中测试**，不用 `posAtCoords`。
 *
 * `posAtCoords` 走 CodeMirror 的高度表（只有量过的行是准的，其余是估算），长笔记里
 * 误差会累积：实测在 551 行的示例笔记里，点第 6 行光标落到第 9 行，越往下越偏。
 * 那是 CM 自己的判定，改不了；但我们可以绕开它 —— `elementFromPoint` 一次命中，
 * 再用 `posAtDOM`（读文档结构，不读几何）换出行号，任何时候都准。
 *
 * 指针停在浮层自己身上时命中的是浮层 → 返回 null，调用方保留上一次的行（正合期望：
 * 从正文移到手柄上不该让它跳走）。
 */
function lineAtPoint(view: EditorView, x: number, y: number): number | null {
  const hit = document.elementFromPoint(x, y)
  const lineEl = hit instanceof HTMLElement ? hit.closest('.cm-line') : null
  if (lineEl === null) return null
  const line = view.state.doc.lineAt(view.posAtDOM(lineEl, 0)).number - 1
  return line >= 0 && line < view.state.doc.lines ? line : null
}

function updateToolHover(view: EditorView, event: MouseEvent, callbacks: MarkdownBlockEditorCallbacks): void {
  // 拖拽中指针位置只用来决定落点，别再改悬停行（手柄已隐藏）
  if (dragStates.has(view)) return
  const lineNumber = lineAtPoint(view, event.clientX, event.clientY)
  if (lineNumber === null) {
    // 指针在浮层自己身上（或编辑器之外）—— 保留当前行，别让它跳
    return
  }
  setHoverLine(view, lineNumber)
  updateEmptyInsertAtLine(view, lineNumber, callbacks.onEmptyMenu)
}

function markdownBlockHover(callbacks: MarkdownBlockEditorCallbacks): Extension {
  return [
    EditorView.domEventObservers({
      mousemove: (event, view) => updateToolHover(view, event as MouseEvent, callbacks),
      mouseleave: (event, view) => {
        // 拖拽中指针离开了正文也不算「悬停结束」—— 落点由拖拽状态自己管
        if (dragStates.has(view)) return
        // 鼠标只是走到左边的手柄浮层上不算离开 —— 否则整组会闪掉
        if (staysInsideEditor(view, event)) return
        clearHover(view)
        removeEmptyInsert(view)
      }
    }),
    ViewPlugin.fromClass(
      class {
        private readonly onResize = (): void => {
          repaintHandle(this.view)
          // 分屏拖动 / 窗口缩小时,大纲要跟着换位置;落点也要按新滚动区重判
          const drag = dragStates.get(this.view)
          if (drag !== undefined && drag.outline !== null) {
            positionOutline(this.view, drag)
            retargetDrag(this.view, drag)
          }
        }
        constructor(private readonly view: EditorView) {
          handleViews.set(view, buildHandle(view, callbacks))
          // 视口内的小幅滚动**不产生任何 ViewUpdate 标志** —— 不自己挂一个，
          // 滚一下手柄就停在原地（mousemove 之前都不会跟上来）
          window.addEventListener('resize', this.onResize)
        }
        update(update: ViewUpdate): void {
          const drag = dragStates.get(update.view)
          if (drag !== undefined) {
            // 外部整篇替换（切笔记 / 撤销）会让块 id 失效 —— 直接取消，别去动新文档
            if (update.docChanged) {
              cancelPillPress(update.view)
            } else if (update.viewportChanged || update.geometryChanged) {
              // 视口重建会抹掉 inline transform 与提示线位置。微任务跑在本次 update 之后，
              // 那时读 `documentTop` 才是新值（update 相位里不能同步读布局）。
              queueMicrotask(() => {
                if (dragStates.get(update.view) !== drag) return
                retargetDrag(update.view, drag)
              })
            }
          }
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.geometryChanged ||
            update.selectionSet ||
            update.focusChanged
          ) {
            // update 相位里不能同步读布局（见 repaintHandle 的注释）
            scheduleHandle(update.view)
          }
        }
        destroy(): void {
          window.removeEventListener('resize', this.onResize)
          // 销毁路径只清节点与监听，不再去读布局/重画
          cancelPillPress(this.view, false)
          handleViews.get(this.view)?.root.remove()
          handleViews.delete(this.view)
          hoverLines.delete(this.view)
          pinnedLines.delete(this.view)
        }
      }
    ),
    // 滚动同样不设标志 —— 观察者比 handler 更合适（不会被别人 return true 拦掉）
    EditorView.domEventObservers({
      scroll: (_event, view) => {
        repaintHandle(view)
        // 自动滚动 / 用户滚动都会重建视口行 DOM。落点必须按新几何重算 ——
        // 只重画提示线的话，「看到的线」和「松手落的位置」会分叉。
        const state = dragStates.get(view)
        if (state !== undefined) {
          refreshDragGeometry(view, state)
          retargetDrag(view, state)
        }
      }
    })
  ]
}

/** 手柄（浮层 + 悬停观察）。替代了曾经的「每行一个 gutter marker」。 */
export function markdownBlockHandles(callbacks: MarkdownBlockEditorCallbacks = {}): Extension {
  return [markdownBlockHover(callbacks), foldCaretSync]
}

/**
 * 折叠状态变了要把浮层上的三角翻过来。排在悬停插件之后跑，才拿得到已经建好的浮层。
 */
const foldCaretSync = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate): void {
      if (foldedRanges(update.startState) !== foldedRanges(update.state)) repaintHandle(update.view)
    }
  }
)

/** Fold service plus CodeMirror's fold state — the caret lives in the handle overlay. */
export function markdownBlockFolding(): Extension {
  return [markdownBlockFoldService, codeFolding()]
}

// ── 拖拽：指针 + 视觉置换 ──
//
// 拖拽期间**不改文档**，只给受影响的行挂 `transform: translateY()`。同批兄弟互换是一次
// 置换，位移后各家仍严丝合缝铺满同一段纵向空间（不露缝），松手时才提交一次真正的重排。
// 这样绕开了「每次移动都 dispatch」带来的一串后果：autosave 落盘、撤销栈被切碎、
// 折叠状态被整篇替换打乱、滚动锚点，以及拖拽源 DOM 被重建导致拖拽中断。
//
// 入口是**整颗手柄胶囊**，走 Pointer Events：胶囊为了「点击不抢焦点」必须
// `preventDefault(pointerdown)`，而那正好会掐掉原生 dragstart（以前只有 14px 的抓手能拖，
// 按胶囊本体看起来就是拖不动）。按下不立即开始：移动超过 4px 才算拖拽，否则松手仍是点击菜单。

const DRAG_THRESHOLD = 4
const PREVIEW_MAX_LINES = 6
const PREVIEW_MAX_CHARS = 120
const AUTOSCROLL_EDGE = 48
const AUTOSCROLL_MAX = 16
const OUTLINE_LIMIT = 200

interface PillPressState {
  pointerId: number
  /** 按下时对应的行 / 块 —— 没拖动时按它打开块菜单 */
  line: number
  sourceId: number
  startX: number
  startY: number
  pill: HTMLElement
  listeners: [string, EventListener][]
}

interface BlockDragState {
  sourceId: number
  source: MarkdownBlock
  blocks: MarkdownBlock[]
  lines: string[]
  t: (key: string) => string
  slots: BlockSlot[]
  /**
   * 允许落脚的**块边界**(不限兄弟):跨小节拖动表格 / 图表时用。
   * `slots` 仍负责同父兄弟的置换动画,两者共用同一个 `slot` 结果。
   */
  anchors: BlockSlot[]
  /** 视觉位移（id → 像素），由 `permutationOffsets` 算出 */
  deltas: Map<number, number>
  slot: DropSlot | null
  /** 大纲锁定：悬停大纲条目后落点固定，不再跟指针 */
  lock: { slot: DropSlot; entry: OutlineEntry } | null
  /** 跟手折叠卡片 */
  card: HTMLElement
  cardWidth: number
  cardHeight: number
  /** 落点提示线、目标标签 */
  dropLine: HTMLElement
  destLabel: HTMLElement
  destKey: string
  /** 长文档的大纲面板；短文档 / 嵌套块为 null */
  outline: HTMLElement | null
  outlineEntries: OutlineEntry[]
  activeOutlineKey: string | null
  outlineRect: DOMRect | null
  lastX: number
  lastY: number
  scrollRaf: number | null
  /** 贴边加速的停留计时 */
  scrollDir: -1 | 0 | 1
  scrollStartedAt: number
  /** 防几何漂移：上次重建快照时的 scrollTop */
  snapshotScrollTop: number
}

const pressStates = new WeakMap<EditorView, PillPressState>()
const dragStates = new WeakMap<EditorView, BlockDragState>()
/** 同一个 view 同一帧只排一次重画 */
const pendingRepaint = new WeakSet<EditorView>()

/** 拖拽开始时的槽位快照：`top` / `height` 是**文档坐标**。 */
function snapshotSlots(
  view: EditorView,
  source: MarkdownBlock,
  blocks: readonly MarkdownBlock[],
  lines: readonly string[]
): BlockSlot[] {
  const doc = view.state.doc
  return blocks
    .filter((block) => isMarkdownBlockDraggable(block) && block.parentId === source.parentId)
    .sort((a, b) => a.from - b.from)
    .map((block) => {
      const to = Math.min(block.to, doc.lines)
      // 用 height map（`lineBlockAt`）而不是 DOM rect：兄弟块可能在视口外，量不到。
      // 它也**不读 DOM**，所以拖拽期间的 transform 不会污染这套几何。
      const first = view.lineBlockAt(doc.line(block.from + 1).from)
      const last = view.lineBlockAt(doc.line(Math.max(to, block.from + 1)).from)
      return {
        id: block.id,
        from: block.from,
        to,
        top: first.top,
        height: last.top + last.height - first.top,
        // 只有「同一批兄弟」才允许落脚：缩进不同的块被拖过去会静默改挂父级
        allowed: inSameDropScope(lines, source, block)
      }
    })
}

/**
 * 自由落点快照:所有能被 `canDropBeside` 接受的块(排除源块自己与它的子树)。
 *
 * `height` 只用于指针「上半 / 下半」判定 —— 取到**下一个锚点**为止,而不是块自身高度。
 * 标题的块范围包含整棵子树,若用自身高度就会和子块重叠,指针永远只能停在标题上。
 */
function snapshotAnchors(
  view: EditorView,
  source: MarkdownBlock,
  blocks: readonly MarkdownBlock[],
  lines: readonly string[]
): BlockSlot[] {
  const doc = view.state.doc
  const candidates = blocks
    .filter((block) => isMarkdownBlockDraggable(block) && block.kind !== 'frontmatter')
    .filter((block) => block.id !== source.id)
    // 源块自己的子树不是落点:放进去等于把它劈成两半
    .filter((block) => !(block.from >= source.from && block.to <= source.to))
    .filter((block) => canDropBeside(blocks, lines, source, block))
    .sort((a, b) => a.from - b.from)

  return candidates.map((block, index) => {
    const top = view.lineBlockAt(doc.line(block.from + 1).from).top
    const next = candidates[index + 1]
    // 非最后一项:范围到下一个锚点为止(标题的块范围包含整棵子树,用自身高度会重叠)。
    // 最后一项:必须用它**自己的视觉高度** —— contentHeight 含正文底部 200px 留白,
    // 拿来当高度会让「文件末尾」整片区域都算这个块的上半,永远落不到它后面。
    let bottom: number
    if (next !== undefined) {
      bottom = view.lineBlockAt(doc.line(next.from + 1).from).top
    } else {
      // 最后一项:用**它自己最后一行的下边**。别拿 contentHeight —— 它含正文底部
      // 200px 留白,会让「文件末尾」整片区域都算这个块的上半,永远落不到它后面。
      // 用 `to` 而不是 `contentTo`:列表项 / 引用 / details 的子树在 `contentTo` 之后,
      // 落点却是 `target.to`。只看首行会把提示线画在子树中间。
      const last = view.lineBlockAt(doc.line(Math.min(Math.max(block.to, block.from + 1), doc.lines)).from)
      bottom = last.top + last.height
    }
    return {
      id: block.id,
      from: block.from,
      to: Math.min(block.to, doc.lines),
      top,
      height: Math.max(1, bottom - top)
    }
  })
}

function slotAtPointer(view: EditorView, state: BlockDragState, clientY: number): DropSlot | null {
  return resolveDropAnchor(state.anchors, clientY - view.documentTop)
}

/** 当前落点是不是「同父兄弟」—— 是的话才走置换动画 */
function siblingTarget(state: BlockDragState, slot: DropSlot | null): boolean {
  if (slot === null) return false
  return state.slots.some(
    (candidate) => candidate.id === slot.targetId && candidate.id !== state.sourceId && candidate.allowed !== false
  )
}

/**
 * 把当前的位移铺到行上。**必须幂等**：CM 的 MutationObserver 看到属性变化会
 * `requestMeasure()`，再进 write 又调用本函数 —— 只在值真的变了时才写，才不会自激。
 * 任何一次同步（`setAttrs`）都会抹掉 inline style 与后加的 class，所以每次都重扫重挂。
 */
function paintPermutation(view: EditorView): void {
  const state = dragStates.get(view)
  view.dom.querySelectorAll<HTMLElement>('.cm-line.cm-block-permuted').forEach((line) => {
    line.classList.remove('cm-block-permuted', 'cm-block-drag-source')
    if (line.style.transform !== '') line.style.transform = ''
  })
  if (state === undefined || state.slots.length < 2) return
  // 跨父级落点没有置换动画:别给兄弟行留一排「位移 0」的标记(会被当成参与置换)
  if (state.deltas.size === 0) return

  const owner = new Map<number, number>()
  for (const slot of state.slots) {
    for (let line = slot.from; line < slot.to; line += 1) owner.set(line, slot.id)
  }
  const doc = view.state.doc
  view.dom.querySelectorAll<HTMLElement>('.cm-line').forEach((line) => {
    const index = doc.lineAt(view.posAtDOM(line, 0)).number - 1
    const id = owner.get(index)
    if (id === undefined) return
    line.classList.add('cm-block-permuted')
    if (id === state.sourceId) line.classList.add('cm-block-drag-source')
    const delta = state.deltas.get(id) ?? 0
    const next = delta === 0 ? '' : `translateY(${delta}px)`
    if (line.style.transform !== next) line.style.transform = next
  })
}

function restoreAfterBlockMove(
  view: EditorView,
  previousText: string,
  anchorBlock: MarkdownBlock,
  nextText: string,
  anchorViewportTop: number | null,
  fallbackScrollTop: number
): void {
  const candidate = matchBlockAfterMove(anchorBlock, previousText, nextText)

  window.requestAnimationFrame(() => {
    if (!view.dom.isConnected) return
    if (candidate !== null && anchorViewportTop !== null) {
      const nextLine = lineElement(view, candidate.from)
      const nextTop = nextLine?.getBoundingClientRect().top
      if (nextTop !== undefined) {
        view.scrollDOM.scrollTop += nextTop - anchorViewportTop
        return
      }
    }
    view.scrollDOM.scrollTop = fallbackScrollTop
  })
}

function lineStartsOf(lines: readonly string[]): number[] {
  const starts = new Array<number>(lines.length + 1)
  let pos = 0
  for (let i = 0; i < lines.length; i += 1) {
    starts[i] = pos
    pos += lines[i].length + 1
  }
  starts[lines.length] = pos
  return starts
}

interface CommitBlockMoveOptions {
  /** 拖动路径：保持被拖块在视口中的位置；键盘 / 选择器改为 nearest 揭示。 */
  restoreScroll?: boolean
  reveal?: boolean
  /** 拖动路径必须在清除位移**之前**量好，否则恢复滚动会差一个置换位移。 */
  anchorTop?: number | null
  fallbackScrollTop?: number
}

/**
 * 所有块移动的唯一提交入口（拖拽、移动到…、键盘）。
 *
 * 一次整篇 dispatch 换正文；折叠按块签名在第二个 effect-only transaction 里贴回
 * （fold 不进 undo 历史）；光标跟着被移动块，避免整篇替换后停在无关位置。
 */
function commitBlockMove(
  view: EditorView,
  sourceId: number,
  slot: DropSlot,
  options: CommitBlockMoveOptions = {}
): BlockMoveStatus {
  const doc = view.state.doc
  const text = doc.toString()
  const lines = text.split('\n')
  const blocks = blocksOf(doc)
  const source = blocks.find((block) => block.id === sourceId)
  const target = blocks.find((block) => block.id === slot.targetId)
  if (source === undefined || target === undefined) return 'invalid'
  if (!isMarkdownBlockDraggable(source) || !isMarkdownBlockDraggable(target)) return 'invalid'
  if (!canDropBeside(blocks, lines, source, target)) return 'invalid'
  if (target.from >= source.from && target.to <= source.to) return 'invalid'

  const next = reorderMarkdownBlocks(text, sourceId, slot.targetId, slot.before)
  if (next === null) return 'noop'
  const nextSource = matchBlockAfterMove(source, text, next)
  if (nextSource === null) return 'invalid'

  const selection = view.state.selection.main
  const sourceStart = doc.line(source.from + 1).from
  const sourceEnd = doc.line(Math.min(Math.max(source.contentTo, source.from + 1), doc.lines)).to
  const inSource = selection.head >= sourceStart && selection.head <= sourceEnd
  const headLine = doc.lineAt(selection.head).number - 1
  const relativeLine = inSource ? headLine - source.from : 0
  const column = inSource ? selection.head - doc.line(doc.lineAt(selection.head).number).from : 0

  const nextLines = next.split('\n')
  const nextStarts = lineStartsOf(nextLines)
  const lastLine = Math.max(nextSource.from, Math.min(nextSource.contentTo - 1, nextLines.length - 1))
  const caretLine = Math.max(nextSource.from, Math.min(nextSource.from + relativeLine, lastLine))
  const caret = Math.min(
    (nextStarts[caretLine] ?? 0) + column,
    (nextStarts[caretLine] ?? 0) + (nextLines[caretLine]?.length ?? 0)
  )

  const folded: { from: number; to: number }[] = []
  foldedRanges(view.state).between(0, doc.length, (from, to) => {
    folded.push({ from, to })
  })
  const foldSpans = foldSpansOf(lines, blocks, folded)
  const anchorTop =
    options.anchorTop !== undefined
      ? options.anchorTop
      : (lineElement(view, source.from)?.getBoundingClientRect().top ?? null)
  const fallbackScrollTop = options.fallbackScrollTop ?? view.scrollDOM.scrollTop

  view.dispatch({
    changes: { from: 0, to: doc.length, insert: next },
    selection: { anchor: caret },
    effects: options.reveal ? [EditorView.scrollIntoView(caret, { y: 'nearest', yMargin: 32 })] : []
  })
  const restored = resolveFoldSpans(next, foldSpans)
  if (restored.length > 0) {
    view.dispatch({ effects: restored.map((range) => foldEffect.of(range)) })
  }
  // 两条定位策略互斥:reveal 会滚到光标,保持锚点位置的恢复再滚一次会把它顶回去
  if (options.restoreScroll !== false && options.reveal !== true) {
    restoreAfterBlockMove(view, text, source, next, anchorTop, fallbackScrollTop)
  }
  return 'moved'
}

/** 「移动到…」：按定位器在**实时文档**里重新定位源块与目标。 */
export function moveBlockByLocator(
  view: EditorView,
  sourceLocator: BlockLocator,
  target: BlockMoveTarget
): BlockMoveStatus {
  const text = view.state.doc.toString()
  const lines = text.split('\n')
  const blocks = blocksOf(view.state.doc)
  const source = locateBlock(blocks, sourceLocator)
  if (source === null) return 'invalid'
  const slot = resolveMoveTarget(blocks, lines, source, target)
  if (slot === null) return 'invalid'
  return commitBlockMove(view, source.id, slot, { reveal: true })
}

/**
 * 光标所在块的键盘移动。是可拖动块就消费按键（边界处也消费），
 * 避免退回 CodeMirror 默认的「按行移动」——那会把表格拆坏。
 */
export function moveBlockAtCaret(
  view: EditorView,
  direction: 'up' | 'down',
  mode: 'sibling' | 'cross-section'
): boolean {
  if (view.composing || view.state.selection.ranges.length > 1) return false
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head).number - 1
  const blocks = blocksOf(view.state.doc)
  const source = narrowestBlockAtLine(blocks, line, isMarkdownBlockDraggable)
  if (source === null) return false
  const lines = view.state.doc.toString().split('\n')
  const slot =
    mode === 'sibling'
      ? siblingMoveSlot(blocks, lines, source, direction)
      : crossSectionMoveSlot(blocks, lines, source, direction)
  if (slot !== null) commitBlockMove(view, source.id, slot, { reveal: true })
  return true
}

export interface DragCardPreview {
  lines: string[]
  truncated: boolean
}

/**
 * 折叠预览：只取块的前 `maxLines` 行，每行最多 `maxChars` 个字符。
 * 所有块同一套逻辑 —— 表格显示表头与前几行，Mermaid 显示围栏与节点，标题显示标题行。
 */
export function dragCardPreview(
  lines: readonly string[],
  block: MarkdownBlock,
  maxLines = PREVIEW_MAX_LINES,
  maxChars = PREVIEW_MAX_CHARS
): DragCardPreview {
  const from = Math.max(0, block.from)
  const to = Math.min(Math.max(block.contentTo, from), lines.length)
  const rows = lines.slice(from, to)
  const shown: string[] = []
  let truncated = rows.length > maxLines
  for (const row of rows.slice(0, maxLines)) {
    if (row.length > maxChars) {
      shown.push(row.slice(0, Math.max(0, maxChars - 1)) + '…')
      truncated = true
    } else {
      shown.push(row)
    }
  }
  // 空块理论上不会走到拖拽，兜底给一行，卡片别塌成一条线
  if (shown.length === 0) shown.push(lines[from] ?? '')
  return { lines: shown, truncated }
}

/** 置换后源块的顶部（文档坐标）—— 落点提示线就画在这里。 */
export function permutedDropTop(
  slots: readonly BlockSlot[],
  deltas: ReadonlyMap<number, number>,
  sourceId: number
): number | null {
  const slot = slots.find((candidate) => candidate.id === sourceId)
  if (slot === undefined) return null
  return slot.top + (deltas.get(sourceId) ?? 0)
}

/** 指针进入滚动区上/下边缘时的滚动速度（px/帧，负数向上）。 */
export function autoScrollVelocity(
  pointerY: number,
  viewportTop: number,
  viewportBottom: number,
  edge = AUTOSCROLL_EDGE,
  maxSpeed = AUTOSCROLL_MAX
): number {
  if (pointerY < viewportTop + edge) {
    const depth = Math.min(edge, viewportTop + edge - pointerY)
    return -Math.ceil((depth / edge) * maxSpeed)
  }
  if (pointerY > viewportBottom - edge) {
    const depth = Math.min(edge, pointerY - (viewportBottom - edge))
    return Math.ceil((depth / edge) * maxSpeed)
  }
  return 0
}

export interface AutoScrollTuning {
  edge?: number
  maxSpeed?: number
  rampMs?: number
  maxRamp?: number
}

/**
 * 长文档用的贴边滚动：边缘带与速度上限都按视口高度推算，
 * 并在持续贴边时从 1× 线性加速到 `maxRamp`。短文档仍由上面的常量保底。
 */
export function autoScrollVelocityForViewport(
  pointerY: number,
  viewportTop: number,
  viewportBottom: number,
  dwellMs = 0,
  tuning: AutoScrollTuning = {}
): number {
  const height = Math.max(1, viewportBottom - viewportTop)
  const edge = tuning.edge ?? Math.min(140, Math.max(56, Math.round(height * 0.18)))
  const maxSpeed = tuning.maxSpeed ?? Math.min(40, Math.max(16, Math.round(height * 0.035)))
  const rampMs = Math.max(1, tuning.rampMs ?? 1000)
  const maxRamp = Math.max(1, tuning.maxRamp ?? 2)
  const base = autoScrollVelocity(pointerY, viewportTop, viewportBottom, edge, maxSpeed)
  if (base === 0) return 0
  const ramp = 1 + (Math.min(Math.max(0, dwellMs), rampMs) / rampMs) * (maxRamp - 1)
  return Math.sign(base) * Math.ceil(Math.abs(base) * ramp)
}

/** 跟手卡片：类型图标 + 类型名 + 前几行源码（超出用 `…` 收尾）。 */
function buildDragCard(view: EditorView, block: MarkdownBlock): HTMLElement {
  const t = makeT(getCurrentLang())
  const card = document.createElement('div')
  card.className = 'cm-block-drag-card'

  const head = document.createElement('div')
  head.className = 'cm-block-drag-card-head'
  const icon = document.createElement('span')
  icon.className = 'cm-block-drag-card-icon'
  icon.append(block.kind === 'heading' ? document.createTextNode(headingText(block.level)) : blockIcon(block))
  const type = document.createElement('span')
  type.className = 'cm-block-drag-card-type'
  type.textContent = t(blockTypeLabelKey(block))
  head.append(icon, type)

  const body = document.createElement('pre')
  body.className = 'cm-block-drag-card-body'
  const preview = dragCardPreview(view.state.doc.toString().split('\n'), block)
  body.textContent = preview.lines.join('\n')
  if (preview.truncated) {
    const ellipsis = document.createElement('span')
    ellipsis.className = 'cm-block-drag-card-ellipsis'
    ellipsis.textContent = '\n…'
    body.append(ellipsis)
  }
  card.append(head, body)
  return card
}

function positionDragCard(state: BlockDragState, x: number, y: number): void {
  const rect = state.outlineRect
  const overOutline = rect !== null && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  const wanted = overOutline ? x - state.cardWidth - 14 : x + 14
  const left = Math.min(Math.max(wanted, 8), Math.max(8, window.innerWidth - state.cardWidth - 8))
  const top = Math.min(Math.max(y + 14, 8), Math.max(8, window.innerHeight - state.cardHeight - 8))
  state.card.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`
}

function buildDestLabel(): HTMLElement {
  const label = document.createElement('div')
  label.className = 'cm-block-drop-label'
  label.hidden = true
  return label
}

function buildOutlinePanel(entries: readonly OutlineEntry[], t: (key: string) => string): HTMLElement {
  const panel = document.createElement('div')
  panel.className = 'cm-block-outline'
  const head = document.createElement('div')
  head.className = 'cm-block-outline-hd'
  head.textContent = t('notes.blockMove.outlineTitle')
  const list = document.createElement('div')
  list.className = 'cm-block-outline-list'
  list.setAttribute('role', 'listbox')
  for (const entry of entries.slice(0, OUTLINE_LIMIT)) {
    const row = document.createElement('div')
    row.className = `cm-block-outline-entry${entry.kind === 'heading' ? '' : ' is-edge'}`
    row.setAttribute('role', 'option')
    row.dataset.entryKey = entry.key
    if (entry.kind === 'heading') {
      row.style.paddingLeft = `${8 + Math.max(0, entry.level - 1) * 12}px`
    }
    row.textContent =
      entry.kind === 'heading'
        ? entry.title || t('notes.blockMove.untitled')
        : t(entry.kind === 'start' ? 'notes.blockMove.start' : 'notes.blockMove.end')
    // 指针已经捕获在 pill 上；这里只是别让按下的默认行为把编辑器焦点抢走
    row.addEventListener('pointerdown', (event) => event.preventDefault())
    row.addEventListener('mousedown', (event) => event.preventDefault())
    list.append(row)
  }
  panel.append(head, list)
  if (entries.length > OUTLINE_LIMIT) {
    const foot = document.createElement('div')
    foot.className = 'cm-block-outline-ft'
    foot.textContent = t('notes.blockMove.limit').replace('{N}', String(OUTLINE_LIMIT))
    panel.append(foot)
  }
  return panel
}

function positionOutline(view: EditorView, state: BlockDragState): void {
  if (state.outline === null) return
  const rect = view.scrollDOM.getBoundingClientRect()
  // 窄窗口（分屏）下跟着滚动区收窄，但绝不超出滚动区
  const width = Math.max(0, Math.min(rect.width - 16, 240, Math.max(96, Math.round(rect.width * 0.38))))
  const left = Math.max(8, Math.min(rect.right - width - 10, window.innerWidth - width - 8))
  state.outline.style.width = `${width.toFixed(1)}px`
  state.outline.style.left = `${left.toFixed(1)}px`
  state.outline.style.top = `${Math.max(8, rect.top + 8).toFixed(1)}px`
  state.outline.style.maxHeight = `${Math.max(120, rect.height - 16).toFixed(1)}px`
  state.outlineRect = state.outline.getBoundingClientRect()
}

function paintOutlineActive(state: BlockDragState, key: string | null): void {
  if (state.activeOutlineKey === key) return
  state.activeOutlineKey = key
  state.outline?.querySelectorAll<HTMLElement>('.cm-block-outline-entry').forEach((row) => {
    row.classList.toggle('is-active', key !== null && row.dataset.entryKey === key)
  })
}

function scrollToOutlineEntry(view: EditorView, state: BlockDragState, entry: OutlineEntry): void {
  const line = Math.min(entry.line + 1, view.state.doc.lines)
  const top = view.lineBlockAt(view.state.doc.line(line).from).top
  const max = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight)
  view.scrollDOM.scrollTop = Math.min(max, Math.max(0, top - 24))
  // 刚跳过去，别马上又因为「滚过一个视口」重建快照
  state.snapshotScrollTop = view.scrollDOM.scrollTop
}

function outlineHitAt(
  state: BlockDragState,
  x: number,
  y: number
): { over: boolean; entry: OutlineEntry | null } {
  const rect = state.outlineRect
  if (state.outline === null || rect === null) return { over: false, entry: null }
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    return { over: false, entry: null }
  }
  // 指针捕获会把 pointermove 重定向到 pill，只能靠 elementFromPoint 找行
  const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('.cm-block-outline-entry')
  const key = row?.dataset.entryKey
  const entry =
    key === undefined ? null : (state.outlineEntries.find((candidate) => candidate.key === key) ?? null)
  return { over: true, entry }
}

function paintDestLabel(view: EditorView, state: BlockDragState, lineTop: number | null): void {
  if (lineTop === null || state.slot === null) {
    if (!state.destLabel.hidden) state.destLabel.hidden = true
    state.destKey = ''
    return
  }
  const dest = destinationForSlot(state.blocks, state.lines, state.slot)
  if (dest === null) {
    if (!state.destLabel.hidden) state.destLabel.hidden = true
    state.destKey = ''
    return
  }
  const key = `${state.slot.targetId}:${state.slot.before}`
  if (key !== state.destKey) {
    state.destKey = key
    const name =
      dest.kind === 'heading'
        ? `${'#'.repeat(dest.level)} ${dest.title || state.t('notes.blockMove.untitled')}`.trim()
        : state.t(dest.typeLabelKey ?? 'notes.blockMenu.type.paragraph')
    const template = dest.before
      ? state.t('notes.blockMove.before')
      : dest.kind === 'heading'
        ? state.t('notes.blockMove.afterSection')
        : state.t('notes.blockMove.after')
    state.destLabel.textContent = template.replace('{TARGET}', name)
  }
  const scroller = view.scrollDOM.getBoundingClientRect()
  const content = view.contentDOM.getBoundingClientRect()
  const above = lineTop - scroller.top > 34
  const top = Math.min(
    Math.max(above ? lineTop - 26 : lineTop + 6, scroller.top + 2),
    scroller.bottom - 24
  )
  state.destLabel.style.top = `${top.toFixed(1)}px`
  state.destLabel.style.left = `${(content.left + 4).toFixed(1)}px`
  state.destLabel.style.maxWidth = `${Math.max(120, content.width - 8).toFixed(1)}px`
  state.destLabel.hidden = false
}

/**
 * 重新判定落点。滚动（滚轮 / 触控板 / 自动滚动 / 大纲跳转）与指针移动都走这里，
 * 保证「看到的线」和「松手落的位置」始终是同一次判定。
 */
function retargetDrag(view: EditorView, state: BlockDragState): void {
  const hit = outlineHitAt(state, state.lastX, state.lastY)
  if (hit.over) {
    if (hit.entry !== null && state.lock?.entry.key !== hit.entry.key) {
      state.lock = { slot: hit.entry.target, entry: hit.entry }
      paintOutlineActive(state, hit.entry.key)
      scrollToOutlineEntry(view, state, hit.entry)
      stopAutoScroll(state)
    }
    if (hit.entry === null && state.lock === null) {
      // 指针在大纲的标题栏 / 间隙上：暂时没有落点
      state.slot = null
      state.deltas = new Map()
      paintPermutation(view)
      paintDestLabel(view, state, paintDropLine(view, state))
      return
    }
  } else if (state.lock !== null) {
    state.lock = null
    paintOutlineActive(state, null)
  }

  const slot = state.lock?.slot ?? slotAtPointer(view, state, state.lastY)
  state.slot = slot
  // 只有同父兄弟才做置换；大纲锁定 / 跨父级只画落点线
  state.deltas =
    state.lock === null && slot !== null && siblingTarget(state, slot)
      ? permutationOffsets(state.slots, state.sourceId, slot.targetId, slot.before)
      : new Map()
  paintPermutation(view)
  paintDestLabel(view, state, paintDropLine(view, state))
}

/** 长文档滚动超过一个视口后重建几何，抵消远端 lineBlockAt 的估算漂移。 */
function refreshDragGeometry(view: EditorView, state: BlockDragState): void {
  if (state.lock !== null) return
  const box = view.scrollDOM
  if (Math.abs(box.scrollTop - state.snapshotScrollTop) < box.clientHeight) return
  state.slots = snapshotSlots(view, state.source, state.blocks, state.lines)
  state.anchors = snapshotAnchors(view, state.source, state.blocks, state.lines)
  state.snapshotScrollTop = box.scrollTop
}

/**
 * 落点提示线画在**源块最终落点**的边界上。
 *
 * · 同父兄弟置换:画在源块置换后的顶边(与兄弟块滑动到的位置同一条边),两者永远一致;
 * · 跨父级自由落点:没有置换动画,直接画在目标块的上边界(或文档末尾的下边界)。
 * 2px 线以边界为中心:`top - 1`。
 */
function dropLineDocTop(state: BlockDragState): number | null {
  if (state.slot === null) return null
  // 大纲锁定不走置换:提示线必须画在锁定的那个锚点上,而不是源块当前的位置
  if (state.lock === null && siblingTarget(state, state.slot)) {
    return permutedDropTop(state.slots, state.deltas, state.sourceId)
  }
  const anchor = state.anchors.find((candidate) => candidate.id === state.slot!.targetId)
  if (anchor === undefined) return null
  return state.slot.before ? anchor.top : anchor.top + anchor.height
}

function paintDropLine(view: EditorView, state: BlockDragState): number | null {
  const docTop = dropLineDocTop(state)
  if (docTop === null) {
    state.dropLine.hidden = true
    return null
  }
  const scroller = view.scrollDOM.getBoundingClientRect()
  const content = view.contentDOM.getBoundingClientRect()
  const screenY = view.documentTop + docTop
  // 目标可能被滚出视口：夹到滚动区边缘，仍能表达「在上方 / 下方」
  const top = Math.min(Math.max(screenY, scroller.top + 1), scroller.bottom - 1)
  state.dropLine.style.top = `${(top - 1).toFixed(1)}px`
  state.dropLine.style.left = `${content.left.toFixed(1)}px`
  state.dropLine.style.width = `${content.width.toFixed(1)}px`
  state.dropLine.hidden = false
  return top
}

function paintDrag(view: EditorView, state: BlockDragState, x: number, y: number): void {
  state.lastX = x
  state.lastY = y
  retargetDrag(view, state)
  positionDragCard(state, x, y)
  ensureAutoScroll(view, state)
}

function updateBlockDrag(view: EditorView, x: number, y: number): void {
  const state = dragStates.get(view)
  if (state === undefined) return
  paintDrag(view, state, x, y)
}

function stopAutoScroll(state: BlockDragState): void {
  if (state.scrollRaf === null) return
  window.cancelAnimationFrame(state.scrollRaf)
  state.scrollRaf = null
}

function pointerOverOutline(state: BlockDragState): boolean {
  const rect = state.outlineRect
  if (rect === null) return false
  return (
    state.lastX >= rect.left &&
    state.lastX <= rect.right &&
    state.lastY >= rect.top &&
    state.lastY <= rect.bottom
  )
}

/**
 * 指针贴住滚动区上下边缘时自动滚动。每帧重算落点：滚动改变了 `documentTop`，
 * 指针没动也可能跨过一个块。滚不动了（到顶/到底）立即停。
 * 在边缘停留越久滚得越快（1 秒内 1×→2×）；大纲锁定 / 指针停在大纲上时不自动滚。
 */
function ensureAutoScroll(view: EditorView, state: BlockDragState): void {
  if (state.lock !== null || pointerOverOutline(state)) {
    state.scrollDir = 0
    state.scrollStartedAt = 0
    stopAutoScroll(state)
    return
  }
  const rect = view.scrollDOM.getBoundingClientRect()
  const base = autoScrollVelocity(state.lastY, rect.top, rect.bottom)
  const dir = (base === 0 ? 0 : Math.sign(base)) as -1 | 0 | 1
  if (dir !== state.scrollDir) {
    state.scrollDir = dir
    state.scrollStartedAt = dir === 0 ? 0 : performance.now()
  }
  if (dir === 0) {
    stopAutoScroll(state)
    return
  }
  if (state.scrollRaf !== null) return
  const step = (): void => {
    state.scrollRaf = null
    if (dragStates.get(view) !== state || state.lock !== null) return
    const box = view.scrollDOM.getBoundingClientRect()
    const dwell = state.scrollStartedAt === 0 ? 0 : performance.now() - state.scrollStartedAt
    const speed = autoScrollVelocityForViewport(state.lastY, box.top, box.bottom, dwell)
    if (speed === 0) return
    const before = view.scrollDOM.scrollTop
    view.scrollDOM.scrollTop = before + speed
    if (view.scrollDOM.scrollTop === before) {
      state.scrollDir = 0
      state.scrollStartedAt = 0
      return
    }
    // 卡片只跟指针，不用动；落点、置换与提示线要按新滚动位置重算
    paintDrag(view, state, state.lastX, state.lastY)
  }
  state.scrollRaf = window.requestAnimationFrame(step)
}

/** 收尾：只清视觉与监听，**不碰文档**。`repaint=false` 供销毁路径用（那时别再读布局）。 */
function endBlockDrag(view: EditorView, repaint = true): void {
  const state = dragStates.get(view)
  if (state === undefined) return
  dragStates.delete(view)
  stopAutoScroll(state)
  state.card.remove()
  state.dropLine.remove()
  state.destLabel.remove()
  state.outline?.remove()
  dragFlagHost(view)?.classList.remove('cm-block-dragging')
  document.body.classList.remove('cm-block-dragging')
  if (!repaint) return
  // 状态已删 —— 这一步把位移与高亮一起清干净
  paintPermutation(view)
  if (view.dom.isConnected) repaintHandle(view)
}

function cancelPillPress(view: EditorView, repaint = true): void {
  const press = pressStates.get(view)
  if (press !== undefined) {
    for (const [type, listener] of press.listeners) window.removeEventListener(type, listener, true)
    try {
      if (press.pill.hasPointerCapture(press.pointerId)) press.pill.releasePointerCapture(press.pointerId)
    } catch {
      // 指针已结束：没有 capture 可释放
    }
    pressStates.delete(view)
  }
  endBlockDrag(view, repaint)
}

function startBlockDrag(view: EditorView, press: PillPressState, event: PointerEvent): void {
  const blocks = blocksOf(view.state.doc)
  const source = blocks.find((candidate) => candidate.id === press.sourceId)
  if (source === undefined || !isMarkdownBlockDraggable(source)) return
  const lines = view.state.doc.toString().split('\n')
  const t = makeT(getCurrentLang())

  const card = buildDragCard(view, source)
  document.body.append(card)
  const rect = card.getBoundingClientRect()
  const dropLine = document.createElement('div')
  dropLine.className = 'cm-block-drop-line'
  dropLine.hidden = true
  document.body.append(dropLine)
  const destLabel = buildDestLabel()
  document.body.append(destLabel)

  const slots = snapshotSlots(view, source, blocks, lines)
  const anchors = snapshotAnchors(view, source, blocks, lines)
  // 长文档 + 顶层块才给大纲：短文档拖拽多一块遮挡，嵌套列表没有「节」可言
  const entries =
    isTopLevelScoped(blocks, source) && view.scrollDOM.scrollHeight > view.scrollDOM.clientHeight * 1.6
      ? buildOutlineEntries(blocks, lines, anchors, source)
      : []
  const outline = entries.length > 0 ? buildOutlinePanel(entries, t) : null
  if (outline !== null) document.body.append(outline)

  const state: BlockDragState = {
    sourceId: source.id,
    source,
    blocks,
    lines,
    t,
    slots,
    anchors,
    deltas: new Map(),
    slot: null,
    lock: null,
    card,
    cardWidth: rect.width,
    cardHeight: rect.height,
    dropLine,
    destLabel,
    destKey: '',
    outline,
    outlineEntries: entries,
    activeOutlineKey: null,
    outlineRect: null,
    lastX: event.clientX,
    lastY: event.clientY,
    scrollRaf: null,
    scrollDir: 0,
    scrollStartedAt: 0,
    snapshotScrollTop: view.scrollDOM.scrollTop
  }
  dragStates.set(view, state)
  dragFlagHost(view)?.classList.add('cm-block-dragging')
  document.body.classList.add('cm-block-dragging')
  if (outline !== null) positionOutline(view, state)
  // 手柄立即让位（planHandle 看到 dragStates 返回 null）
  repaintHandle(view)
  paintDrag(view, state, event.clientX, event.clientY)
}

/** 松手：统一走 `commitBlockMove`（折叠恢复 / 光标跟随 / 滚动定位都在里面）。 */
function finishBlockDrag(view: EditorView, state: BlockDragState): void {
  const source = blocksOf(view.state.doc).find((block) => block.id === state.sourceId)
  const slot = state.lock?.slot ?? state.slot
  if (source === undefined || slot === null) {
    endBlockDrag(view)
    return
  }
  // 锚点 = 被拖块**视觉上**的位置（带着位移）。松手后它就落在那儿，
  // 所以恢复滚动时要让它停在用户看到的地方，而不是跳回原槽位。
  const anchorTop = lineElement(view, source.from)?.getBoundingClientRect().top ?? null
  const fallbackScrollTop = view.scrollDOM.scrollTop
  // 先清位移再提交：恢复滚动在 rAF 里量 rect，带着 transform 会差一个动画位移
  endBlockDrag(view)
  commitBlockMove(view, state.sourceId, slot, { anchorTop, fallbackScrollTop })
}

function beginPillPress(
  view: EditorView,
  event: PointerEvent,
  callbacks: MarkdownBlockEditorCallbacks,
  pill: HTMLElement
): void {
  if (event.button !== 0 || !event.isPrimary) return
  const id = Number(pill.dataset.blockId)
  if (!Number.isInteger(id)) return
  const block = blocksOf(view.state.doc).find((candidate) => candidate.id === id)
  if (block === undefined || !isMarkdownBlockDraggable(block)) return

  // 上一轮没走完（理论上不会）—— 先收尾，别让 window 监听叠加
  cancelPillPress(view)
  // 焦点与 DOM 选区都不动。❌ 不 stopPropagation：块菜单靠 window pointerdown 关掉别处点击
  event.preventDefault()
  // 按下即捕获：即使指针移出窗口，松手也能收到 pointerup（否则按下态会一直挂着）
  try {
    pill.setPointerCapture(event.pointerId)
  } catch {
    // 指针已结束
  }

  const line = pinnedLines.get(view) ?? hoverLines.get(view) ?? block.from
  const press: PillPressState = {
    pointerId: event.pointerId,
    line,
    sourceId: id,
    startX: event.clientX,
    startY: event.clientY,
    pill,
    listeners: []
  }
  const onMove = (moveEvent: PointerEvent): void => {
    if (moveEvent.pointerId !== press.pointerId) return
    if (dragStates.has(view)) {
      updateBlockDrag(view, moveEvent.clientX, moveEvent.clientY)
      return
    }
    if (Math.hypot(moveEvent.clientX - press.startX, moveEvent.clientY - press.startY) < DRAG_THRESHOLD) return
    startBlockDrag(view, press, moveEvent)
  }
  const onUp = (upEvent: PointerEvent): void => {
    if (upEvent.pointerId !== press.pointerId) return
    const state = dragStates.get(view)
    if (state !== undefined) {
      finishBlockDrag(view, state)
      cancelPillPress(view)
      return
    }
    // 没越过阈值 = 点击：打开块菜单（原来的 click 行为）
    const current = blocksOf(view.state.doc).find((candidate) => candidate.id === press.sourceId)
    cancelPillPress(view)
    if (current !== undefined) callbacks.onBlockMenu?.(current, pill.getBoundingClientRect(), press.line)
  }
  const onCancel = (cancelEvent: Event): void => {
    if (cancelEvent instanceof PointerEvent && cancelEvent.pointerId !== press.pointerId) return
    cancelPillPress(view)
  }
  const onKey = (keyEvent: KeyboardEvent): void => {
    if (keyEvent.key !== 'Escape') return
    keyEvent.preventDefault()
    cancelPillPress(view)
  }
  press.listeners = [
    ['pointermove', onMove as EventListener],
    ['pointerup', onUp as EventListener],
    ['pointercancel', onCancel],
    ['keydown', onKey as EventListener],
    ['blur', onCancel]
  ]
  for (const [type, listener] of press.listeners) window.addEventListener(type, listener, true)
  pressStates.set(view, press)
}
