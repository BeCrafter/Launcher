// 笔记页:左 rail + 中编辑 + 右预览(三区,可折叠 rail、可拖分隔条)。
//
// 自动保存的生命周期在这里收口:切模块/失焦/关窗都要 flush。去抖计时器本身在 store 里
// (放组件里会在卸载时把待保存的改动一起带走)。

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { parentOf } from '@shared/notes'
import { useT } from '../../hooks/useT'
import { highlightCodeNodes } from '../../lib/code-highlight'
import { resolvePreviewSrc } from '../../lib/note-asset'
import {
  linePrefix,
  setEmbedSizeInBody,
  setMediaSizeInBody,
  type EmbedRange,
  type MediaSize,
  type MediaTarget
} from '../../lib/note-media-size'
import { collectAnchors, editorLineFor, previewScrollFor, type LineAnchor } from '../../lib/scroll-sync'
import { renderMarkdown, type CalloutKind, type DiagramBlock, type TableLabels } from '../../lib/markdown'
import { TABLE_BORDER_PX } from '@shared/note-table-style'
import { useSettingsStore } from '../../state/settings-store'
import { relTime } from '../../lib/rel-time'
import { showToast } from '../../lib/utils'
import { referenceNoteInAi } from '../../lib/ai-nav'
import { confirmDangerous } from '../../lib/elevation'
import { useNotesStore } from '../../state/notes-store'
import { useNoteRefPickerStore } from '../../state/note-ref-picker-store'
import { DiagramDialog, type DiagramDialogTarget } from './DiagramDialog'
import { EmbedDialog } from './EmbedDialog'
import { MermaidBlock } from './MermaidBlock'
import { NoteEditor, type NoteEditorHandle } from './NoteEditor'
import { NoteBlockMenu, NoteInsertMenu } from './NoteBlockMenus'
import type { MarkdownBlock } from '../../lib/markdown-blocks'
import { NoteRefChips } from './NoteRefChips'
import { NoteRefPicker } from './NoteRefPicker'
import { NotesRail } from './NotesRail'
import { NoteToolbar } from './NoteToolbar'

/** 渲染器引用必须是稳定的:预览的 memo 依赖它,每次新建函数会让整篇重解析 */
const HIGHLIGHT = highlightCodeNodes

