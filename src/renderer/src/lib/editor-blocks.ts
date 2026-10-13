import { EditorState, RangeSet, RangeSetBuilder, type Extension } from '@codemirror/state'
import {
  codeFolding,
  foldEffect,
  foldedRanges,
  foldService,
  unfoldEffect
} from '@codemirror/language'
import {
  EditorView,
  GutterMarker,
  gutter,
  type BlockInfo
} from '@codemirror/view'
import { getCurrentLang, makeT } from '../i18n'
import {
  draggableBlockAtLine,
  isMarkdownBlockDraggable,
  isMarkdownBlockFoldable,
  parseMarkdownBlocks,
  reorderMarkdownBlocks,
  type MarkdownBlock,
  type MarkdownBlockKind
} from './markdown-blocks'

export interface MarkdownBlockEditorCallbacks {
  onBlockMenu?: (block: MarkdownBlock, anchor: DOMRect, line: number) => void
  onEmptyMenu?: (line: number, anchor: DOMRect) => void
}

interface BlockDragState {
  sourceId: number
  targetId: number | null
  before: boolean
}

const dragStates = new WeakMap<EditorView, BlockDragState>()

function blockRange(state: EditorState, lineStart: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart)
  const blocks = parseMarkdownBlocks(state.doc.toString())
  const block = blocks.find((candidate) => candidate.from === line.number - 1)
  if (block === undefined || !isMarkdownBlockFoldable(block)) return null

  const from = line.to
  // Fold through the last meaningful line, not through the newline before the
  // next block. Leaving that newline outside the range keeps the next block on
  // its own line after CodeMirror inserts the fold placeholder.
  const lastContentLine = Math.min(Math.max(block.contentTo, 1), state.doc.lines)
  const to = state.doc.line(lastContentLine).to
  return to > from ? { from, to } : null
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

/** 各区块类型在徽标上显示的图标（标题用 H1/H2 文本，不在此表） */
function blockTypeIcon(kind: MarkdownBlockKind): string {
  switch (kind) {
    case 'fence': return 'fa-code'
    case 'table': return 'fa-table'
    case 'list': return 'fa-list-ul'
    case 'quote': return 'fa-quote-left'
    case 'callout': return 'fa-comment-dots'
    case 'details': return 'fa-caret-square-down'
    case 'thematicBreak': return 'fa-minus'
    case 'paragraph': return 'fa-paragraph'
    default: return 'fa-align-left'
  }
}

class BlockHandleMarker extends GutterMarker {
  constructor(
    private readonly block: MarkdownBlock,
    private readonly line: number,
    private readonly callbacks: MarkdownBlockEditorCallbacks
  ) {
    super()
    this.elementClass = 'cm-block-handle-marker'
  }

  eq(other: GutterMarker): boolean {
    return other instanceof BlockHandleMarker && other.block.id === this.block.id && other.line === this.line
  }

  toDOM(): Node {
    const handle = document.createElement('span')
    handle.className = 'cm-block-handle'
    handle.dataset.blockId = String(this.block.id)
    handle.dataset.line = String(this.line)
    handle.setAttribute('role', 'button')
    handle.setAttribute('tabindex', '-1')
    handle.setAttribute('aria-label', makeT(getCurrentLang())('notes.editor.dragBlock'))
    handle.title = makeT(getCurrentLang())('notes.editor.dragBlock')
    handle.addEventListener('mousedown', (event) => {
      // 抓手要启动原生拖拽，preventDefault 会取消 dragstart —— 必须放行
      if ((event.target as HTMLElement).closest('.cm-block-grip') !== null) return
      event.preventDefault()
    })

    const type = document.createElement('span')
    type.className = 'cm-block-type'
    if (this.block.kind === 'heading') {
      type.textContent = `H${this.block.level}`
    } else {
      const icon = document.createElement('i')
      icon.className = `fa-solid ${blockTypeIcon(this.block.kind)}`
      icon.setAttribute('aria-hidden', 'true')
      type.append(icon)
    }

    handle.append(type)

    // 抓手只给可拖拽块（标题/代码/表格）；段落、列表等只显示类型徽标
    if (isMarkdownBlockDraggable(this.block)) {
      const grip = document.createElement('span')
      grip.className = 'cm-block-grip'
      grip.draggable = true
      grip.setAttribute('aria-hidden', 'true')
      grip.innerHTML = '<i class="fa-solid fa-up-down-left-right"></i>'
      handle.append(grip)
    }

    handle.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('.cm-block-grip') !== null) return
      event.preventDefault()
      event.stopPropagation()
      this.callbacks.onBlockMenu?.(this.block, handle.getBoundingClientRect(), this.line)
    })
    return handle
  }
}

