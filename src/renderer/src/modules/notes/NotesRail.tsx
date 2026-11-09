// 笔记列表栏:搜索(全文) / 标签筛选 / 置顶区 / 目录树 / 目录入口。
//
// 刻意**没有**排序与分组的内置 chip:那一行是应用自己的机关,不是用户的内容。
// 排序固定为「最近更新」,分组交给目录树 —— 用户的标签只占一行,而且没有标签时那一行也不出现。
//
// 行的形态也统一了:目录与笔记都是**单行**,列表里只有名字。摘要与标签属于正文,
// 在列表里重复一遍既挤,又和目录的层级感打架(要扫的是「有哪些东西」,不是「它讲了什么」)。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  baseNameOf,
  parentOf,
  splitFileExt,
  type NoteFileMeta,
  type NoteMeta,
  type NoteRef
} from '@shared/notes'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { useT } from '../../hooks/useT'
import { buildNoteTree, sortNotes, type NoteFolderNode } from '../../lib/note-tree'
import { fileKind, noteFileIcon } from '../../lib/note-file'
import { refTypeLabel } from '../../lib/note-refs'
import { rankByTagHits, tagHitsOf } from '../../lib/note-search'
import { aggregateTags, noteHasTag } from '../../lib/note-tags'
import { relTime } from '../../lib/rel-time'
import { confirmDangerous } from '../../lib/elevation'
import { useRailResize } from '../../lib/use-rail-resize'
import { useFilesStore } from '../../state/files-store'
import { useNotesStore } from '../../state/notes-store'
import { openFileDoc, openNoteDoc } from './doc-actions'

/**
 * 缩进栅格。目录与笔记/文件共用同一列:
 *   · 内容列 = ROW_PAD + depth·INDENT;
 *   · 目录图标与笔记/文件图标同列,目录名与笔记标题同列。
 * 展开状态由开/合文件夹图标、加粗与导引线表达,不再占折叠三角槽。
 */
const INDENT = 12
const ROW_PAD = 10
/** 图标槽宽,与 notes.css 的 14px 图标槽保持一致 */
const ICON_SLOT = 14
const rowPad = (depth: number): number => ROW_PAD + depth * INDENT
/** 导引线落在祖先图标槽的中线上 */
const GUIDE_LEFT = ROW_PAD + ICON_SLOT / 2

/** 每一层祖先画一条竖线,让嵌套关系可追踪(光靠缩进,深了就看不出谁属于谁) */
function IndentGuides({ depth }: { depth: number }): React.JSX.Element {
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <span key={i} className="notes-guide" style={{ left: GUIDE_LEFT + i * INDENT }} />
      ))}
    </>
  )
}

/**
 * 打开得很快时不把类型图标换成转圈 —— 本地读盘通常只有几十毫秒,换一下反而像闪屏。
 * 超过这个时长才显示加载态。E2E 通过 <html data-opening-spinner-delay> 控制快/慢两条路径。
 */
const OPENING_SPINNER_DELAY_MS = 200

function openingSpinnerDelay(): number {
  const raw =
    typeof document === 'undefined' ? undefined : document.documentElement.dataset.openingSpinnerDelay
  if (raw === undefined || raw === '') return OPENING_SPINNER_DELAY_MS
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : OPENING_SPINNER_DELAY_MS
}

/** 等主动作持续到阈值再显示;提前结束就保持原图标 */
function useDelayedOpening(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false)
  useLayoutEffect(() => {
    if (!active) {
      setShown(false)
      return
    }
    if (delayMs <= 0) {
      setShown(true)
      return
    }
    const id = setTimeout(() => setShown(true), delayMs)
    return () => clearTimeout(id)
  }, [active, delayMs])
  return active && shown
}

/** 行首图标槽:空闲显示类型图标,打开较慢才原位换成转圈 */
function RowIconSlot({
  opening,
  icon,
  kind
}: {
  opening: boolean
  icon: string
  kind: string
}): React.JSX.Element {
  const showSpinner = useDelayedOpening(opening, openingSpinnerDelay())
  return showSpinner ? (
    <i key="spin" className="fa-solid fa-circle-notch fa-spin notes-row-spin" aria-hidden="true" />
  ) : (
    <i key="icon" className={`fa-solid ${icon} notes-file-icon`} data-kind={kind} aria-hidden="true" />
  )
}

/** 正在编辑的目录名/文件名(新建或改名);null = 没有 */
interface NameEdit {
  mode: 'create' | 'rename'
  /** create 时是新建什么(笔记/文件 vs 目录);rename 时改的是目录、笔记还是文件 */
  kind: 'folder' | 'note' | 'file'
  /** 新建时的父目录 */
  parent: string
  /** 改名时的目标 id / 路径 */
  path: string
}

/** 新建文档时的默认主名与类型;类型是独立字段,编辑名字不会改类型 */
const NEW_DOC_NAME = '未命名'
const NEW_DOC_EXT = 'md'

/**
 * 行内的名字输入(改名 / 新建目录共用)。空名提交视为取消。
 */
function NameField({
  value,
  placeholder,
  onChange,
  onCommit,
  onCancel
}: {
  value: string
  placeholder: string
  onChange(value: string): void
  onCommit(): void
  onCancel(): void
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    el.focus()
    // 只在挂载时定位一次:每次重渲染都重选会把用户刚打的字吃掉
    const end = el.value.length
    el.setSelectionRange(end, end)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <input
      ref={ref}
      className="notes-folder-input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit()
        if (e.key === 'Escape') onCancel()
      }}
    />
  )
}