export function NotesView(): React.JSX.Element {
  const t = useT()
  const railCollapsed = useNotesStore((s) => s.railCollapsed)
  const setRailCollapsed = useNotesStore((s) => s.setRailCollapsed)
  const draft = useNotesStore((s) => s.draft)
  const dirty = useNotesStore((s) => s.dirty)
  const saving = useNotesStore((s) => s.saving)
  const conflict = useNotesStore((s) => s.conflict)
  const externalChanged = useNotesStore((s) => s.externalChanged)
  const viewMode = useNotesStore((s) => s.viewMode)
  const splitRatio = useNotesStore((s) => s.splitRatio)
  const scrollSync = useNotesStore((s) => s.scrollSync)
  const setViewMode = useNotesStore((s) => s.setViewMode)
  const setSplitRatio = useNotesStore((s) => s.setSplitRatio)
  const toggleScrollSync = useNotesStore((s) => s.toggleScrollSync)
  const setBody = useNotesStore((s) => s.setBody)
  const setTitle = useNotesStore((s) => s.setTitle)
  const togglePin = useNotesStore((s) => s.togglePin)
  const toggleTask = useNotesStore((s) => s.toggleTask)
  const addRef = useNotesStore((s) => s.addRef)
  const removeRef = useNotesStore((s) => s.removeRef)
  const resolveConflict = useNotesStore((s) => s.resolveConflict)
  const remove = useNotesStore((s) => s.remove)
  const flush = useNotesStore((s) => s.flush)
  const openPicker = useNoteRefPickerStore((s) => s.openAt)
  // 表格边框的全局默认(单表可覆盖)。订阅整份 settings 而不是两个字段 ——
  // 两次 `useSettingsStore` 选择器在语言/主题切换时会各跑一遍,不划算
  const settings = useSettingsStore((s) => s.settings)

  const editorRef = useRef<NoteEditorHandle | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [diagram, setDiagram] = useState<DiagramDialogTarget | null>(null)
  const [embedOpen, setEmbedOpen] = useState(false)
  const [blockMenu, setBlockMenu] = useState<{ block: MarkdownBlock; anchor: DOMRect; line: number } | null>(null)
  const [insertMenu, setInsertMenu] = useState<{ line: number; anchor: DOMRect } | null>(null)
  const insertLineRef = useRef<number | null>(null)

  // 折叠只属于当前编辑会话:切换笔记或切换编辑/分栏/预览模式时清空,
  // 但不改正文、不清空 CodeMirror history,所以 Cmd+Z 仍只对应用户编辑。
  useEffect(() => {
    editorRef.current?.resetFolds()
  }, [draft?.id, viewMode])

  const openBlockMenu = useCallback((block: MarkdownBlock, anchor: DOMRect, line: number) => {
    setInsertMenu(null)
    setBlockMenu({ block, anchor, line })
  }, [])
  const openInsertMenu = useCallback((line: number, anchor: DOMRect) => {
    setBlockMenu(null)
    setInsertMenu({ line, anchor })
  }, [])
  const openDiagramAt = useCallback((line: number | null) => {
    insertLineRef.current = line
    setDiagram({ code: null, from: 0, to: 0 })
  }, [])
  const openEmbedAt = useCallback((line: number | null) => {
    insertLineRef.current = line
    setEmbedOpen(true)
  }, [])

  // ── 滚动同步 ──
  //
  // 两把锁记的是「我们自己刚把滚动条设成了多少」。滚动事件是异步派发的,
  // 用「正在同步」这种布尔标记挡不住(设完就清了,事件才到);比对数值才稳。
  const syncLock = useRef({ preview: -1, editor: -1 })
  const anchorCache = useRef<{ sig: string; anchors: LineAnchor[] }>({ sig: '', anchors: [] })
  /** 预览滚动条「正在滚动」的收尾定时器 */
  const scrollIdle = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * 取预览的源行锚点。用 scrollHeight 当签名:图片加载完、图表渲染完、用户打字
   * 都会改变它,而不变时直接复用 —— 每次滚动都重新量几十个元素会拖慢滚动。
   */
  const anchorsOf = useCallback((el: HTMLElement): LineAnchor[] => {
    const sig = `${el.scrollHeight}`
    if (anchorCache.current.sig === sig) return anchorCache.current.anchors
    const anchors = collectAnchors(el)
    anchorCache.current = { sig, anchors }
    return anchors
  }, [])

  const onEditorScroll = useCallback(() => {
    /*
     * ⚠ 只在**分栏**下联动。
     * 只预览时编辑区是 `display: none` —— 它的 scrollTop / clientHeight 全是 0 这类垃圾值。
     * 而回写(拖完列宽写回正文)会让编辑区内容被替换、它一动就触发这里,于是拿垃圾值去
     * 反推预览该滚到哪 → **预览被推到顶部**。用户报过:「只预览里调完列宽,页面回到最上面」。
     * 只编辑时预览根本不渲染,同理。
     */
    if (viewMode !== 'split') return
    if (!scrollSync) return
    const ed = editorRef.current
    const pv = previewRef.current
    if (ed === null || pv === null) return
    if (Math.abs(ed.scrollMetrics().top - syncLock.current.editor) < 2) return
    const max = Math.max(0, pv.scrollHeight - pv.clientHeight)
    const target = Math.min(Math.max(previewScrollFor(anchorsOf(pv), ed.topLine()), 0), max)
    pv.scrollTop = target
    syncLock.current.preview = pv.scrollTop // 读回:浏览器可能把值夹紧
  }, [scrollSync, anchorsOf])

  /**
   * 预览的滚动位置,「正文变了」之后要按原样放回去。
   *
   * 为什么需要:在预览里拖完表格 / 引用 / 媒体,回写会换掉整篇正文 → 预览重渲染。
   * 重渲染本身不动 scrollTop,但**内容高度会先塌一下**(块被替换的瞬间),浏览器就把
   * scrollTop 夹到 0 了 —— 松手后视野直接回到文章开头,用户得重新找刚才在改的那张表。
   * 这里在正文变化后把它放回去(按新高度夹一下,内容变短时不会越界)。
   */
  const lastPreviewTop = useRef(0)
  const restoreTop = useRef<number | null>(null)

  const onPreviewScroll = useCallback(() => {
    // 滚动条只在滚动时露脸(见 notes.css 的 [data-scrolling])。直接改 DOM 属性而不是
    // setState —— 滚动是每帧都在发生的事,走 React 会让整篇预览跟着重渲染。
    const pv = previewRef.current
    if (pv !== null) {
      lastPreviewTop.current = pv.scrollTop
      pv.dataset.scrolling = 'true'
      if (scrollIdle.current !== null) clearTimeout(scrollIdle.current)
      scrollIdle.current = setTimeout(() => {
        if (previewRef.current !== null) previewRef.current.dataset.scrolling = 'false'
      }, 900)
    }

    if (viewMode !== 'split') return // 同上:只有分栏时两边才谈得上「同一处」
    if (!scrollSync) return
    const ed = editorRef.current
    if (ed === null || pv === null) return
    if (Math.abs(pv.scrollTop - syncLock.current.preview) < 2) return
    ed.scrollToLine(editorLineFor(anchorsOf(pv), pv.scrollTop))
    syncLock.current.editor = ed.scrollMetrics().top
  }, [scrollSync, anchorsOf, viewMode])

  // 切模式 / 拖分隔条 / 换笔记之后,锚点全都变了 —— 缓存签名靠 scrollHeight,
  // 但宽度变化时高度可能刚好不变,这里显式作废一次
  useEffect(() => {
    anchorCache.current = { sig: '', anchors: [] }
    syncLock.current = { preview: -1, editor: -1 }
  }, [draft?.id, viewMode, splitRatio])

  // 正文换了(拖拽写回、AI 改、外部编辑…)→ 把预览的滚动位置放回去
  useEffect(() => {
    const pv = previewRef.current
    if (pv === null) return
    const want = lastPreviewTop.current
    if (want <= 0) return
    const max = Math.max(0, pv.scrollHeight - pv.clientHeight)
    const next = Math.min(want, max)
    if (Math.abs(pv.scrollTop - next) > 1) {
      pv.scrollTop = next
      // 我们自己设的,别让滚动同步把它当成「用户滚的」再反过来推编辑器
      syncLock.current.preview = pv.scrollTop
    }
  }, [draft?.body])

  // 定时器要跟着组件一起收掉,否则卸载后还会去碰已摘掉的 DOM
  useEffect(
    () => () => {
      if (scrollIdle.current !== null) clearTimeout(scrollIdle.current)
    },
    []
  )

  const renderDiagram = useCallback(
    (b: DiagramBlock): ReactNode => (
      <MermaidBlock
        key={b.key}
        code={b.code}
        // 单元格里的图只读(见 DiagramBlock.editable):它没有自己的源文行,按 from/to 回写会写坏表格行
        onEdit={b.editable ? (code) => setDiagram({ code, from: b.from, to: b.to }) : undefined}
      />
    ),
    []
  )

  // 提示块默认标题走 i18n。做成 useCallback 是因为它是 NotePreview 的 memo 依赖 ——
  // 每次新建函数会让整篇重新解析。
  const calloutLabel = useCallback((kind: CalloutKind): string => t(`notes.callout.${kind}`), [t])

  /**
   * 表格边框的全局默认,以 CSS 变量下发到预览区。
   * 单张表可以在 ```` ```table border=none ```` 里覆盖 —— 那层壳会自己再设一遍同名变量,
   * 就近生效(内联样式优先级高于祖先的)。
   */
  const tableBorder = settings?.notesTableBorder ?? 'thin'
  const tableColor = settings?.notesTableBorderColor ?? ''
  // 类型写成 Record<string, string> 而不是字面量:CSS 自定义属性不在 React 的
  // CSSProperties 里(它只认标准属性名),字面量会因「没有共同属性」被判成不兼容。
  const tableVars = useMemo<Record<string, string>>(
    () => ({
      '--md-table-bw': `${TABLE_BORDER_PX[tableBorder]}px`,
      ...(tableColor !== '' ? { '--md-table-bc': tableColor } : {})
    }),
    [tableBorder, tableColor]
  )

  /**
   * 拖完角柄 → 把新尺寸写回正文。
   *
   * 走 `setBody` 而不是直接改 CodeMirror:自动保存、dirty 标记、冲突检测都挂在 store 上,
   * 绕过它就会出现「界面上改了但没保存」。写入失败(同一张图在正文里出现多次、
   * 定位不到唯一一张)时明确提示,而不是悄悄什么都不做。
   */
  const onResizeMedia = useCallback(
    (target: MediaTarget, size: MediaSize) => {
      const cur = useNotesStore.getState().draft
      if (cur === null) return
      const next = setMediaSizeInBody(cur.body, target, size)
      if (next === null) {
        showToast(t('notes.media.resizeFailed'), '#fbbf24', 'fa-triangle-exclamation')
        return
      }
      if (next !== cur.body) setBody(next)
    },
    [setBody, t]
  )

  /** 网页嵌入拖完高度 → 改写围栏里的 height: 行。与图片走的是两条路(围栏配置 vs 行内语法) */
  const onResizeEmbed = useCallback(
    (range: EmbedRange, size: MediaSize) => {
      const cur = useNotesStore.getState().draft
      if (cur === null) return
      const next = setEmbedSizeInBody(cur.body, range, size)
      if (next === null) {
        showToast(t('notes.media.resizeFailed'), '#fbbf24', 'fa-triangle-exclamation')
        return
      }
      if (next !== cur.body) setBody(next)
    },
    [setBody, t]
  )

  /** 预览里改表格 → 写回正文。与拖拽一样走 setBody,自动保存/冲突检测都挂在 store 上 */
  const onEditTable = useCallback(
    (next: string) => {
      const cur = useNotesStore.getState().draft
      if (cur === null || next === cur.body) return
      setBody(next)
    },
    [setBody]
  )

  /** 表格编辑的文案。useCallback 是必须的 —— 它是预览 memo 的依赖 */
  const tableLabels = useMemo(
    () => ({
      addRow: t('notes.table.addRow'),
      addColumn: t('notes.table.addColumn'),
      delRow: t('notes.table.delRow'),
      delColumn: t('notes.table.delColumn'),
      editHint: t('notes.table.editHint'),
      resizeColumn: t('notes.table.resizeColumn'),
      resizeRow: t('notes.table.resizeRow')
    }),
    [t]
  )

  // 离开模块 / 失焦 / 关窗:一律先把缓冲落盘。失败也只是保持 dirty,绝不丢。
  useEffect(() => {
    const flush = (): void => void useNotesStore.getState().flush()
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (!useNotesStore.getState().dirty) return
      e.preventDefault()
      flush()
    }
    window.addEventListener('blur', flush)
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('blur', flush)
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('beforeunload', onBeforeUnload)
      flush()
    }
  }, [])

  // 分隔条拖动
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent): void => {
      const box = shellRef.current?.getBoundingClientRect()
      if (!box || box.width === 0) return
      setSplitRatio((e.clientX - box.left) / box.width)
    }
    const onUp = (): void => setDragging(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging, setSplitRatio])

  const onToggleTask = useCallback(
    (line: number, next: boolean) => {
      // 优先走编辑器:定点 dispatch 能进撤销栈(Cmd+Z 可撤)。编辑器不在(纯预览模式)则退回 store。
      const handle = editorRef.current
      if (handle) handle.toggleTaskAtLine(line, next)
      else toggleTask(line, next)
    },
    [toggleTask]
  )

  /**
   * 「在 AI 中引用」:编辑区有选区就引那一段,没有就引整篇。
   *
   * ⚠ 必须先 flush:正文是 main 在**发送时**现读盘上的,草稿还在 900ms 防抖窗口里的话,
   *   模型拿到的是上一版 —— 而用户看到的分明是刚改过的。
   */
  const referenceInAi = (): void => {
    void (async () => {
      await flush()
      const d = useNotesStore.getState().draft
      if (d === null) return
      const quote = editorRef.current?.selectionText() ?? ''
      referenceNoteInAi({ id: d.id, title: d.title }, quote)
      showToast(
        quote.trim() === ''
          ? t('notes.ai.referenced').replace('{NAME}', d.title)
          : t('notes.ai.referencedQuote')
              .replace('{NAME}', d.title)
              .replace('{N}', String(quote.length)),
        '#4ade80',
        'fa-wand-magic-sparkles'
      )
    })()
  }

  if (draft === null) {
    return (
      <div id="view-notes" className="notes-view">
        {!railCollapsed && <NotesRail />}
        <div className="notes-main notes-main-empty">
          {/*
           * ⚠ 这个折叠按钮**必须有**:它平时住在标题栏里,而标题栏只在打开了笔记时才渲染。
           * 于是「先折叠了目录树、又没打开任何笔记」就成了死胡同 —— 左栏是唯一的入口,
           * 而把它展开的按钮恰恰在左栏对面那个还没出现的标题栏上。用户只能去清 localStorage。
           */}
          <button
            type="button"
            className="notes-rail-toggle floating"
            title={railCollapsed ? t('notes.rail.expand') : t('notes.rail.collapse')}
            onClick={() => setRailCollapsed(!railCollapsed)}
          >
            <i className={railCollapsed ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left'} />
          </button>
          {/* 与左栏的首次引导同一套版式:同一次首屏,两边不该一个饱满一个单薄 */}
          <div className="notes-firstrun">
            <div className="notes-firstrun-icon">
              <i className="fa-regular fa-note-sticky" />
            </div>
            <div className="notes-firstrun-title">{t('notes.pick.title')}</div>
            <p className="notes-firstrun-hint">{t('notes.pick.hint')}</p>
          </div>
        </div>
        <NoteRefPicker />
      </div>
    )
  }

  const metaLocked = draft.opaque || draft.unclosed
  // 只显示目录部分;根层笔记没有目录,那一段就不出现
  const dirPart = parentOf(draft.id)


  return (
    <div id="view-notes" className="notes-view">
      {!railCollapsed && <NotesRail />}

      <div className="notes-main">
        <div className="notes-hd">
          <button
            type="button"
            className="notes-rail-toggle"
            title={railCollapsed ? t('notes.rail.expand') : t('notes.rail.collapse')}
            onClick={() => setRailCollapsed(!railCollapsed)}
          >
            <i className={railCollapsed ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left'} />
          </button>
          {/* 标题按整条路径来读:`目录/` + 可编辑的名字 + `.md`。
              前后两段只读 —— 它们由文件在磁盘上的位置决定,不是能随便改的字段。
              这样第三行那个「完整路径」就没有存在的必要了。 */}
          <div className="notes-path">
            {dirPart !== '' && <span className="notes-path-dir">{dirPart}/</span>}
            <span className="notes-title-wrap">
              {/* 镜像层:让包裹元素按文字实际宽度撑开,输入框再铺满它 ——
                  这样 `.md` 紧跟在标题后面,而不是被 flex 推到行尾 */}
              <span className="notes-title-mirror" aria-hidden="true">
                {draft.title !== '' ? draft.title : t('notes.field.titlePlaceholder')}
              </span>
              <input
                className="notes-title"
                // size=1:输入框默认 size=20 会给网格列贡献约 20 字符的固有宽度,
                // 把镜像层的宽度压过去 → `.md` 被推到行尾。压到 1 才由镜像决定列宽。
                size={1}
                value={draft.title}
                placeholder={t('notes.field.titlePlaceholder')}
                onChange={(e) => setTitle(e.target.value)}
                // 离开标题框时才改文件名:边打字边改会让文件被反复重命名(输入法尤其明显)
                onBlur={() => void useNotesStore.getState().syncFileName()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
              />
            </span>
            <span className="notes-path-ext">.md</span>
          </div>
          <div className="notes-hd-actions">
            {saving && <span className="notes-save-state">{t('notes.save.saving')}</span>}
            {!saving && dirty && <span className="notes-save-state dirty">{t('notes.save.dirty')}</span>}
            {!saving && !dirty && <span className="notes-save-state">{t('notes.save.saved')}</span>}
            <button
              type="button"
              className="notes-act"
              title={t('notes.action.referenceAi')}
              onClick={referenceInAi}
            >
              <i className="fa-solid fa-wand-magic-sparkles" />
            </button>
            <button
              type="button"
              className={'notes-act' + (draft.pinned ? ' active' : '')}
              title={draft.pinned ? t('notes.action.unpin') : t('notes.action.pin')}
              onClick={togglePin}
            >
              <i className="fa-solid fa-thumbtack" />
            </button>
            <button
              type="button"
              className="notes-act danger"
              title={t('notes.action.delete')}
              onClick={() => {
                void (async () => {
                  const ok = await confirmDangerous.request(
                    t('notes.delete.message').replace('{NAME}', draft.title)
                  )
                  if (ok) await remove(draft.id)
                })()
              }}
            >
              <i className="fa-solid fa-trash-can" />
            </button>
          </div>
        </div>

        {conflict !== null && (
          <div className="notes-banner conflict">
            <i className="fa-solid fa-code-merge" />
            <span>{t('notes.conflict.banner')}</span>
            <div className="notes-banner-actions">
              <button type="button" className="d-btn" onClick={() => void resolveConflict('disk')}>
                <span>{t('notes.conflict.useDisk')}</span>
              </button>
              <button type="button" className="d-btn accent" onClick={() => void resolveConflict('mine')}>
                <span>{t('notes.conflict.useMine')}</span>
              </button>
            </div>
          </div>
        )}
        {conflict === null && externalChanged && (
          <div className="notes-banner warn">
            <i className="fa-solid fa-triangle-exclamation" />
            <span>{t('notes.external.banner')}</span>
            <div className="notes-banner-actions">
              <button
                type="button"
                className="d-btn"
                onClick={() => {
                  const id = draft.id
                  void (async () => {
                    const { dataSource } = await import('../../data')
                    const note = await dataSource().notes.read(id)
                    if (note) {
                      useNotesStore.setState({
                        draft: { ...useNotesStore.getState().draft!, body: note.body, revision: note.revision },
                        dirty: false,
                        externalChanged: false
                      })
                      showToast(t('toast.noteReloaded'), '#60a5fa', 'fa-rotate')
                    }
                  })()
                }}
              >
                <span>{t('notes.external.reload')}</span>
              </button>
            </div>
          </div>
        )}

        {metaLocked && (
          <div className="notes-banner warn">
            <i className="fa-solid fa-lock" />
            <span>
              {draft.unclosed ? t('notes.fm.unclosed') : t('notes.fm.opaque')}
            </span>
          </div>
        )}
        {draft.frontmatterIssues.length > 0 && (
          <div className="notes-banner warn">
            <i className="fa-solid fa-triangle-exclamation" />
            <span>
              {t('notes.fm.issues')}
              {draft.frontmatterIssues.join('、')}
            </span>
          </div>
        )}
        {draft.refsUnparsed && (
          <div className="notes-banner warn">
            <i className="fa-solid fa-link-slash" />
            <span>{t('notes.refs.unparsed')}</span>
          </div>
        )}

        {/* 只有两行:标题行 + 这一行。视图切换在最左,竖线之后才是关联与标签 ——
            关联/标签多的时候这一行会自然折行,不需要为它们单独留一行。 */}
        <div className="notes-meta">
          <div className="notes-modes" role="group" aria-label={t('notes.mode.split')}>
            {(['split', 'edit', 'preview'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={'notes-mode-btn' + (viewMode === m ? ' active' : '')}
                title={t(`notes.mode.${m}`)}
                aria-label={t(`notes.mode.${m}`)}
                aria-pressed={viewMode === m}
                onClick={() => setViewMode(m)}
              >
                <i
                  className={
                    m === 'split'
                      ? 'fa-solid fa-table-columns'
                      : m === 'edit'
                        ? 'fa-solid fa-pen'
                        : 'fa-solid fa-eye'
                  }
                />
              </button>
            ))}
          </div>
          <span className="notes-meta-sep" aria-hidden="true" />
          {/* 联动滚动只在分栏下有意义 —— 单栏时这个按钮不该出现 */}
          {viewMode === 'split' && (
            <button
              type="button"
              className={'notes-sync-btn' + (scrollSync ? ' active' : '')}
              title={scrollSync ? t('notes.sync.on') : t('notes.sync.off')}
              aria-label={t('notes.sync.label')}
              aria-pressed={scrollSync}
              onClick={toggleScrollSync}
            >
              <i className={scrollSync ? 'fa-solid fa-link' : 'fa-solid fa-link-slash'} />
            </button>
          )}
          <NoteRefChips
            refs={draft.refs}
            onRemove={metaLocked || draft.refsUnparsed ? undefined : removeRef}
            onUpdate={
              metaLocked || draft.refsUnparsed
                ? undefined
                : (old, next) => {
                    removeRef(old)
                    addRef(next)
                  }
            }
          />
          {!metaLocked && !draft.refsUnparsed && (
            <button
              type="button"
              className="notes-add-ref"
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                openPicker(r.left, r.bottom + 6)
              }}
            >
              <i className="fa-solid fa-plus" />
              <span>{t('notes.ref.add')}</span>
            </button>
          )}
          {!metaLocked && (
            <div className="notes-tags-edit">
              {draft.tags.map((tag) => (
                <span key={tag} className="notes-tag-chip">
                  #{tag}
                  <button
                    type="button"
                    onClick={() => useNotesStore.getState().setTags(draft.tags.filter((x) => x !== tag))}
                  >
                    <i className="fa-solid fa-xmark" />
                  </button>
                </span>
              ))}
              <input
                className="notes-tag-input"
                value={tagInput}
                placeholder={t('notes.field.tagsPlaceholder')}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  const v = tagInput.trim()
                  if (v !== '' && !draft.tags.includes(v)) {
                    useNotesStore.getState().setTags([...draft.tags, v])
                  }
                  setTagInput('')
                }}
              />
            </div>
          )}
          <span className="notes-meta-time">
            {t('notes.meta.updatedAt').replace('{TIME}', relTime(draft.updated, t))}
          </span>
        </div>

        <div className="notes-shell" ref={shellRef}>
          {/* 纯预览模式下**不卸载**编辑器:重建 CodeMirror 会丢滚动位置、撤销栈与选区 */}
          <div
            className="notes-pane notes-editor-pane"
            style={{
              display: viewMode === 'preview' ? 'none' : 'flex',
              flex: viewMode === 'split' ? `${splitRatio} 1 0` : '1 1 0'
            }}
          >
            <NoteEditor
              value={draft.body}
              onChange={setBody}
              handleRef={editorRef}
              placeholder={t('notes.field.bodyPlaceholder')}
              onScroll={onEditorScroll}
              onBlockMenu={openBlockMenu}
              onEmptyMenu={openInsertMenu}
            />
          </div>
          {viewMode === 'split' && (
            <div
              className="notes-divider"
              role="separator"
              onPointerDown={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
            />
          )}
          {viewMode !== 'edit' && (
            <div
              className="notes-pane notes-preview"
              ref={previewRef}
              onScroll={onPreviewScroll}
              style={{ flex: viewMode === 'split' ? `${1 - splitRatio} 1 0` : '1 1 0' }}
            >
              <NotePreview
                body={draft.body}
                resolveImage={resolvePreviewSrc}
                onToggleTask={onToggleTask}
                renderDiagram={renderDiagram}
                calloutLabel={calloutLabel}
                resolveEmbed={resolvePreviewSrc}
                onResizeMedia={onResizeMedia}
                onResizeEmbed={onResizeEmbed}
                copyCodeLabel={t('common.copy')}
                onEditTable={onEditTable}
                tableLabels={tableLabels}
                tableVars={tableVars}
              />
            </div>
          )}
        </div>

        {/* 排版按钮只对编辑有意义:纯预览时不渲染整条,预览区因此拿到整块高度 */}
        {viewMode !== 'preview' && (
          <NoteToolbar
            handleRef={editorRef}
            body={draft.body}
            onDiagram={() => openDiagramAt(null)}
            onEmbed={() => openEmbedAt(null)}
          />
        )}
      {blockMenu !== null && (
        <NoteBlockMenu
          block={blockMenu.block}
          line={blockMenu.line}
          body={draft.body}
          anchor={blockMenu.anchor}
          handleRef={editorRef}
          onClose={() => setBlockMenu(null)}
          onInsertBelow={(line) => {
            setBlockMenu(null)
            setInsertMenu({ line, anchor: blockMenu.anchor })
          }}
          onDiagram={(line) => {
            setBlockMenu(null)
            openDiagramAt(line)
          }}
          onEmbed={(line) => {
            setBlockMenu(null)
            openEmbedAt(line)
          }}
        />
      )}
      {insertMenu !== null && (
        <NoteInsertMenu
          line={insertMenu.line}
          anchor={insertMenu.anchor}
          handleRef={editorRef}
          onClose={() => setInsertMenu(null)}
          onDiagram={(line) => {
            setInsertMenu(null)
            openDiagramAt(line)
          }}
          onEmbed={(line) => {
            setInsertMenu(null)
            openEmbedAt(line)
          }}
        />
      )}
      <NoteRefPicker />
      <DiagramDialog
        target={diagram}
        onClose={() => {
          insertLineRef.current = null
          setDiagram(null)
        }}
        onInsert={(source) => {
          const line = insertLineRef.current
          if (line === null) {
            editorRef.current?.insertFence('mermaid', source)
          } else {
            const block = '```mermaid\n' + source + '\n```'
            editorRef.current?.insertAtLine(line, block, block.length)
            insertLineRef.current = null
          }
        }}
        onUpdate={(from, to, source) => {
          /*
           * ⚠ 换掉的那几行要**带上前缀**。
           * 引用 / 提示块里的围栏行是 `> ```mermaid …` —— 直接写裸围栏会把这张图
           * 搬到引用外面去(表格那边踩过同一类)。
           */
          const prefix = linePrefix(draft.body.split('\n')[from] ?? '')
          editorRef.current?.replaceLines(
            from,
            to,
            ['```mermaid', ...source.split('\n'), '```'].map((l) => prefix + l).join('\n')
          )
        }}
      />
      <EmbedDialog
        open={embedOpen}
        onClose={() => {
          insertLineRef.current = null
          setEmbedOpen(false)
        }}
        onInsert={({ url, height }) => {
          const body = height === null ? url : `${url}\nheight: ${height}`
          const line = insertLineRef.current
          if (line === null) {
            editorRef.current?.insertFence('embed', body)
          } else {
            const block = `\`\`\`embed ${body}\n\`\`\``
            editorRef.current?.insertAtLine(line, block, block.length)
            insertLineRef.current = null
          }
        }}
      />
      </div>
    </div>
  )
}

