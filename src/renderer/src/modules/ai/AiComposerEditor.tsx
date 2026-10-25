// 输入框的 CodeMirror 外壳:文档仍是纯文本,引用/附件/技能 token 由装饰器画成 chip。
//
// 不用 contenteditable 自己拼:输入法、撤销、选区、软换行、粘贴这些行为 CodeMirror
// 已经处理得足够好;我们只接管「Enter 发送 / 粘贴文件 / 触发词」三处。
import { useEffect, useRef } from 'react'
import { Compartment, EditorState, Prec, StateEffect, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  drawSelection,
  keymap,
  placeholder as placeholderExt,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { inlineTokenFor, parseInlineItems, type InlineItem } from '@shared/ai-inline'

export interface InlineDisplay {
  /** chip 的类型后缀(style 用):image / file / note / agent / cron / skill / pending / missing */
  kind: string
  label: string
  icon?: string
  /** 用文字字形做类型标识(如技能的 `/`);优先于 icon */
  glyph?: string
  meta?: string
  imageSrc?: string
  title?: string
  loading?: boolean
}

export interface AiComposerEditorApi {
  setDoc(doc: string): void
  getDoc(): string
  getHead(): number
  focus(): void
  insertAtCursor(text: string): void
  replaceRange(from: number, to: number, text: string): void
  removeItems(predicate: (item: InlineItem) => boolean): void
  /** 在 from..to 插入技能 chip(不清除其它技能;同一技能是否去重由调用方决定) */
  insertSkill(id: string, from: number, to: number): void
  refresh(): void
}

interface Host {
  resolve: (item: InlineItem) => InlineDisplay | null
  onRemove: (item: InlineItem) => void
  onUpdate: (doc: string, head: number, docChanged: boolean) => void
  onEnter: () => boolean
  onEscape: () => boolean
  onPaste: (e: ClipboardEvent, view: EditorView) => boolean
  onModKey: (e: KeyboardEvent) => boolean
  removeLabel: string
}

const refreshEffect = StateEffect.define<null>()

const COMPOSER_THEME = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--text)',
    fontSize: '12.5px',
    fontFamily: 'inherit',
    width: '100%'
  },
  '.cm-scroller': {
    overflowY: 'auto',
    maxHeight: '160px',
    fontFamily: 'inherit',
    // 行距比正文更松:斜杠菜单、@ 引用和多行任务描述经常混排,
    // 1.6 时相邻行贴得太近,读起来像一整块。
    lineHeight: '2'
  },
  '.cm-content': {
    padding: '2px 1px 0',
    minHeight: '30px',
    caretColor: 'var(--accent2)'
  },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
  // 光标用中性前景色,不用强调色:chip 的边框本身就是强调色系(技能紫/笔记绿/定时黄),
  // 方向键跨过 chip 后光标正好落在 chip 的边框上,同色会被边框吃掉 —— 看起来像「光标丢了」。
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)', borderLeftWidth: '1.5px' },
  '.cm-selectionLayer .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
    { backgroundColor: 'var(--wash-accent)' },
  '.cm-placeholder': { color: 'var(--dim)', fontStyle: 'normal' },
  // chip 前后的 widgetBuffer 必须保留为 0×0 的 inline 盒。
  // 它不占视觉高度,但 CodeMirror 靠它在 widget 边界测量光标坐标;
  // display:none 会让 coordsAtPos(chip 起点) 返回 0,光标跨过引用块后消失。
  '.cm-widgetBuffer': { display: 'inline', width: '0', height: '0' }
})

class InlineRefWidget extends WidgetType {
  constructor(
    private readonly item: InlineItem,
    private readonly display: InlineDisplay,
    private readonly removeLabel: string,
    private readonly onRemove: (item: InlineItem) => void
  ) {
    super()
  }

  eq(other: InlineRefWidget): boolean {
    return (
      other.item.kind === this.item.kind &&
      other.item.raw === this.item.raw &&
      other.display.kind === this.display.kind &&
      other.display.label === this.display.label &&
      other.display.glyph === this.display.glyph &&
      other.display.meta === this.display.meta &&
      other.display.imageSrc === this.display.imageSrc &&
      other.display.loading === this.display.loading
    )
  }