function blockMarkers(view: EditorView, callbacks: MarkdownBlockEditorCallbacks): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>()
  const doc = view.state.doc
  const items: { pos: number; marker: BlockHandleMarker }[] = []
  for (const block of parseMarkdownBlocks(doc.toString())) {
    // 所有可移动块都出徽标（段落/列表/引用…），不再限定于可拖拽块
    if (!block.movable || block.from >= doc.lines) continue
    // 标题块的 contentTo 覆盖整棵子树 —— 只给标题行出 marker,
    // 子树里的行归各自的子块管(否则同一行会挂两个 handle)
    if (block.kind === 'heading') {
      const line = doc.line(block.from + 1)
      items.push({ pos: line.from, marker: new BlockHandleMarker(block, block.from, callbacks) })
      continue
    }
    // 块内**每一行**都出 marker：hover 到哪行哪行显示按钮，点它开菜单（菜单知道 line）
    const last = Math.min(block.contentTo, doc.lines)
    for (let ln = block.from; ln < last; ln++) {
      const line = doc.line(ln + 1)
      items.push({ pos: line.from, marker: new BlockHandleMarker(block, ln, callbacks) })
    }
  }
  // parseMarkdownBlocks 输出是**层级序**(父标题在子内容前),不是文档序 ——
  // 逐块直接 add 会让 pos 回退,RangeSetBuilder 当场抛「must be added sorted」
  items.sort((a, b) => a.pos - b.pos)
  for (const it of items) builder.add(it.pos, it.pos, it.marker)
  return builder.finish()
}

function lineElement(view: EditorView, line: number): HTMLElement | null {
  const pos = view.state.doc.line(line + 1).from
  let node: Node | null = view.domAtPos(pos).node
  while (node !== null) {
    if (node instanceof HTMLElement && node.classList.contains('cm-line')) return node
    node = node.parentNode
  }
  return null
}

function clearDragHighlights(view: EditorView): void {
  view.dom.querySelectorAll('.cm-block-drag-source, .cm-block-drag-target').forEach((node) => {
    node.classList.remove('cm-block-drag-source', 'cm-block-drag-target')
  })
}

function markVisibleBlock(view: EditorView, block: MarkdownBlock, className: string): void {
  const doc = view.state.doc
  view.dom.querySelectorAll<HTMLElement>('.cm-line').forEach((line) => {
    const pos = view.posAtDOM(line, 0)
    const lineNumber = doc.lineAt(pos).number - 1
    if (lineNumber >= block.from && lineNumber < block.to) line.classList.add(className)
  })
}

function updateDragHighlights(view: EditorView): void {
  clearDragHighlights(view)
  const state = dragStates.get(view)
  if (state === undefined) return
  const blocks = parseMarkdownBlocks(view.state.doc.toString())
  const source = blocks.find((block) => block.id === state.sourceId)
  if (source === undefined || !isMarkdownBlockDraggable(source)) return
  markVisibleBlock(view, source, 'cm-block-drag-source')
  if (state.targetId === null) return
  const target = blocks.find((block) => block.id === state.targetId)
  if (target !== undefined && target.id !== source.id && isMarkdownBlockDraggable(target)) {
    markVisibleBlock(view, target, 'cm-block-drag-target')
  }
}

function clearDropMarker(view: EditorView): void {
  view.dom.querySelectorAll('.cm-block-drop-before, .cm-block-drop-after').forEach((node) => {
    node.classList.remove('cm-block-drop-before', 'cm-block-drop-after')
  })
}

