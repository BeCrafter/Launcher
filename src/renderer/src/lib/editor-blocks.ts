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
import {
  blockOwnersByLine,
  inSameDropScope,
  isMarkdownBlockDraggable,
  isMarkdownBlockFoldable,
  permutationOffsets,
  parseMarkdownBlocks,
  reorderMarkdownBlocks,
  resolveDropSlot,
  type BlockSlot,
  type DropSlot,
  type MarkdownBlock
} from './markdown-blocks'

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

/** 行 → 归属块（最内层）。手柄、悬停底色、折叠都问它。 */
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
const washedBlocks = new WeakMap<EditorView, MarkdownBlock>()

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
  pill.draggable = true
  const badge = document.createElement('span')
  badge.className = 'cm-block-type'
  const grip = document.createElement('span')
  grip.className = 'cm-block-grip'
  grip.append(dragIcon())
  pill.append(badge, grip)

  const caretSlot = document.createElement('span')
  caretSlot.className = 'cm-block-caret-slot'
  root.append(pill, caretSlot)

  // 胶囊整体既是拖拽源又是菜单触发器（点=开菜单、拖=移块）——
  // 与飞书一致。⚠ 抓手上**不能** preventDefault mousedown，否则原生 dragstart 根本不触发。
  pill.addEventListener('mousedown', (event) => {
    if (!(event.target as HTMLElement).closest('.cm-block-grip')) event.preventDefault()
  })
  pill.addEventListener('dragstart', (event) => handleBlockDragStart(view, event))
  pill.addEventListener('dragend', (event) => handleBlockDragEnd(view, event))
  pill.addEventListener('click', () => {
    const line = hoverLines.get(view)
    const block = line === undefined ? undefined : ownersOf(view.state.doc).get(line)
    if (line === undefined || block === undefined) return
    callbacks.onBlockMenu?.(block, pill.getBoundingClientRect(), line)
  })
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
  return {
    line,
    block,
    top: lineRect.top - hostRect.top + (lineRect.height - PILL_HEIGHT) / 2,
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
    plan.block.kind === 'heading' ? document.createTextNode(headingText(plan.block.level)) : blockIcon(plan.block.kind)
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

/** 鼠标停在哪一块，那一块就加一层极淡底色 —— 一眼看出手柄属于谁。 */
function paintHoverWash(view: EditorView, block: MarkdownBlock | null): void {
  if (washedBlocks.get(view) === block && block !== null) return
  if (washedBlocks.get(view) === undefined && block === null) return
  view.dom.querySelectorAll<HTMLElement>('.cm-line.cm-block-hovered').forEach((el) => {
    el.classList.remove('cm-block-hovered')
  })
  if (block !== null) {
    const owners = ownersOf(view.state.doc)
    view.dom.querySelectorAll<HTMLElement>('.cm-line').forEach((el) => {
      const index = view.state.doc.lineAt(view.posAtDOM(el, 0)).number - 1
      if (owners.get(index)?.id === block.id) el.classList.add('cm-block-hovered')
    })
    washedBlocks.set(view, block)
  } else {
    washedBlocks.delete(view)
  }
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
  if (hoverLines.get(view) === line) return
  hoverLines.set(view, line)
  repaintHandle(view)
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

function updateToolHover(view: EditorView, event: MouseEvent, callbacks: MarkdownBlockEditorCallbacks): void {
  const contentBox = view.contentDOM.getBoundingClientRect()
  const pos = view.posAtCoords({ x: contentBox.left + 8, y: event.clientY })
  if (pos === null) {
    clearHover(view)
    removeEmptyInsert(view)
    return
  }
  const lineNumber = view.state.doc.lineAt(pos).number - 1
  setHoverLine(view, lineNumber)
  updateEmptyInsertAtLine(view, lineNumber, callbacks.onEmptyMenu)
}

function markdownBlockHover(callbacks: MarkdownBlockEditorCallbacks): Extension {
  return [
    EditorView.domEventObservers({
      mousemove: (event, view) => updateToolHover(view, event as MouseEvent, callbacks),
      mouseleave: (event, view) => {
        // 鼠标只是走到左边的手柄浮层上不算离开 —— 否则整组会闪掉
        if (staysInsideEditor(view, event)) return
        clearHover(view)
        removeEmptyInsert(view)
      }
    }),
    ViewPlugin.fromClass(
      class {
        private readonly onResize = (): void => repaintHandle(this.view)
        constructor(private readonly view: EditorView) {
          handleViews.set(view, buildHandle(view, callbacks))
          // 视口内的小幅滚动**不产生任何 ViewUpdate 标志** —— 不自己挂一个，
          // 滚一下手柄就停在原地（mousemove 之前都不会跟上来）
          window.addEventListener('resize', this.onResize)
        }
        update(update: ViewUpdate): void {
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
          handleViews.get(this.view)?.root.remove()
          handleViews.delete(this.view)
          hoverLines.delete(this.view)
          pinnedLines.delete(this.view)
          washedBlocks.delete(this.view)
        }
      }
    ),
    // 滚动同样不设标志 —— 观察者比 handler 更合适（不会被别人 return true 拦掉）
    EditorView.domEventObservers({
      scroll: (_event, view) => {
        repaintHandle(view)
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

// ── 拖拽：视觉置换 ──
//
// 拖拽期间**不改文档**，只给受影响的行挂 `transform: translateY()`。同批兄弟互换是一次
// 置换，位移后各家仍严丝合缝铺满同一段纵向空间（不露缝），松手时才提交一次真正的重排。
// 这样绕开了「每次 dragover 都 dispatch」带来的一串后果：autosave 落盘、撤销栈被切碎、
// 折叠状态被整篇替换打乱、滚动锚点，以及拖拽源 DOM 被重建导致浏览器中断拖拽。

interface BlockDragState {
  sourceId: number
  slots: BlockSlot[]
  /** 视觉位移（id → 像素），由 `permutationOffsets` 算出 */
  deltas: Map<number, number>
  /** 跟手浮层：松手/中断时才移除（Chrome 在 dragstart 之后才拍快照） */
  ghost: HTMLElement | null
  /** 拖拽源 DOM 若被重建，`dragend` 可能不再冒泡 —— 用 window 上的兜底监听收尾 */
  onWindowDragEnd: (() => void) | null
}

const dragStates = new WeakMap<EditorView, BlockDragState>()
/** 同一个 view 同一帧只排一次重画 */
const pendingRepaint = new WeakSet<EditorView>()

/** 拖拽开始时的槽位快照：`top` / `height` 是**文档坐标**。 */
function snapshotSlots(view: EditorView, source: MarkdownBlock): BlockSlot[] {
  const doc = view.state.doc
  const lines = doc.toString().split('\n')
  return blocksOf(doc)
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

function slotAtPointer(view: EditorView, state: BlockDragState, clientY: number): DropSlot | null {
  const others = state.slots.filter((slot) => slot.id !== state.sourceId)
  return resolveDropSlot(others, clientY - view.documentTop)
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

function endBlockDrag(view: EditorView): void {
  const state = dragStates.get(view)
  if (state === undefined) return
  dragStates.delete(view)
  if (state.onWindowDragEnd !== null) window.removeEventListener('dragend', state.onWindowDragEnd, true)
  state.ghost?.remove()
  dragFlagHost(view)?.classList.remove('cm-block-dragging')
  // dragStates 已删掉 —— 这一步把位移与高亮一起清干净
  paintPermutation(view)
}

/** 跟手浮层：整块源码文本，替掉浏览器默认那个小图标快照。 */
function dragGhost(view: EditorView, block: MarkdownBlock): HTMLElement {
  const doc = view.state.doc
  const from = doc.line(block.from + 1).from
  const to = doc.line(Math.min(Math.max(block.contentTo, block.from + 1), doc.lines)).to
  const lines = doc.sliceString(from, to).split('\n')
  const shown = lines.slice(0, 8)
  if (lines.length > shown.length) shown.push('…')
  const ghost = document.createElement('div')
  // 挂在 body 上、放到屏幕外：CM 的 MutationObserver 盯着 contentDOM，挂进去会被它量到；
  // 也不能用 visibility/opacity 藏 —— Chrome 会拍出一张空白图。
  ghost.className = 'cm-block-drag-ghost'
  ghost.textContent = shown.join('\n')
  document.body.append(ghost)
  return ghost
}

export function handleBlockDragStart(view: EditorView, event: Event): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  const id = Number(target.closest<HTMLElement>('[data-block-id]')?.dataset.blockId)
  if (!Number.isInteger(id)) return false
  const block = blocksOf(view.state.doc).find((candidate) => candidate.id === id)
  if (block === undefined || !isMarkdownBlockDraggable(block)) return false

  const dragEvent = event as DragEvent
  dragEvent.dataTransfer?.setData('text/plain', `markdown-block:${id}`)
  if (dragEvent.dataTransfer !== null) dragEvent.dataTransfer.effectAllowed = 'move'
  // 上一轮若没走完收尾（拖拽源被重建时 dragend 可能不来），先把它的浮层与监听清掉
  endBlockDrag(view)
  const ghost = dragGhost(view, block)
  // must run inside dragstart: Chrome snapshots the element right after it returns
  dragEvent.dataTransfer?.setDragImage(ghost, 14, 14)

  const onWindowDragEnd = (): void => endBlockDrag(view)
  window.addEventListener('dragend', onWindowDragEnd, true)
  dragStates.set(view, {
    sourceId: id,
    slots: snapshotSlots(view, block),
    deltas: new Map(),
    ghost,
    onWindowDragEnd
  })
  dragFlagHost(view)?.classList.add('cm-block-dragging')
  paintPermutation(view)
  // Let the browser continue the native drag after recording our source block.
  return false
}

export function handleBlockDragOver(view: EditorView, event: Event): boolean {
  const state = dragStates.get(view)
  if (state === undefined) return false
  const dragEvent = event as DragEvent
  const slot = slotAtPointer(view, state, dragEvent.clientY)
  state.deltas =
    slot === null ? new Map() : permutationOffsets(state.slots, state.sourceId, slot.targetId, slot.before)
  paintPermutation(view)
  // 兜底：viewport 变化会把行 DOM 换掉（inline style 随之丢失），下次测量时重铺一遍
  view.requestMeasure({ key: state, read: () => {}, write: () => paintPermutation(view) })
  if (dragEvent.dataTransfer !== null) dragEvent.dataTransfer.dropEffect = 'move'
  return true
}

function restoreAfterBlockMove(
  view: EditorView,
  previousText: string,
  anchorBlock: MarkdownBlock,
  nextText: string,
  anchorViewportTop: number | null,
  fallbackScrollTop: number
): void {
  const previousLines = previousText.split('\n')
  const targetSignature = previousLines.slice(anchorBlock.from, anchorBlock.contentTo).join('\n')
  const nextLines = nextText.split('\n')
  const candidates = parseMarkdownBlocks(nextText).filter((candidate) => {
    if (candidate.kind !== anchorBlock.kind || candidate.level !== anchorBlock.level) return false
    return nextLines.slice(candidate.from, candidate.contentTo).join('\n') === targetSignature
  })
  const candidate = candidates.sort(
    (a, b) => Math.abs(a.from - anchorBlock.from) - Math.abs(b.from - anchorBlock.from)
  )[0]

  window.requestAnimationFrame(() => {
    if (!view.dom.isConnected) return
    if (candidate !== undefined && anchorViewportTop !== null) {
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

export function handleBlockDrop(view: EditorView, event: Event): boolean {
  const state = dragStates.get(view)
  if (state === undefined) return false
  const sourceId = state.sourceId
  const text = view.state.doc.toString()
  const source = blocksOf(view.state.doc).find((block) => block.id === sourceId)
  const slot = slotAtPointer(view, state, (event as DragEvent).clientY)

  if (source === undefined || slot === null) {
    endBlockDrag(view)
    return true
  }

  // 锚点 = 被拖块**视觉上**的位置（带着位移）。松手后它就落在那儿，
  // 所以恢复滚动时要让它停在用户看到的地方，而不是跳回原槽位。
  const anchorTop = lineElement(view, source.from)?.getBoundingClientRect().top ?? null
  const fallbackScrollTop = view.scrollDOM.scrollTop
  // 先清位移再 dispatch：restoreAfterBlockMove 在 rAF 里量 rect，带着 transform 会差一个动画位移
  endBlockDrag(view)

  const next = reorderMarkdownBlocks(text, sourceId, slot.targetId, slot.before)
  if (next !== null) {
    const selection = view.state.selection.main
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
      selection: {
        anchor: Math.min(selection.anchor, next.length),
        head: Math.min(selection.head, next.length)
      }
    })
    restoreAfterBlockMove(view, text, source, next, anchorTop, fallbackScrollTop)
  }
  return true
}

export function handleBlockDragEnd(view: EditorView, _event: Event): boolean {
  if (!dragStates.has(view)) return false
  endBlockDrag(view)
  return true
}

/** Whether a document drop is currently a block move rather than an image import. */
export function isBlockDrag(view: EditorView): boolean {
  return dragStates.has(view)
}