  toDOM(): HTMLElement {
    const root = document.createElement('span')
    root.className = `ai-inline-ref k-${this.display.kind}${this.display.imageSrc ? ' has-image' : ''}${this.display.loading ? ' loading' : ''}`
    if (this.display.title) root.title = this.display.title

    if (this.display.imageSrc) {
      const img = document.createElement('img')
      img.className = 'ai-inline-thumb'
      img.src = this.display.imageSrc
      img.alt = this.display.label
      root.appendChild(img)
    } else if (this.display.glyph) {
      const glyph = document.createElement('span')
      glyph.className = 'ai-inline-kind ai-inline-glyph'
      glyph.textContent = this.display.glyph
      root.appendChild(glyph)
    } else {
      const icon = document.createElement('i')
      icon.className = `ai-inline-kind fa-solid ${this.display.loading ? 'fa-circle-notch fa-spin' : (this.display.icon ?? 'fa-link')}`
      root.appendChild(icon)
    }

    const label = document.createElement('span')
    label.className = 'ai-inline-label'
    label.textContent = this.display.label
    root.appendChild(label)

    if (this.display.meta) {
      const meta = document.createElement('span')
      meta.className = 'ai-inline-meta'
      meta.textContent = this.display.meta
      root.appendChild(meta)
    }

    const x = document.createElement('button')
    x.type = 'button'
    x.className = 'ai-inline-x'
    x.title = this.removeLabel
    x.setAttribute('aria-label', this.removeLabel)
    x.innerHTML = '<i class="fa-solid fa-xmark"></i>'
    x.addEventListener('mousedown', (e) => {
      // 不要让按钮抢走编辑器选区/焦点
      e.preventDefault()
      e.stopPropagation()
    })
    x.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.onRemove(this.item)
    })
    root.appendChild(x)
    return root
  }

  ignoreEvent(): boolean {
    return true
  }
}

function buildDecorations(view: EditorView, hostRef: React.RefObject<Host | null>): DecorationSet {
  const host = hostRef.current
  if (!host) return Decoration.none
  const items = parseInlineItems(view.state.doc.toString())
  const ranges = items.map((item) => {
    const display = host.resolve(item) ?? {
      kind: 'missing',
      label: item.kind === 'skill' ? item.id : item.key,
      icon: 'fa-link',
      title: item.raw
    }
    return Decoration.replace({
      widget: new InlineRefWidget(item, display, host.removeLabel, host.onRemove)
    }).range(item.start, item.end)
  })
  return Decoration.set(ranges, true)
}

function inlinePlugin(hostRef: React.RefObject<Host | null>) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, hostRef)
      }
      update(u: ViewUpdate): void {
        const forced = u.transactions.some((tr) =>
          tr.effects.some((e) => e.is(refreshEffect))
        )
        if (u.docChanged || u.viewportChanged || forced) {
          this.decorations = buildDecorations(u.view, hostRef)
        }
      }
    },
    { decorations: (v) => v.decorations }
  )
}

/**
 * 软换行处 chip 左侧的原生光标会塌成 0 高。
 *
 * 原因不在我们的 CSS:Decoration.replace 的 chip 前后各有一个 cm-widgetBuffer,
 * 当 chip 被挤到下一行时,buffer 留在上一行末尾,浏览器对「上一行末尾」这个位置
 * 给不出可见矩形,CodeMirror 只能画一根 0 高的光标。把 buffer 改成非 0 高度会让
 * 光标出现在上一行末尾(仍然不在 chip 左边),因此这里在 chip 左缘补画一根:
 * 只在选区头正好是 chip 起点、且原生光标已塌陷或落在上一行时显示。
 */