function validDropTarget(view: EditorView, event: DragEvent): { block: MarkdownBlock; before: boolean } | null {
  const state = dragStates.get(view)
  if (state === undefined) return null
  const contentBox = view.contentDOM.getBoundingClientRect()
  const pos = view.posAtCoords({ x: contentBox.left + 8, y: event.clientY })
  if (pos === null) return null

  const line = view.state.doc.lineAt(pos).number - 1
  const blocks = parseMarkdownBlocks(view.state.doc.toString())
  const target = draggableBlockAtLine(blocks, line)
  const source = blocks.find((block) => block.id === state.sourceId)
  if (
    target === null ||
    source === undefined ||
    !isMarkdownBlockDraggable(target) ||
    !isMarkdownBlockDraggable(source) ||
    target.id === source.id ||
    target.parentId !== source.parentId
  ) {
    return null
  }

  const targetLine = lineElement(view, target.from)
  const rect = targetLine?.getBoundingClientRect()
  const before = rect === null || rect === undefined ? event.clientY < contentBox.top + 16 : event.clientY < rect.top + rect.height / 2
  return { block: target, before }
}

function showDropMarker(view: EditorView, target: MarkdownBlock, before: boolean): void {
  clearDropMarker(view)
  const line = lineElement(view, target.from)
  line?.classList.add(before ? 'cm-block-drop-before' : 'cm-block-drop-after')
}

export function handleBlockDragStart(view: EditorView, event: Event): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  const id = Number(target.closest<HTMLElement>('[data-block-id]')?.dataset.blockId)
  if (!Number.isInteger(id)) return false
  const block = parseMarkdownBlocks(view.state.doc.toString()).find((candidate) => candidate.id === id)
  if (block === undefined || !isMarkdownBlockDraggable(block)) return false

  dragStates.set(view, { sourceId: id, targetId: null, before: true })
  const dragEvent = event as DragEvent
  dragEvent.dataTransfer?.setData('text/plain', `markdown-block:${id}`)
  if (dragEvent.dataTransfer !== null) dragEvent.dataTransfer.effectAllowed = 'move'
  view.dom.classList.add('cm-block-dragging')
  updateDragHighlights(view)
  // Let the browser continue the native drag after recording our source block.
  return false
}

export function handleBlockDragOver(view: EditorView, event: Event): boolean {
  const state = dragStates.get(view)
  if (state === undefined) return false
  const target = validDropTarget(view, event as DragEvent)
  if (target === null) {
    state.targetId = null
    clearDropMarker(view)
  } else {
    state.targetId = target.block.id
    state.before = target.before
    showDropMarker(view, target.block, target.before)
  }
  updateDragHighlights(view)
  const dragEvent = event as DragEvent
  if (dragEvent.dataTransfer !== null) dragEvent.dataTransfer.dropEffect = target === null ? 'none' : 'move'
  return true
}

function restoreAfterBlockMove(
  view: EditorView,
  previousText: string,
  targetBlock: MarkdownBlock,
  nextText: string,
  targetViewportTop: number | null,
  fallbackScrollTop: number
): void {
  const previousLines = previousText.split('\n')
  const targetSignature = previousLines.slice(targetBlock.from, targetBlock.contentTo).join('\n')
  const nextLines = nextText.split('\n')
  const candidates = parseMarkdownBlocks(nextText).filter((candidate) => {
    if (candidate.kind !== targetBlock.kind || candidate.level !== targetBlock.level) return false
    return nextLines.slice(candidate.from, candidate.contentTo).join('\n') === targetSignature
  })
  const candidate = candidates.sort((a, b) => Math.abs(a.from - targetBlock.from) - Math.abs(b.from - targetBlock.from))[0]

  window.requestAnimationFrame(() => {
    if (!view.dom.isConnected) return
    if (candidate !== undefined && targetViewportTop !== null) {
      const nextLine = lineElement(view, candidate.from)
      const nextTop = nextLine?.getBoundingClientRect().top
      if (nextTop !== undefined) {
        view.scrollDOM.scrollTop += nextTop - targetViewportTop
        return
      }
    }
    view.scrollDOM.scrollTop = fallbackScrollTop
  })
}