/**
 * 新建文档(笔记 / 其他文件)的行内输入:主名 + 独立的扩展名字段。
 * 类型不写在名字里,所以改名字不可能改变类型;默认 `未命名` + `md`。
 * 两个字段之间切换焦点不算离开(容器 onBlur 判断 relatedTarget),不会提前提交。
 */
function CreateDocFields({
  name,
  ext,
  placeholder,
  extLabel,
  onName,
  onExt,
  onCommit,
  onCancel
}: {
  name: string
  ext: string
  placeholder: string
  extLabel: string
  onName(value: string): void
  onExt(value: string): void
  onCommit(): void
  onCancel(): void
}): React.JSX.Element {
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = nameRef.current
    if (el === null) return
    el.focus()
    el.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const keys = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') onCommit()
    if (e.key === 'Escape') onCancel()
  }
  return (
    <div
      className="notes-create-fields"
      onBlur={(e) => {
        // 在两个字段之间移动焦点不提交;真正离开这一行才提交
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        onCommit()
      }}
    >
      <input
        ref={nameRef}
        className="notes-folder-input notes-create-name"
        value={name}
        placeholder={placeholder}
        onChange={(e) => onName(e.target.value)}
        onKeyDown={keys}
      />
      <span className="notes-create-ext" title={extLabel}>
        <span className="notes-create-dot">.</span>
        <input
          className="notes-create-ext-input"
          value={ext}
          aria-label={extLabel}
          onChange={(e) => onExt(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase())}
          onKeyDown={keys}
        />
      </span>
    </div>
  )
}