function cursorFixPlugin() {
  return ViewPlugin.fromClass(
    class {
      private readonly dom: HTMLDivElement
      private frame = 0
      constructor(private readonly view: EditorView) {
        this.dom = document.createElement('div')
        this.dom.className = 'ai-cursor-fix'
        this.dom.setAttribute('aria-hidden', 'true')
        view.scrollDOM.appendChild(this.dom)
        this.schedule()
      }
      update(u: ViewUpdate): void {
        if (u.selectionSet || u.docChanged || u.geometryChanged) this.schedule()
      }
      private schedule(): void {
        if (this.frame !== 0) return
        this.frame = requestAnimationFrame(() => {
          this.frame = 0
          this.place()
        })
      }
      private place(): void {
        const view = this.view
        if (!view.dom.isConnected) return
        const main = view.state.selection.main
        if (!main.empty) {
          this.dom.style.display = 'none'
          return
        }
        let widget: HTMLElement | null = null
        for (const el of view.contentDOM.querySelectorAll<HTMLElement>('.ai-inline-ref')) {
          if (view.posAtDOM(el) === main.head) {
            widget = el
            break
          }
        }
        if (!widget) {
          this.dom.style.display = 'none'
          return
        }
        const wr = widget.getBoundingClientRect()
        const native = view.coordsAtPos(main.head, main.assoc || 1)
        // 原生矩形塌陷(0 高)或落在 chip 上一行 —— 两种情况肉眼都看不到正确光标
        const collapsed = !native || native.bottom <= native.top
        const onPrevLine = !!native && wr.top > native.top + 1
        if (!collapsed && !onPrevLine) {
          this.dom.style.display = 'none'
          return
        }
        const scroller = view.scrollDOM.getBoundingClientRect()
        const left = wr.left - scroller.left + view.scrollDOM.scrollLeft * view.scaleX
        const top = wr.top - scroller.top + view.scrollDOM.scrollTop * view.scaleY
        this.dom.style.display = 'block'
        this.dom.style.left = `${left}px`
        this.dom.style.top = `${top}px`
        this.dom.style.height = `${wr.height}px`
      }
      destroy(): void {
        if (this.frame !== 0) cancelAnimationFrame(this.frame)
        this.dom.remove()
      }
    }
  )
}

function themeExtensions(hostRef: React.RefObject<Host | null>, placeholderComp: Compartment, placeholder: string): Extension[] {
  // 同一个 plugin 实例既要出装饰,也要喂给 atomicRanges:
  // 否则光标会进入被替换的 token 内部,按方向键要一个个字符地「穿过」不可见内容,
  // Backspace 也只会删掉 token 的一个字符。atomic 后方向键/退格都按整块处理。
  const inline = inlinePlugin(hostRef)
  return [
    COMPOSER_THEME,
    EditorView.lineWrapping,
    drawSelection(),
    cursorFixPlugin(),
    history(),
    keymap.of(defaultKeymap),
    keymap.of(historyKeymap),
    placeholderComp.of(placeholder === '' ? [] : placeholderExt(placeholder)),
    inline,
    EditorView.atomicRanges.of((view) => view.plugin(inline)?.decorations ?? Decoration.none),
    EditorView.updateListener.of((u) => {
      if (!u.docChanged && !u.selectionSet) return
      const doc = u.state.doc.toString()
      const head = u.state.selection.main.head
      hostRef.current?.onUpdate(doc, head, u.docChanged)
    }),
    Prec.highest(
      keymap.of([
        {
          key: 'Enter',
          run: (view) => {
            // 输入法组词中的 Enter 是选词;CodeMirror 也会在 composing 时自己吞掉,
            // 这里再挡一次,避免个别平台先触发 keymap。
            if (view.composing) return false
            return hostRef.current?.onEnter() ?? false
          }
        },
        {
          key: 'Escape',
          run: () => hostRef.current?.onEscape() ?? false
        }
      ])
    ),
    // 文件粘贴必须排在 CodeMirror 内置 paste 之前,否则默认处理器已经把文字插进去了
    Prec.highest(
      EditorView.domEventHandlers({
        paste: (e, view) => hostRef.current?.onPaste(e, view) ?? false,
        keydown: (e) => {
          if (e.isComposing) return false
          return hostRef.current?.onModKey(e) ?? false
        }
      })
    )
  ]
}