export function handleBlockDrop(view: EditorView, event: Event): boolean {
  const state = dragStates.get(view)
  if (state === undefined) return false
  const target = validDropTarget(view, event as DragEvent)
  const targetId = target?.block.id ?? state.targetId
  if (targetId !== null && targetId !== undefined) {
    const text = view.state.doc.toString()
    const blocks = parseMarkdownBlocks(text)
    const targetBlock = target?.block ?? blocks.find((block) => block.id === targetId)
    const targetLine = targetBlock === undefined ? null : lineElement(view, targetBlock.from)
    const targetViewportTop = targetLine?.getBoundingClientRect().top ?? null
    const fallbackScrollTop = view.scrollDOM.scrollTop
    const next = reorderMarkdownBlocks(text, state.sourceId, targetId, target?.before ?? state.before)
    if (next !== null) {
      const selection = view.state.selection.main
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        selection: {
          anchor: Math.min(selection.anchor, next.length),
          head: Math.min(selection.head, next.length)
        }
      })
      if (targetBlock !== undefined) {
        restoreAfterBlockMove(view, text, targetBlock, next, targetViewportTop, fallbackScrollTop)
      }
    }
  }
  handleBlockDragEnd(view, event)
  return true
}

export function handleBlockDragEnd(view: EditorView, _event: Event): boolean {
  if (!dragStates.has(view)) return false
  dragStates.delete(view)
  view.dom.classList.remove('cm-block-dragging')
  clearDropMarker(view)
  clearDragHighlights(view)
  return true
}

class FoldMarker extends GutterMarker {
  constructor(private readonly open: boolean) {
    super()
  }

  eq(other: GutterMarker): boolean {
    return other instanceof FoldMarker && other.open === this.open
  }

  toDOM(): Node {
    const marker = document.createElement('span')
    marker.innerHTML = `<i class="fa-solid ${this.open ? 'fa-chevron-down' : 'fa-chevron-right'}" aria-hidden="true"></i>`
    marker.title = makeT(getCurrentLang())(this.open ? 'notes.editor.collapse' : 'notes.editor.expand')
    marker.setAttribute('aria-label', marker.title)
    return marker
  }
}

function foldMarkers(view: EditorView): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>()
  const doc = view.state.doc
  for (const block of parseMarkdownBlocks(doc.toString())) {
    if (!isMarkdownBlockFoldable(block) || block.from >= doc.lines) continue
    const line = doc.line(block.from + 1)
    const range = blockRange(view.state, line.from)
    if (range === null) continue
    builder.add(line.from, line.from, new FoldMarker(!isFoldedAt(view.state, range.from)))
  }
  return builder.finish()
}

function toggleBlockFold(view: EditorView, line: BlockInfo): boolean {
  const range = blockRange(view.state, line.from)
  if (range === null) return false
  const effect = isFoldedAt(view.state, range.from) ? unfoldEffect : foldEffect
  view.dispatch({ effects: effect.of(range) })
  return true
}

function markdownFoldGutter(): Extension {
  return gutter({
    class: 'cm-foldGutter',
    markers: foldMarkers,
    renderEmptyElements: false,
    initialSpacer: () => new FoldMarker(true),
    domEventHandlers: {
      click: (view: EditorView, line: BlockInfo) => toggleBlockFold(view, line)
    }
  })
}

function clearToolHover(view: EditorView): void {
  view.dom.querySelectorAll('.cm-block-tool-active').forEach((node) => {
    node.classList.remove('cm-block-tool-active')
  })
}