export function NotesRail(): React.JSX.Element {
  const t = useT()
  const notes = useNotesStore((s) => s.notes)
  const folders = useNotesStore((s) => s.folders)
  const files = useNotesStore((s) => s.files)
  const expanded = useNotesStore((s) => s.expanded)
  const selectedFolder = useNotesStore((s) => s.selectedFolder)
  const loaded = useNotesStore((s) => s.loaded)
  const error = useNotesStore((s) => s.error)
  const truncated = useNotesStore((s) => s.truncated)
  const truncatedFiles = useNotesStore((s) => s.truncatedFiles)
  const query = useNotesStore((s) => s.query)
  const searchResults = useNotesStore((s) => s.searchResults)
  const refFilter = useNotesStore((s) => s.refFilter)
  const tagFilter = useNotesStore((s) => s.tagFilter)
  const currentId = useNotesStore((s) => s.currentId)
  const openingId = useNotesStore((s) => s.openingId)
  // 文件是「同一时刻只开一个文档」的另一半:文件打开时笔记行不再高亮
  const activeFilePath = useFilesStore((s) => s.file?.path ?? null)
  const openingFilePath = useFilesStore((s) => s.openingPath)
  const leaveFile = useFilesStore((s) => s.leave)
  const dir = useNotesStore((s) => s.dir)
  const setQuery = useNotesStore((s) => s.setQuery)
  const pinnedCollapsed = useNotesStore((s) => s.pinnedCollapsed)
  const setPinnedCollapsed = useNotesStore((s) => s.setPinnedCollapsed)
  const filterByRef = useNotesStore((s) => s.filterByRef)
  const setTagFilter = useNotesStore((s) => s.setTagFilter)
  const toggleFolder = useNotesStore((s) => s.toggleFolder)
  const setSelectedFolder = useNotesStore((s) => s.setSelectedFolder)
  const setRailCollapsed = useNotesStore((s) => s.setRailCollapsed)
  // 左右拖拽调宽;拖到 50px 以下直接折叠(复用现有折叠状态与展开按钮)
  const { width, narrow, startResize, resetWidth, onResizeKeyDown } = useRailResize({
    storageKey: 'launcherNotesRailWidth',
    // 窄窗口保持原来的 200px 默认(与 notes.css 的 ≤860px 媒体查询一致)
    defaultWidth: window.innerWidth <= 860 ? 200 : 258,
    onCollapse: () => setRailCollapsed(true)
  })
  const createFolder = useNotesStore((s) => s.createFolder)
  const renameFolder = useNotesStore((s) => s.renameFolder)
  const removeFolder = useNotesStore((s) => s.removeFolder)
  const create = useNotesStore((s) => s.create)
  const createFile = useNotesStore((s) => s.createFile)
  const renameFile = useNotesStore((s) => s.renameFile)
  const moveNote = useNotesStore((s) => s.moveNote)
  const importPaths = useNotesStore((s) => s.importPaths)
  const openFile = useNotesStore((s) => s.openFile)
  const removeFile = useNotesStore((s) => s.removeFile)
  const setPinned = useNotesStore((s) => s.setPinned)
  const renameNote = useNotesStore((s) => s.renameNote)
  const remove = useNotesStore((s) => s.remove)

  const [edit, setEdit] = useState<NameEdit | null>(null)
  const [draftName, setDraftName] = useState('')
  /** 新建文档时独立的扩展名字段(默认 md) */
  const [draftExt, setDraftExt] = useState(NEW_DOC_EXT)
  /**
   * Enter 与 blur 可能在同一轮里各调一次 commitEdit:第二次拿着已经改过名的旧路径去提交,
   * 会白撞一次 not-found。用一个同步 ref 挡住(下一次 startEdit 才重新放开)。
   */
  const committingRef = useRef(false)
  /** 标签面板默认收起 —— 标签会越来越多,常驻铺开太占地方 */
  const [tagsOpen, setTagsOpen] = useState(false)
  // 滚动条只在滚动时露出来(见 .notes-rail-list 的 CSS)。停手约 0.9s 后自己隐去 ——
  // 常驻的滚动条在这么窄的一栏里很扎眼,而完全不要又让人不知道还能往下滚。
  // 拖拽:记住被拖的 id 与当前悬停的目标目录('' = 根层),用于高亮与合法性判断。
  // ⚠ 被拖的 id 用 ref 而不是只靠 state:dragstart → dragover 可能落在同一次事件循环里,
  //   那时 React 还没重渲染,state 仍是旧值 —— 合法性判断会误判成「没在拖」而拒绝放下。
  //   ref 是同步写入的,高亮另用 state(那个可以晚一帧)。
  const draggingRef = useRef<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  // OS 文件拖入是**另一套**状态:null = 没在拖;'' = 根层;其余 = 目标目录
  const [fileDragTarget, setFileDragTarget] = useState<string | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)
  const [scrolling, setScrolling] = useState(false)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (scrollTimer.current !== null) clearTimeout(scrollTimer.current)
    },
    []
  )

  /*
   * 滚动条自己画,不用原生的。两个原因:
   *   ① 原生滚动条一出现就占掉槽位,内容会横向抽动一下 —— 自己画的用绝对定位,完全不影响布局;
   *   ② 原生滚动条只能贴在容器内侧,做不到「骑在 rail 右侧那条分割线上」。
   * 用 ref 直接改样式而不是走 state:滚动时每帧都 setState 会把整棵树重渲染一遍。
   */
  const listRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)

  const syncThumb = useCallback((): void => {
    const el = listRef.current
    const thumb = thumbRef.current
    if (!el || !thumb) return
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollHeight <= clientHeight + 1) {
      thumb.style.display = 'none'
      return
    }
    const height = Math.max(28, (clientHeight / scrollHeight) * clientHeight)
    const maxTop = clientHeight - height
    thumb.style.display = 'block'
    thumb.style.height = `${height}px`
    thumb.style.transform = `translateY(${
      maxTop <= 0 ? 0 : (scrollTop / (scrollHeight - clientHeight)) * maxTop
    }px)`
  }, [])

  const onListScroll = (): void => {
    syncThumb()
    setScrolling(true)
    if (scrollTimer.current !== null) clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => setScrolling(false), 900)
  }

  const searching = query.trim() !== ''
  /** 筛选/搜索生效时摊平目录:否则深层命中会被折叠目录藏住 */
  const flat = searching || tagFilter !== null

  /**
   * 搜索词命中了哪些笔记的标签(id → 命中的标签名)。
   *
   * 标签行已经撤掉了 —— 标签会越来越多,铺一行既占地方又不好找。改成「边打字边联动」:
   * 由搜索框这个入口召回,而不是先点选再筛。规则本身在 lib/note-search.ts,有单测。
   * 完全在本地算:列表里本来就带着每篇的 tags,不必再问主进程一次。
   */
  const tagHits = useMemo(() => tagHitsOf(notes, query), [notes, query])
  const tagCounts = useMemo(() => aggregateTags(notes), [notes])

  const visible = useMemo(() => {
    let list = searchResults ?? notes
    if (refFilter !== null) {
      list = list.filter((n) => n.refs.some((r) => r.type === refFilter.type && r.key === refFilter.key))
    }
    if (tagFilter !== null) list = list.filter((n) => noteHasTag(n, tagFilter))
    // 按**创建时间**排,不按 updated:updated 会被自动保存/切换笔记时的 flush 刷新,
    // 于是「点一下笔记,列表就重排一次」—— 排序键本身会变,顺序就不可能稳。
    // created 一旦写入就不再动,顺序稳定;置顶仍由 sortNotes 内部优先。
    return rankByTagHits(sortNotes(list, 'created'), tagHits)
  }, [notes, searchResults, refFilter, tagFilter, tagHits])

  const pinned = useMemo(() => visible.filter((n) => n.pinned), [visible])
  const unpinned = useMemo(() => visible.filter((n) => !n.pinned), [visible])
  // 目录树只用于「没在搜索」时。搜索时**必须摊平渲染**:
  // buildNoteTree 会按笔记的路径自动补出目录节点,而目录默认是折叠的 ——
  // 于是「命中一篇在目录里的笔记」会被塞进折叠的目录下面,界面上什么都看不到
  // (搜标签尤其明显:命中的笔记标题里根本没有搜索词,一旦被折叠就彻底没线索)。
  const tree = useMemo(
    () => buildNoteTree(unpinned, folders, files),
    [unpinned, folders, files]
  )

  /** 能不能把正在拖的那个放进 target 目录 */
  // 内容或容器尺寸变化都要重算(展开目录、搜索出结果、窗口缩放)
  useEffect(() => {
    syncThumb()
    const el = listRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => syncThumb())
    ro.observe(el)
    return () => ro.disconnect()
  }, [syncThumb, visible, expanded, pinnedCollapsed, refFilter])

  const canDropInto = (target: string): boolean => {
    const id = draggingRef.current
    if (id === null) return false
    if (id === target || target.startsWith(`${id}/`)) return false
    return parentOf(id) !== target
  }

  /** 拖进来的是不是 OS 文件(内部笔记拖拽只带 text/plain) */
  const hasFiles = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('Files')

  /** 指针下最近一行的落点目录;行上的 data-drop-folder 由目录/笔记/文件行统一提供 */
  const fileDropPath = (e: React.DragEvent): string => {
    const hit = (e.target as Element | null)?.closest?.('[data-drop-folder]')
    return hit?.getAttribute('data-drop-folder') ?? ''
  }

  const onRailDragOver = (e: React.DragEvent): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const target = fileDropPath(e)
    setFileDragTarget((cur) => (cur === target ? cur : target))
  }

  const onRailDragLeave = (e: React.DragEvent): void => {
    if (!hasFiles(e)) return
    const next = e.relatedTarget as Node | null
    if (next !== null && railRef.current?.contains(next) === true) return
    setFileDragTarget(null)
  }

  const onRailDrop = (e: React.DragEvent): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    const target = fileDropPath(e)
    setFileDragTarget(null)
    const paths: string[] = []
    for (const file of [...e.dataTransfer.files]) {
      try {
        const path = window.launcher.filePath(file)
        if (path !== '') paths.push(path)
      } catch {
        // 从浏览器/聊天窗口拖来的合成 File 没有本地路径
      }
    }
    void importPaths(target, paths)
  }

  // 拖出窗口 / 在别处松手时浏览器不一定给 rail 发 dragleave,窗口级兜底
  useEffect(() => {
    const reset = (): void => setFileDragTarget(null)
    window.addEventListener('dragend', reset)
    window.addEventListener('drop', reset)
    return () => {
      window.removeEventListener('dragend', reset)
      window.removeEventListener('drop', reset)
    }
  }, [])

  const loading = !loaded && notes.length === 0
  /** 首次使用:一篇笔记、一个目录都没有 */
  const isEmpty = !loading && notes.length === 0 && folders.length === 0 && files.length === 0
  const startEdit = (next: NameEdit, initial = ''): void => {
    committingRef.current = false
    setEdit(next)
    setDraftName(initial)
    if (next.mode === 'create' && next.kind === 'note') setDraftExt(NEW_DOC_EXT)
  }
  const cancelEdit = (): void => {
    committingRef.current = false
    setEdit(null)
    setDraftName('')
  }
  /**
   * 新建文档:主名 + 扩展名分开提交。md(或留空)走笔记,其他扩展名按文件创建。
   * 名字里若已经带了同名后缀(如 `app.js` + js)先去掉,避免 `app.js.js`。
   */
  const createDoc = async (parent: string, rawName: string, rawExt: string): Promise<void> => {
    const ext = rawExt.trim().toLowerCase() || NEW_DOC_EXT
    const suffix = `.${ext}`
    const stripped = rawName.toLowerCase().endsWith(suffix) ? rawName.slice(0, -suffix.length) : rawName
    const name = stripped.trim()
    if (name === '') return
    if (ext === 'md' || ext === 'markdown') {
      await create(name, parent)
      return
    }
    const path = await createFile(parent, `${name}.${ext}`)
    if (path !== null) openFileDoc(path)
  }
  /**
   * 文件改名:先把打开中的缓冲落到旧路径,再让主进程改名,最后让文档跟随新路径。
   * 类型(扩展名)由主进程沿用旧文件,调用方只给主名。
   */
  const renameFileDoc = async (path: string, base: string): Promise<void> => {
    const fstate = useFilesStore.getState()
    if (fstate.file?.path === path) await fstate.flush()
    const stat = await renameFile(path, base)
    if (stat !== null) useFilesStore.getState().repath(path, stat)
  }
  const commitEdit = (): void => {
    if (edit === null || committingRef.current) return
    committingRef.current = true
    const name = draftName.trim()
    const cur = edit
    const ext = draftExt
    setEdit(null)
    setDraftName('')
    if (cur.mode === 'create') {
      if (cur.kind === 'folder') {
        if (name !== '') void createFolder(cur.parent, name)
      } else void createDoc(cur.parent, name, ext)
    } else if (name !== '') {
      if (cur.kind === 'note') void renameNote(cur.path, name)
      else if (cur.kind === 'folder') {
        if (name !== baseNameOf(cur.path)) void renameFolder(cur.path, name)
      } else if (name !== splitFileExt(baseNameOf(cur.path)).base) {
        void renameFileDoc(cur.path, name)
      }
    }
  }

  /** 目录行内的名字输入(改名 / 新建目录共用) */
  const nameInput = (placeholder: string): React.JSX.Element => (
    <NameField
      value={draftName}
      placeholder={placeholder}
      onChange={setDraftName}
      onCommit={commitEdit}
      onCancel={cancelEdit}
    />
  )

  /** 新建文档的两个输入框(主名 + 扩展名) */
  const createDocFields = (): React.JSX.Element => (
    <CreateDocFields
      name={draftName}
      ext={draftExt}
      placeholder={t('notes.field.fileNamePlaceholder')}
      extLabel={t('notes.field.extLabel')}
      onName={setDraftName}
      onExt={setDraftExt}
      onCommit={commitEdit}
      onCancel={cancelEdit}
    />
  )

  /** 笔记行:只有名字。可拖拽;悬停露出置顶与删除 */
  const noteRow = (n: NoteMeta, depth: number): React.JSX.Element => {
    const renaming = edit !== null && edit.mode === 'rename' && edit.kind === 'note' && edit.path === n.id
    const opening = n.id === openingId
    // 与文件行统一:目录里显示完整文件名。笔记都是 .md,标题里已经写了就不重复
    const fileName = /\.md$/i.test(n.title) ? n.title : `${n.title}.md`
    return (
    <div
      key={n.id}
      className={
        'notes-row' +
        (n.id === currentId && activeFilePath === null ? ' active' : '') +
        (opening ? ' opening' : '') +
        (draggingId === n.id ? ' dragging' : '')
      }
      style={{ paddingLeft: rowPad(depth) }}
      data-note-id={n.id}
      data-drop-folder={parentOf(n.id)}
      draggable
      // 点击热区放在整行:标题按钮只占内容区 16px,行的上下留白、左侧缩进、
      // 右侧留白和悬停动作浮层的背景都在按钮之外 —— 只挂在按钮上会「点了没反应」。
      // 改名时点别处只该失焦/提交,不能把笔记切走。
      onClick={() => {
        if (renaming) return
        openNoteDoc(n.id)
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', n.id)
        e.dataTransfer.effectAllowed = 'move'
        draggingRef.current = n.id
        setDraggingId(n.id)
      }}
      onDragEnd={() => {
        draggingRef.current = null
        setDraggingId(null)
        setDropTarget(null)
      }}
    >
      <IndentGuides depth={depth} />
      {renaming ? (
        <span className="notes-row-rename">{nameInput(t('notes.field.titlePlaceholder'))}</span>
      ) : (
        <button
          type="button"
          className="notes-row-main"
          title={opening ? t('notes.opening') : `${n.id} · ${relTime(n.updated, t)}`}
          aria-busy={opening || undefined}
        >
          <RowIconSlot opening={opening} icon="fa-file-lines" kind="markdown" />
          {n.pinned && <i className="fa-solid fa-thumbtack notes-row-pin" />}
          <span className="notes-row-title">{fileName}</span>
          {n.frontmatterIssues.length > 0 && (
            <i className="fa-solid fa-triangle-exclamation notes-row-warn" title={t('notes.fm.issues')} />
          )}
        </button>
      )}
      {tagHits.get(n.id) !== undefined && (
        <span className="notes-row-tagmatch" title={t('notes.row.tagMatch')}>
          #{tagHits.get(n.id)}
        </span>
      )}
      <span className="notes-row-acts" style={renaming ? { display: 'none' } : undefined}>
        <button
          type="button"
          title={t('notes.row.rename')}
          onClick={(e) => {
            e.stopPropagation()
            startEdit({ mode: 'rename', kind: 'note', parent: '', path: n.id }, n.title)
          }}
        >
          <i className="fa-solid fa-pen" />
        </button>
        <button
          type="button"
          title={n.pinned ? t('notes.row.unpin') : t('notes.row.pin')}
          onClick={(e) => {
            e.stopPropagation()
            void setPinned(n.id, !n.pinned)
          }}
        >
          <i className="fa-solid fa-thumbtack" />
        </button>
        <button
          type="button"
          className="danger"
          title={t('notes.row.delete')}
          onClick={(e) => {
            e.stopPropagation()
            void (async () => {
              const ok = await confirmDangerous.request(
                t('notes.delete.message').replace('{NAME}', n.title)
              )
              if (ok) await remove(n.id)
            })()
          }}
        >
          <i className="fa-solid fa-trash-can" />
        </button>
      </span>
    </div>
    )
  }

  /** 文件行:单击在应用内打开;系统默认应用是悬停动作里的显式按钮 */
  const fileRow = (f: NoteFileMeta, depth: number): React.JSX.Element => {
    const active = f.path === activeFilePath
    const opening = f.path === openingFilePath
    const kind = fileKind(f.ext, f.name)
    const renaming = edit !== null && edit.mode === 'rename' && edit.kind === 'file' && edit.path === f.path
    const ext = splitFileExt(f.name).ext
    return (
      <div
        key={`file:${f.path}`}
        className={
          'notes-row notes-file-row' +
          (active ? ' active' : '') +
          (opening ? ' opening' : '')
        }
        style={{ paddingLeft: rowPad(depth) }}
        data-file-path={f.path}
        data-file-kind={kind}
        data-drop-folder={parentOf(f.path)}
        title={f.path}
        // 整行热区(与笔记行一致):行的留白、缩进与悬停浮层都算点击范围
        // 改名时点别处只该提交,不能把文件切走
        onClick={() => {
          if (renaming) return
          openFileDoc(f.path)
        }}
      >
        <IndentGuides depth={depth} />
        {renaming ? (
          <span className="notes-file-rename">
            {nameInput(t('notes.field.fileNamePlaceholder'))}
            {ext !== '' && <span className="notes-file-rename-ext">.{ext}</span>}
          </span>
        ) : (
          <div
            className="notes-row-main notes-file-main"
            role="button"
            tabIndex={0}
            title={t('notes.file.open')}
            aria-busy={opening || undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                openFileDoc(f.path)
              }
            }}
          >
            <RowIconSlot opening={opening} icon={noteFileIcon(f.ext, f.name)} kind={kind} />
            <span className="notes-row-title">{f.name}</span>
          </div>
        )}
        <span
          className="notes-row-acts"
          onClick={(e) => e.stopPropagation()}
          style={renaming ? { display: 'none' } : undefined}
        >
          <button
            type="button"
            data-file-action="open-external"
            title={t('notes.file.openExternal')}
            onClick={(e) => {
              e.stopPropagation()
              void openFile(f.path)
            }}
          >
            <i className="fa-solid fa-arrow-up-right-from-square" />
          </button>
          <button
            type="button"
            data-file-action="rename"
            title={t('notes.file.rename')}
            onClick={(e) => {
              e.stopPropagation()
              startEdit(
                { mode: 'rename', kind: 'file', parent: '', path: f.path },
                splitFileExt(f.name).base
              )
            }}
          >
            <i className="fa-solid fa-pen" />
          </button>
          <button
            type="button"
            data-file-action="reveal"
            title={t('notes.file.reveal')}
            onClick={(e) => {
              e.stopPropagation()
              void window.launcher.notes.reveal(f.path)
            }}
          >
            <i className="fa-solid fa-folder-open" />
          </button>
          <button
            type="button"
            data-file-action="delete"
            className="danger"
            title={t('notes.file.delete')}
            onClick={(e) => {
              e.stopPropagation()
              void (async () => {
                const ok = await confirmDangerous.request(
                  t('notes.file.deleteMessage').replace('{NAME}', f.name)
                )
                if (!ok) return
                if (active) await leaveFile()
                await removeFile(f.path)
              })()
            }}
          >
            <i className="fa-solid fa-trash-can" />
          </button>
        </span>
      </div>
    )
  }

  /**
   * 递归铺目录。**刻意用命令式的 if + push,不写 `{isOpen && out.push(...)}`** ——
   * `Array.push` 返回的是新长度,那个表达式会算出一个数字并被 React 当文本渲染出来。
   */
  const folderBranch = (node: NoteFolderNode, depth: number): React.JSX.Element[] => {
    const out: React.JSX.Element[] = []
    for (const f of node.folders) {
      const isOpen = expanded.has(f.path)
      const renaming = edit !== null && edit.mode === 'rename' && edit.path === f.path
      out.push(
        <div
          key={`f:${f.path}`}
          className={
            'notes-folder-row' +
            (selectedFolder === f.path ? ' selected' : '') +
            (dropTarget === f.path ? ' drop-target' : '') +
            (fileDragTarget === f.path ? ' file-drop-target' : '') +
            (draggingId === f.path ? ' dragging' : '')
          }
          style={{ paddingLeft: rowPad(depth) }}
          data-folder-path={f.path}
          data-drop-folder={f.path}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', f.path)
            e.dataTransfer.effectAllowed = 'move'
            draggingRef.current = f.path
            setDraggingId(f.path)
          }}
          onDragEnd={() => {
            draggingRef.current = null
            setDraggingId(null)
            setDropTarget(null)
          }}
          onDragOver={(e) => {
            // OS 文件拖入由 rail 根节点统一处理(要借用 data-drop-folder 取落点)
            if (hasFiles(e) || !canDropInto(f.path)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropTarget(f.path)
          }}
          onDrop={(e) => {
            if (hasFiles(e)) return
            e.preventDefault()
            e.stopPropagation() // 别让列表容器的「放到根层」也接一手
            const id = e.dataTransfer.getData('text/plain')
            draggingRef.current = null
            setDropTarget(null)
            setDraggingId(null)
            if (id !== '') void moveNote(id, f.path)
          }}
        >
          <IndentGuides depth={depth} />
          {renaming ? (
            <span className="notes-folder-rename">{nameInput(t('notes.folder.namePlaceholder'))}</span>
          ) : (
            <button
              type="button"
              className="notes-folder-name"
              aria-expanded={isOpen}
              onClick={() => {
                setSelectedFolder(f.path)
                toggleFolder(f.path)
              }}
              title={f.path}
            >
              <i className={isOpen ? 'fa-regular fa-folder-open' : 'fa-regular fa-folder'} />
              <span>{f.name}</span>
            </button>
          )}
          <span className="notes-folder-acts" style={renaming ? { display: 'none' } : undefined}>
            <button
              type="button"
              title={t('notes.folder.newNote')}
              onClick={() => {
                setSelectedFolder(f.path)
                useNotesStore.getState().setExpanded(f.path, true)
                startEdit({ mode: 'create', kind: 'note', parent: f.path, path: '' }, NEW_DOC_NAME)
              }}
            >
              <i className="fa-solid fa-plus" />
            </button>
            <button
              type="button"
              title={t('notes.folder.newSub')}
              onClick={() => {
                setSelectedFolder(f.path)
                useNotesStore.getState().setExpanded(f.path, true)
                startEdit({ mode: 'create', kind: 'folder', parent: f.path, path: '' })
              }}
            >
              <i className="fa-regular fa-folder-closed" />
            </button>
            <button
              type="button"
              title={t('notes.folder.rename')}
              onClick={() => startEdit({ mode: 'rename', kind: 'folder', parent: '', path: f.path }, f.name)}
            >
              <i className="fa-solid fa-pen" />
            </button>
            <button
              type="button"
              className="danger"
              title={t('notes.folder.delete')}
              onClick={() => {
                void (async () => {
                  const ok = await confirmDangerous.request(
                    t('notes.folder.deleteMessage').replace('{NAME}', f.name)
                  )
                  if (ok) await removeFolder(f.path)
                })()
              }}
            >
              <i className="fa-solid fa-trash-can" />
            </button>
          </span>
        </div>
      )
      if (edit !== null && edit.mode === 'create' && edit.parent === f.path) {
        const creatingDoc = edit.kind === 'note'
        out.push(
          <div
            key={`ec:${f.path}`}
            className="notes-folder-edit"
            style={{ paddingLeft: rowPad(depth + 1) }}
          >
            {creatingDoc ? createDocFields() : nameInput(t('notes.folder.namePlaceholder'))}
          </div>
        )
      }
      if (isOpen) out.push(...folderBranch(f, depth + 1))
    }
    for (const n of node.notes) out.push(noteRow(n, depth))
    for (const f of node.files) out.push(fileRow(f, depth))
    return out
  }

  const pinnedRef = useRef<HTMLDivElement | null>(null)

  return (
    <div
      ref={railRef}
      className={'notes-rail' + (narrow ? ' rail-narrow' : '')}
      style={{ width }}
      onDragOver={onRailDragOver}
      onDragLeave={onRailDragLeave}
      onDrop={onRailDrop}
    >
      {/* 一篇都没有时连搜索框一起收起来:没有东西可搜,摆在那儿只是噪音。
          (首启引导自己带顶部留白,所以这里不需要留占位。) */}
      {!isEmpty && (
        <div className="notes-rail-top">
          <div className="notes-rail-search">
            <i className="fa-solid fa-magnifying-glass" />
            <input
              value={query}
              placeholder={t('notes.rail.search')}
              onChange={(e) => void setQuery(e.target.value)}
            />
            {searching && (
              <button type="button" className="notes-rail-clear" onClick={() => void setQuery('')}>
                <i className="fa-solid fa-circle-xmark" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 标签面板:默认收起,只占一行;展开后是限高滚动的 pill 墙 */}
      {!isEmpty && tagCounts.length > 0 && (
        <div className="notes-tag-panel">
          <button
            type="button"
            className="notes-tag-panel-hd"
            onClick={() => setTagsOpen((v) => !v)}
            title={tagsOpen ? t('notes.folder.collapse') : t('notes.folder.expand')}
          >
            <i className={tagsOpen ? 'fa-solid fa-caret-down' : 'fa-solid fa-caret-right'} />
            <i className="fa-solid fa-hashtag" />
            <span>{t('notes.tags.panelTitle')}</span>
            <span className="notes-tag-count">{tagCounts.length}</span>
          </button>
          {tagsOpen && (
            <div className="notes-tag-list">
              {tagCounts.map((tc) => (
                <button
                  key={tc.key}
                  type="button"
                  className={'notes-tag-pill' + (tagFilter === tc.key ? ' active' : '')}
                  onClick={() => setTagFilter(tagFilter === tc.key ? null : tc.key)}
                >
                  #{tc.tag}
                  <span className="notes-tag-count">{tc.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 当前筛选:与关联筛选一样用可清除的 chip 表达 */}
      {tagFilter !== null && (
        <div className="notes-rail-active">
          <span className="notes-rail-chip">
            <i className="fa-solid fa-hashtag" />
            {tagFilter}
            <button type="button" onClick={() => setTagFilter(null)} title={t('notes.tags.clear')}>
              <i className="fa-solid fa-xmark" />
            </button>
          </span>
        </div>
      )}

      {/* 只给关联留一行 —— 标签的选中态由它自己的高亮表达,不需要再复述一遍 */}
      {refFilter !== null && (
        <div className="notes-rail-active">
          <span className="notes-rail-chip">
            <i className="fa-solid fa-link" />
            {refTypeLabel(refFilter.type, t)} · {refFilter.label}
            <button type="button" onClick={() => filterByRef(null)}>
              <i className="fa-solid fa-xmark" />
            </button>
          </span>
        </div>
      )}

      <div className="notes-rail-listwrap">
      {/* OS 文件拖入的落点提示:骑在列表顶部,不参与命中检测 */}
      {fileDragTarget !== null && (
        <div className="notes-import-hint" aria-hidden="true">
          <i className="fa-solid fa-file-import" />
          <span>
            {fileDragTarget === ''
              ? t('notes.import.hintRoot')
              : t('notes.import.hint').replace('{NAME}', baseNameOf(fileDragTarget))}
          </span>
        </div>
      )}
      {/* 列表本身**不再是投放区**:以前整片空白都能接住拖拽,从目录里随手一拖就掉到最外层,
          太容易误触。根层投放改成下面那条只在拖拽时出现的明确投放条。 */}
      <div
        ref={listRef}
        className="notes-rail-list"
        data-dragging={draggingId !== null ? 'true' : undefined}
        onScroll={onListScroll}
      >
        {error !== null && (
          <div className="notes-rail-error">
            <i className="fa-solid fa-triangle-exclamation" />
            <span>{error}</span>
          </div>
        )}
        {loading && <Skeleton rows={5} />}
        {/* 首次使用(既没有目录也没有笔记)时给一块更完整的引导:
            这里能做什么、怎么开始、以及「把已有目录放进来也能用」这条最容易被忽略的能力 */}
        {isEmpty && !searching && (
          <div className="notes-firstrun">
            <div className="notes-firstrun-icon">
              <i className="fa-regular fa-note-sticky" />
            </div>
            <div className="notes-firstrun-title">{t('notes.empty.title')}</div>
            <p className="notes-firstrun-hint">{t('notes.empty.hint')}</p>
            <p className="notes-firstrun-sub">{t('notes.empty.sub')}</p>
          </div>
        )}
        {!loading && flat && visible.length === 0 && (
          <EmptyState
            icon="fa-solid fa-magnifying-glass"
            text={tagFilter !== null ? t('notes.tagFilterEmpty') : t('notes.searchEmpty')}
          />
        )}

        {/* 置顶区:始终在列表最顶 —— 这是「置顶」二字唯一的兑现方式 */}
        {pinned.length > 0 && (
          <div className="notes-pinned" ref={pinnedRef}>
            <button
              type="button"
              className="notes-group-hd notes-pinned-hd"
              onClick={() => setPinnedCollapsed(!pinnedCollapsed)}
              title={pinnedCollapsed ? t('notes.folder.expand') : t('notes.folder.collapse')}
            >
              <i className={pinnedCollapsed ? 'fa-solid fa-caret-right' : 'fa-solid fa-caret-down'} />
              <i className="fa-solid fa-thumbtack" />
              <span>{t('notes.pinned.section')}</span>
              <span className="notes-group-count">{pinned.length}</span>
            </button>
            {!pinnedCollapsed && pinned.map((n) => noteRow(n, 0))}
          </div>
        )}

        {flat ? unpinned.map((n) => noteRow(n, 0)) : folderBranch(tree, 0)}

        {/* 新建目录只在这里出现:它是**根层**才需要的东西 ——
            子目录从目录行 hover 出来的按钮建,不需要再占一个常驻入口。 */}
        {/* 根层投放条:只在拖拽时出现,并明确写着「移到最外层」 */}
        {draggingId !== null && canDropInto('') && (
          <div
            className={'notes-rootdrop' + (dropTarget === '' ? ' active' : '')}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDropTarget('')
            }}
            onDrop={(e) => {
              e.preventDefault()
              const id = e.dataTransfer.getData('text/plain')
              draggingRef.current = null
              setDropTarget(null)
              setDraggingId(null)
              if (id !== '') void moveNote(id, '')
            }}
          >
            <i className="fa-solid fa-arrow-turn-up" />
            <span>{t('notes.move.toRoot')}</span>
          </div>
        )}

        {edit !== null && edit.mode === 'create' && edit.parent === '' ? (
          <div className="notes-folder-edit" style={{ paddingLeft: rowPad(0) }}>
            {edit.kind === 'note'
              ? createDocFields()
              : nameInput(t('notes.folder.namePlaceholder'))}
          </div>
        ) : (
          <div className={'notes-new-row' + (isEmpty ? ' prominent' : '')}>
            {/* 根层两个入口并排:上面那颗 + 是「建到当前选中的目录里」,
                这里明确是「建在根层」—— 否则一旦选过某个目录,就再也没法在根层新建了 */}
            <button
              type="button"
              className="notes-new-folder"
              onClick={() => startEdit({ mode: 'create', kind: 'note', parent: '', path: '' }, NEW_DOC_NAME)}
            >
              <i className="fa-solid fa-plus" />
              <span>{t('notes.action.new')}</span>
            </button>
            <button
              type="button"
              className="notes-new-folder"
              onClick={() => startEdit({ mode: 'create', kind: 'folder', parent: '', path: '' })}
            >
              <i className="fa-solid fa-plus" />
              <span>{t('notes.folder.new')}</span>
            </button>
          </div>
        )}

        {truncated > 0 && (
          <div className="notes-rail-truncated">{t('notes.truncated').replace('{N}', String(truncated))}</div>
        )}
        {truncatedFiles > 0 && (
          <div className="notes-rail-truncated">
            {t('notes.truncatedFiles').replace('{N}', String(truncatedFiles))}
          </div>
        )}
      </div>
      <div
        className="notes-rail-scrollbar"
        ref={thumbRef}
        data-scrolling={scrolling ? 'true' : undefined}
        aria-hidden="true"
      />
      </div>

      <div className="notes-rail-ft">
        <button
          type="button"
          className="notes-rail-dir"
          title={dir}
          onClick={() => void window.launcher.notes.reveal()}
        >
          <i className="fa-regular fa-folder-open" />
          <span>{dir}</span>
        </button>
      </div>

      {/* 拖拽条:骑在 rail 的右边界上,不占布局宽度。拖到 <50px 会直接折叠。 */}
      <div
        className="rail-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('common.railResize')}
        title={t('common.railResize')}
        tabIndex={0}
        onPointerDown={startResize}
        onDoubleClick={resetWidth}
        onKeyDown={onResizeKeyDown}
      />
    </div>
  )
}

/** 服务侧反查用:统计某关联下有几篇笔记 */
export function countNotesForRef(refs: NoteMeta[], ref: NoteRef): number {
  return refs.filter((n) => n.refs.some((r) => r.type === ref.type && r.key === ref.key)).length
}