export function AiComposerEditor({
  value,
  placeholder,
  apiRef,
  resolve,
  onRemove,
  onUpdate,
  onEnter,
  onEscape,
  onPaste,
  onModKey,
  removeLabel
}: {
  value: string
  placeholder: string
  apiRef: React.MutableRefObject<AiComposerEditorApi | null>
  resolve: (item: InlineItem) => InlineDisplay | null
  onRemove: (item: InlineItem) => void
  onUpdate: (doc: string, head: number, docChanged: boolean) => void
  onEnter: () => boolean
  onEscape: () => boolean
  onPaste: (e: ClipboardEvent, view: EditorView) => boolean
  onModKey: (e: KeyboardEvent) => boolean
  removeLabel: string
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const host = useRef<Host | null>(null)
  const placeholderComp = useRef(new Compartment()).current
  // 每次 render 都换最新闭包,但编辑器只创建一次
  host.current = { resolve, onRemove, onUpdate, onEnter, onEscape, onPaste, onModKey, removeLabel }

  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: themeExtensions(host, placeholderComp, placeholder)
      })
    })
    viewRef.current = view
    apiRef.current = {
      setDoc(doc) {
        if (doc === view.state.doc.toString()) return
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: doc },
          selection: { anchor: doc.length }
        })
      },
      getDoc: () => view.state.doc.toString(),
      getHead: () => view.state.selection.main.head,
      focus: () => view.focus(),
      insertAtCursor(text) {
        view.dispatch(view.state.replaceSelection(text))
        view.focus()
      },
      replaceRange(from, to, text) {
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length }
        })
        view.focus()
      },
      removeItems(predicate) {
        const ranges = parseInlineItems(view.state.doc.toString()).filter(predicate)
        if (ranges.length === 0) return
        // 从后往前删,前面的位置不会失效
        view.dispatch({
          changes: ranges
            .slice()
            .sort((a, b) => b.start - a.start)
            .map((r) => ({ from: r.start, to: r.end, insert: '' }))
        })
        view.focus()
      },
      insertSkill(id, from, to) {
        const doc = view.state.doc.toString()
        const start = Math.max(0, Math.min(from, doc.length))
        const end = Math.max(start, Math.min(to, doc.length))
        const token = inlineTokenFor({ kind: 'skill', id })
        // 选区若覆盖/落在技能 chip 上(比如在 chip 紧后面敲了 `/查询`,又选中了它),
        // 先把这些 chip 并进替换范围,否则 ChangeSet 会报区间重叠。
        // 不与选区相交的旧技能一律保留 —— 这正是「一条消息多个技能」的关键。
        let cutFrom = start
        let cutTo = end
        for (const s of parseInlineItems(doc)) {
          if (s.kind !== 'skill') continue
          const overlaps = s.end > cutFrom && s.start < cutTo
          const containsCaret = start === end && s.start < start && s.end > start
          if (overlaps || containsCaret) {
            cutFrom = Math.min(cutFrom, s.start)
            cutTo = Math.max(cutTo, s.end)
          }
        }
        view.dispatch({
          changes: { from: cutFrom, to: cutTo, insert: `${token} ` },
          // 光标落在插入的 `token + 空格` 之后(接着打字就是任务描述)。
          // 不能 mapPos(cutFrom):它是替换区间的左边界,映射后仍停在 chip 前面。
          selection: { anchor: cutFrom + token.length + 1 }
        })
        view.focus()
      },
      refresh() {
        view.dispatch({ effects: refreshEffect.of(null) })
      }
    }
    view.focus()
    return () => {
      apiRef.current = null
      view.destroy()
      viewRef.current = null
    }
    // 只挂载一次;value/placeholder/回调都经 ref 桥接
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部值变化(发送后清空 / 撤回草稿回填 / 新对话)→ 替换文档。
  // 用户自己打字时 value 已经等于 doc,这里不会重复 dispatch。
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        selection: { anchor: value.length }
      })
    }
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: placeholderComp.reconfigure(placeholder === '' ? [] : placeholderExt(placeholder))
    })
  }, [placeholder, placeholderComp])

  return <div className="ai-composer-editor" ref={hostRef} />
}
