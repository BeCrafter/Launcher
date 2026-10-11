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
  type MarkdownBlock
} from './markdown-blocks'

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

class BlockHandleMarker extends GutterMarker {
  constructor(private readonly block: MarkdownBlock) {
    super()
    this.elementClass = 'cm-block-handle-marker'
  }

  eq(other: GutterMarker): boolean {
    return other instanceof BlockHandleMarker && other.block.id === this.block.id && other.block.from === this.block.from
  }

  toDOM(): Node {
    const handle = document.createElement('span')
    handle.className = 'cm-block-handle'
    handle.dataset.blockId = String(this.block.id)
    handle.draggable = true
    handle.setAttribute('role', 'button')
    handle.setAttribute('tabindex', '-1')
    handle.setAttribute('aria-label', makeT(getCurrentLang())('notes.editor.dragBlock'))
    handle.title = makeT(getCurrentLang())('notes.editor.dragBlock')
    handle.innerHTML = '<i class="fa-solid fa-up-down-left-right" aria-hidden="true"></i>'
    return handle
  }
}

function blockMarkers(view: EditorView): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>()
  const doc = view.state.doc
  for (const block of parseMarkdownBlocks(doc.toString())) {
    if (!isMarkdownBlockDraggable(block) || block.from >= doc.lines) continue
    const line = doc.line(block.from + 1)
    builder.add(line.from, line.from, new BlockHandleMarker(block))
  }
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
  const block = blocks.find((candidate) => candidate.from === lineNumber && candidate.movable)
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

function updateToolHover(view: EditorView, event: MouseEvent): void {
  const contentBox = view.contentDOM.getBoundingClientRect()
  const pos = view.posAtCoords({ x: contentBox.left + 8, y: event.clientY })
  if (pos === null) {
    clearToolHover(view)
    return
  }
  activateToolHover(view, view.state.doc.lineAt(pos).number - 1)
}

const markdownBlockHover = EditorView.domEventObservers({
  mousemove: (event, view) => updateToolHover(view, event as MouseEvent),
  mouseleave: (_event, view) => clearToolHover(view)
})

/** Gutter containing the visible-on-hover block drag handle. */
export function markdownBlockGutter(): Extension {
  return [gutter({
    class: 'cm-block-gutter',
    markers: blockMarkers,
    renderEmptyElements: false,
    domEventHandlers: {
      dragstart: (view: EditorView, _line: BlockInfo, event: Event) => handleBlockDragStart(view, event),
      dragover: (view: EditorView, _line: BlockInfo, event: Event) => handleBlockDragOver(view, event),
      drop: (view: EditorView, _line: BlockInfo, event: Event) => handleBlockDrop(view, event),
      dragend: (view: EditorView, _line: BlockInfo, event: Event) => handleBlockDragEnd(view, event),
      mousemove: (view: EditorView, line: BlockInfo) => {
        activateToolHover(view, view.state.doc.lineAt(line.from).number - 1)
        return false
      },
      mouseleave: (view: EditorView) => {
        clearToolHover(view)
        return false
      }
    }
  }),
  markdownBlockHover
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
