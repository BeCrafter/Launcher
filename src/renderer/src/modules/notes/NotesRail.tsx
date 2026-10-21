// 笔记列表栏:搜索(全文) / 标签筛选 / 置顶区 / 目录树 / 目录入口。
//
// 刻意**没有**排序与分组的内置 chip:那一行是应用自己的机关,不是用户的内容。
// 排序固定为「最近更新」,分组交给目录树 —— 用户的标签只占一行,而且没有标签时那一行也不出现。
//
// 行的形态也统一了:目录与笔记都是**单行**,列表里只有名字。摘要与标签属于正文,
// 在列表里重复一遍既挤,又和目录的层级感打架(要扫的是「有哪些东西」,不是「它讲了什么」)。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { baseNameOf, parentOf, type NoteMeta, type NoteRef } from '@shared/notes'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { useT } from '../../hooks/useT'
import { buildNoteTree, countNotesIn, sortNotes, type NoteFolderNode } from '../../lib/note-tree'
import { refTypeLabel } from '../../lib/note-refs'
import { rankByTagHits, tagHitsOf } from '../../lib/note-search'
import { relTime } from '../../lib/rel-time'
import { confirmDangerous } from '../../lib/elevation'
import { useRailResize } from '../../lib/use-rail-resize'
import { useNotesStore } from '../../state/notes-store'

/**
 * 缩进栅格。目录与笔记共用同一套步进,并让笔记标题对齐到**目录图标**那一列 ——
 * 层级靠缩进表达,而不是靠字号差。
 */
const INDENT = 15
const folderPad = (depth: number): number => 2 + depth * INDENT
const notePad = (depth: number): number => 18 + depth * INDENT

/** 每一层祖先画一条竖线,让嵌套关系可追踪(光靠缩进,深了就看不出谁属于谁) */
function IndentGuides({ depth }: { depth: number }): React.JSX.Element {
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <span key={i} className="notes-guide" style={{ left: 9 + i * INDENT }} />
      ))}
    </>
  )
}

/** 正在编辑的目录名(新建或改名);null = 没有 */
interface NameEdit {
  mode: 'create' | 'rename'
  /** 改名时改的是目录还是笔记(两者的提交走不同的动作) */
  kind: 'folder' | 'note'
  /** 新建时的父目录 */
  parent: string
  /** 改名时的目标 id */
  path: string
}