/** 预览:走 markdown 的 extended 模式(与帮助页/AI 消息共用一份实现,互不影响) */
function NotePreview({
  body,
  resolveImage,
  onToggleTask,
  renderDiagram,
  calloutLabel,
  resolveEmbed,
  onResizeMedia,
  onResizeEmbed,
  copyCodeLabel,
  onEditTable,
  tableLabels,
  tableVars
}: {
  body: string
  resolveImage: (src: string) => string | null
  onToggleTask: (line: number, next: boolean) => void
  renderDiagram: (b: DiagramBlock) => ReactNode
  calloutLabel: (kind: CalloutKind) => string
  resolveEmbed: (url: string) => string | null
  onResizeMedia: (target: MediaTarget, size: MediaSize) => void
  onResizeEmbed: (range: EmbedRange, size: MediaSize) => void
  copyCodeLabel: string
  onEditTable: (body: string) => void
  tableLabels: TableLabels
  /** 表格边框的全局默认(单表可用 ```table 围栏覆盖) */
  tableVars: CSSProperties
}): React.JSX.Element {
  const t = useT()
  // 每次击键都会重解析整篇 —— 笔记体量下可接受,但不该在无关状态变化时白跑。
  // 依赖里那几个回调都是稳定引用(模块级函数 / useCallback([])),否则 memo 形同虚设。
  const rendered: ReactNode = useMemo(
    () =>
      renderMarkdown(body, 'note', {
        extended: true,
        resolveImage,
        onToggleTask,
        renderDiagram,
        highlight: HIGHLIGHT,
        calloutLabel,
        resolveEmbed,
        onResizeMedia,
        onResizeEmbed,
        copyCodeLabel,
        onEditTable,
        tableLabels,
        // 块级元素带上源行号 —— 编辑区与预览区的联动滚动全靠它
        lineAnchors: true
      }),
    [
      body,
      resolveImage,
      onToggleTask,
      renderDiagram,
      calloutLabel,
      resolveEmbed,
      onResizeMedia,
      onResizeEmbed,
      copyCodeLabel,
      onEditTable,
      tableLabels
    ]
  )
  if (body.trim() === '') {
    return <div className="notes-preview-empty">{t('notes.preview.empty')}</div>
  }
  return (
    <div className="notes-preview-body md-scope" style={tableVars}>
      {rendered}
    </div>
  )
}