function activateToolHover(view: EditorView, lineNumber: number): void {
  clearToolHover(view)
  const blocks = parseMarkdownBlocks(view.state.doc.toString())
  // 块内任意行都激活（不只块首行）：列表/代码/表格的中间行也要出按钮。
  // 标题块的范围覆盖整棵子树,取**最窄**的匹配块 —— 否则子块行永远命中标题
  let block: MarkdownBlock | undefined
  for (const candidate of blocks) {
    if (!candidate.movable || lineNumber < candidate.from || lineNumber >= candidate.contentTo) continue
    if (block === undefined || candidate.contentTo - candidate.from < block.contentTo - block.from) block = candidate
  }
  if (block === undefined) return

  const line = lineElement(view, lineNumber)
  const lineRect = line?.getBoundingClientRect()
  if (lineRect === undefined || lineRect === null) return
  for (const selector of ['.cm-block-gutter .cm-gutterElement', '.cm-foldGutter .cm-gutterElement']) {
    view.dom.querySelectorAll<HTMLElement>(selector).forEach((gutterLine) => {
      const gutterRect = gutterLine.getBoundingClientRect()
      if (gutterRect.top < lineRect.bottom && gutterRect.bottom > lineRect.top) {
        gutterLine.classList.add('cm-block-tool-active')
      }
    })
  }
}

function removeEmptyInsert(view: EditorView): void {
  view.dom.querySelector('.cm-empty-insert')?.remove()
}

function updateEmptyInsertAtLine(view: EditorView, lineNumber: number, callback?: (line: number, anchor: DOMRect) => void): void {
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
    button.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i>'
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
  button.style.left = '2px'
}

function updateToolHover(view: EditorView, event: MouseEvent, callbacks: MarkdownBlockEditorCallbacks): void {
  const contentBox = view.contentDOM.getBoundingClientRect()
  const pos = view.posAtCoords({ x: contentBox.left + 8, y: event.clientY })
  if (pos === null) {
    clearToolHover(view)
    removeEmptyInsert(view)
    return
  }
  const lineNumber = view.state.doc.lineAt(pos).number - 1
  activateToolHover(view, lineNumber)
  updateEmptyInsertAtLine(view, lineNumber, callbacks.onEmptyMenu)
}

function markdownBlockHover(callbacks: MarkdownBlockEditorCallbacks): Extension {
  return EditorView.domEventObservers({
    mousemove: (event, view) => updateToolHover(view, event as MouseEvent, callbacks),
    mouseleave: (_event, view) => {
      clearToolHover(view)
      removeEmptyInsert(view)
    }
  })
}

/** Gutter containing the visible-on-hover block drag handle. */
export function markdownBlockGutter(callbacks: MarkdownBlockEditorCallbacks = {}): Extension {
  return [gutter({
    class: 'cm-block-gutter',
    markers: (view) => blockMarkers(view, callbacks),
    renderEmptyElements: false,
    domEventHandlers: {
      dragstart: (view: EditorView, _line: BlockInfo, event: Event) => handleBlockDragStart(view, event),
      dragover: (view: EditorView, _line: BlockInfo, event: Event) => handleBlockDragOver(view, event),
      drop: (view: EditorView, _line: BlockInfo, event: Event) => handleBlockDrop(view, event),
      dragend: (view: EditorView, _line: BlockInfo, event: Event) => handleBlockDragEnd(view, event),
      mousemove: (view: EditorView, line: BlockInfo) => {
        const lineNumber = view.state.doc.lineAt(line.from).number - 1
        activateToolHover(view, lineNumber)
        updateEmptyInsertAtLine(view, lineNumber, callbacks.onEmptyMenu)
        return false
      },
      mouseleave: (view: EditorView) => {
        clearToolHover(view)
        // 不在这里 removeEmptyInsert：加号按钮位于 gutter 区域（left:2px），
        // 鼠标从 gutter 移到按钮上时会触发本 handler，若移除按钮则永远点不到。
        // 按钮的去留改由 mousemove 观察者按「当前行是否为空行」决定。
        return false
      }
    }
  }),
  markdownBlockHover(callbacks)
]
}

/** Fold gutter plus our Markdown-aware fold service. */
export function markdownBlockFolding(): Extension {
  return [markdownBlockFoldService, codeFolding(), markdownFoldGutter()]
}

/** Handlers for events that originate in the editable content DOM. */
export const markdownBlockContentHandlers = {
  dragover: handleBlockDragOver,
  drop: handleBlockDrop,
  dragend: handleBlockDragEnd
}

/** Whether a document drop is currently a block move rather than an image import. */
export function isBlockDrag(view: EditorView): boolean {
  return dragStates.has(view)
}