export function NotesRail(): React.JSX.Element {
  const t = useT()
  const notes = useNotesStore((s) => s.notes)
  const folders = useNotesStore((s) => s.folders)
  const expanded = useNotesStore((s) => s.expanded)
  const selectedFolder = useNotesStore((s) => s.selectedFolder)
  const loaded = useNotesStore((s) => s.loaded)
  const error = useNotesStore((s) => s.error)
  const truncated = useNotesStore((s) => s.truncated)
  const query = useNotesStore((s) => s.query)
  const searchResults = useNotesStore((s) => s.searchResults)
  const refFilter = useNotesStore((s) => s.refFilter)
  const currentId = useNotesStore((s) => s.currentId)
  const dir = useNotesStore((s) => s.dir)
  const setQuery = useNotesStore((s) => s.setQuery)
  const pinnedCollapsed = useNotesStore((s) => s.pinnedCollapsed)
  const setPinnedCollapsed = useNotesStore((s) => s.setPinnedCollapsed)
  const filterByRef = useNotesStore((s) => s.filterByRef)
  const open = useNotesStore((s) => s.open)
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
  const moveNote = useNotesStore((s) => s.moveNote)
  const setPinned = useNotesStore((s) => s.setPinned)
  const renameNote = useNotesStore((s) => s.renameNote)
  const remove = useNotesStore((s) => s.remove)

  const [edit, setEdit] = useState<NameEdit | null>(null)
  const [draftName, setDraftName] = useState('')
  // 滚动条只在滚动时露出来(见 .notes-rail-list 的 CSS)。停手约 0.9s 后自己隐去 ——
  // 常驻的滚动条在这么窄的一栏里很扎眼,而完全不要又让人不知道还能往下滚。
  // 拖拽:记住被拖的 id 与当前悬停的目标目录('' = 根层),用于高亮与合法性判断。
  // ⚠ 被拖的 id 用 ref 而不是只靠 state:dragstart → dragover 可能落在同一次事件循环里,
  //   那时 React 还没重渲染,state 仍是旧值 —— 合法性判断会误判成「没在拖」而拒绝放下。
  //   ref 是同步写入的,高亮另用 state(那个可以晚一帧)。
  const draggingRef = useRef<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
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

  /**
   * 搜索词命中了哪些笔记的标签(id → 命中的标签名)。
   *
   * 标签行已经撤掉了 —— 标签会越来越多,铺一行既占地方又不好找。改成「边打字边联动」:
   * 由搜索框这个入口召回,而不是先点选再筛。规则本身在 lib/note-search.ts,有单测。
   * 完全在本地算:列表里本来就带着每篇的 tags,不必再问主进程一次。
   */
  const tagHits = useMemo(() => tagHitsOf(notes, query), [notes, query])

  const visible = useMemo(() => {
    let list = searchResults ?? notes
    if (refFilter !== null) {
      list = list.filter((n) => n.refs.some((r) => r.type === refFilter.type && r.key === refFilter.key))
    }
    // 按**创建时间**排,不按 updated:updated 会被自动保存/切换笔记时的 flush 刷新,
    // 于是「点一下笔记,列表就重排一次」—— 排序键本身会变,顺序就不可能稳。
    // created 一旦写入就不再动,顺序稳定;置顶仍由 sortNotes 内部优先。
    return rankByTagHits(sortNotes(list, 'created'), tagHits)
  }, [notes, searchResults, refFilter, tagHits])

  const pinned = useMemo(() => visible.filter((n) => n.pinned), [visible])
  const unpinned = useMemo(() => visible.filter((n) => !n.pinned), [visible])
  // 目录树只用于「没在搜索」时。搜索时**必须摊平渲染**:
  // buildNoteTree 会按笔记的路径自动补出目录节点,而目录默认是折叠的 ——
  // 于是「命中一篇在目录里的笔记」会被塞进折叠的目录下面,界面上什么都看不到
  // (搜标签尤其明显:命中的笔记标题里根本没有搜索词,一旦被折叠就彻底没线索)。
  const tree = useMemo(() => buildNoteTree(unpinned, folders), [unpinned, folders])

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

  const loading = !loaded && notes.length === 0
  /** 首次使用:一篇笔记、一个目录都没有 */
  const isEmpty = !loading && notes.length === 0 && folders.length === 0
  const startEdit = (next: NameEdit, initial = ''): void => {
    setEdit(next)
    setDraftName(initial)
  }
  const commitEdit = (): void => {
    const name = draftName.trim()
    if (edit === null) return
    const cur = edit
    setEdit(null)
    setDraftName('')
    if (name === '') return
    if (cur.mode === 'create') void createFolder(cur.parent, name)
    else if (cur.kind === 'note') void renameNote(cur.path, name)
    else if (name !== baseNameOf(cur.path)) void renameFolder(cur.path, name)
  }

  /** 目录行内的名字输入(新建与改名共用) */
  const nameInput = (placeholder: string): React.JSX.Element => (
    <input
      className="notes-folder-input"
      autoFocus
      value={draftName}
      placeholder={placeholder}
      onChange={(e) => setDraftName(e.target.value)}
      onBlur={commitEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commitEdit()
        if (e.key === 'Escape') {
          setEdit(null)
          setDraftName('')
        }
      }}
    />
  )

  /** 笔记行:只有名字。可拖拽;悬停露出置顶与删除 */
  const noteRow = (n: NoteMeta, depth: number): React.JSX.Element => {
    const renaming = edit !== null && edit.mode === 'rename' && edit.kind === 'note' && edit.path === n.id
    return (
    <div
      key={n.id}
      className={
        'notes-row' +
        (n.id === currentId ? ' active' : '') +
        (draggingId === n.id ? ' dragging' : '')
      }
      style={{ paddingLeft: notePad(depth) }}
      draggable
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
          title={`${n.id} · ${relTime(n.updated, t)}`}
          onClick={() => void open(n.id)}
        >
          {n.pinned && <i className="fa-solid fa-thumbtack notes-row-pin" />}
          <span className="notes-row-title">{n.title}</span>
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

  /**
   * 递归铺目录。**刻意用命令式的 if + push,不写 `{isOpen && out.push(...)}`** ——
   * `Array.push` 返回的是新长度,那个表达式会算出一个数字并被 React 当文本渲染出来。
   */
  const folderBranch = (node: NoteFolderNode, depth: number): React.JSX.Element[] => {
    const out: React.JSX.Element[] = []
    for (const f of node.folders) {
      const isOpen = expanded.has(f.path)
      const count = countNotesIn(f)
      const renaming = edit !== null && edit.mode === 'rename' && edit.path === f.path
      out.push(
        <div
          key={`f:${f.path}`}
          className={
            'notes-folder-row' +
            (selectedFolder === f.path ? ' selected' : '') +
            (dropTarget === f.path ? ' drop-target' : '') +
            (draggingId === f.path ? ' dragging' : '')
          }
          style={{ paddingLeft: folderPad(depth) }}
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
            if (!canDropInto(f.path)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropTarget(f.path)
          }}
          onDrop={(e) => {
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
          <button
            type="button"
            className="notes-folder-toggle"
            onClick={() => toggleFolder(f.path)}
            title={isOpen ? t('notes.folder.collapse') : t('notes.folder.expand')}
          >
            <i className={isOpen ? 'fa-solid fa-caret-down' : 'fa-solid fa-caret-right'} />
          </button>
          {renaming ? (
            <span className="notes-folder-rename">{nameInput(t('notes.folder.namePlaceholder'))}</span>
          ) : (
            <button
              type="button"
              className="notes-folder-name"
              onClick={() => {
                setSelectedFolder(f.path)
                toggleFolder(f.path)
              }}
              title={f.path}
            >
              <i className={isOpen ? 'fa-regular fa-folder-open' : 'fa-regular fa-folder'} />
              <span>{f.name}</span>
              <span className="notes-folder-count">{count > 0 ? count : ''}</span>
            </button>
          )}
          <span className="notes-folder-acts" style={renaming ? { display: 'none' } : undefined}>
            <button type="button" title={t('notes.folder.newNote')} onClick={() => void create('', f.path)}>
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
        out.push(
          <div
            key={`ec:${f.path}`}
            className="notes-folder-edit"
            style={{ paddingLeft: folderPad(depth + 1) }}
          >
            {nameInput(t('notes.folder.namePlaceholder'))}
          </div>
        )
      }
      if (isOpen) out.push(...folderBranch(f, depth + 1))
    }
    for (const n of node.notes) out.push(noteRow(n, depth))
    return out
  }

  const pinnedRef = useRef<HTMLDivElement | null>(null)

  return (
    <div className={'notes-rail' + (narrow ? ' rail-narrow' : '')} style={{ width }}>
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
        {!loading && searching && visible.length === 0 && (
          <EmptyState icon="fa-solid fa-magnifying-glass" text={t('notes.searchEmpty')} />
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

        {searching ? unpinned.map((n) => noteRow(n, 0)) : folderBranch(tree, 0)}

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
          <div className="notes-folder-edit" style={{ paddingLeft: folderPad(0) }}>
            {nameInput(t('notes.folder.namePlaceholder'))}
          </div>
        ) : (
          <div className={'notes-new-row' + (isEmpty ? ' prominent' : '')}>
            {/* 根层两个入口并排:上面那颗 + 是「建到当前选中的目录里」,
                这里明确是「建在根层」—— 否则一旦选过某个目录,就再也没法在根层新建了 */}
            <button type="button" className="notes-new-folder" onClick={() => void create('', '')}>
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
