// 笔记 store:列表 + 编辑缓冲 + 自动保存 + 冲突处理。
//
// 与其它三域最大的不同:笔记文件是**用户会在 Obsidian / iCloud / git 里同时改**的。
// 所以这里的核心不是 CRUD,而是「缓冲绝不静默丢失」:
//   · 保存失败 → toast + 保持 dirty,不丢缓冲;
//   · 磁盘被外部改过 → 出横幅让用户选,默认两边都不丢;
//   · 冲突未决时**暂停自动保存**,只由用户的显式选择恢复。

import { create } from 'zustand'
import {
  baseNameOf,
  joinNoteId,
  type Note,
  type NoteFileMeta,
  type NoteFileStat,
  type NoteMeta,
  type NoteRef
} from '@shared/notes'
import { slugifyNoteTitle } from '@shared/note-slug'
import { normalizeTag } from '../lib/note-tags'
import { dataSource } from '../data'
import { getCurrentLang, makeT } from '../i18n'
import { cleanIpcErrorMessage } from '../lib/ipc-error'
import { ancestorsOf } from '../lib/note-tree'
import { toggleTaskLine } from '../lib/note-task'
import { CHOICE } from '../lib/choice'
import { showToast } from '../lib/utils'
import { useFilesStore } from './files-store'

const t = (): ((k: string) => string) => makeT(getCurrentLang())

/** 尾沿去抖。**放在 store 而不是组件里**:切走模块会卸载组件,放组件里会把待保存的改动一起带走 */
const SAVE_DEBOUNCE_MS = 900

const VIEW_MODE_LS_KEY = 'launcherNotesViewMode'
const RAIL_LS_KEY = 'launcherNotesRailCollapsed'
/** 编辑区与预览区是否联动滚动。默认开 —— 分栏的全部意义就是「同一处」 */
const SCROLL_SYNC_LS_KEY = 'launcherNotesScrollSync'
const EXPANDED_LS_KEY = 'launcherNotesExpandedFolders'
const PINNED_LS_KEY = 'launcherNotesPinnedCollapsed'

function readExpanded(): Set<string> {
  const raw = lsGet(EXPANDED_LS_KEY)
  if (raw === null) return new Set()
  try {
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

export type NotesViewMode = 'split' | 'edit' | 'preview'

/** 编辑缓冲:与 Note 的区别是它没有 body 之外的派生字段,且 revision 会被保存回写 */
export interface NoteDraft {
  id: string
  title: string
  body: string
  tags: string[]
  refs: NoteRef[]
  pinned: boolean
  /** 展示用(「更新于 X」);保存成功后跟着服务端回写的值走 */
  updated: string
  revision: string
  frontmatterIssues: string[]
  refsUnparsed: boolean
  opaque: boolean
  /** frontmatter 围栏未闭合 → 不能改元数据 */
  unclosed: boolean
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
/** 正在进行的保存:新的 flush 要等它落盘后再判一次,避免两次保存叠着写同一个文件 */
let inFlightSave: Promise<void> | null = null
/** 正在进行的改名:连点两篇时两条后台链可能同时走到这里,复用同一个请求 */
let syncInFlight: Promise<void> | null = null
/**
 * 打开请求的序号。只认最后一次点击的 read 结果 —— 前一次读得再慢,回来时也不能
 * 把用户后来选的笔记盖掉。放在模块级而不是 state:它不该触发任何渲染。
 */
let openSeq = 0

function clearTimer(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

/**
 * localStorage 兜底:渲染层里它总是可用,但测试环境(node,无 jsdom)没有 ——
 * 模块求值期直接取会让整块 store 起不来。顺带也挡住隐私模式/配额满这类异常:
 * 记不住「上次用哪种视图」不是错误,不该影响笔记本身。
 */
function lsGet(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
  } catch {
    return null
  }
}

function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
  } catch {
    /* 记不住偏好不是错误 */
  }
}

function readLs<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = lsGet(key)
  return allowed.includes(v as T) ? (v as T) : fallback
}

interface NotesState {
  // 列表
  notes: NoteMeta[]
  /** 所有目录的 id(空目录也在内 —— 它是空目录唯一的痕迹) */
  folders: string[]
  /** 非 Markdown 文件(根层 assets/ 除外) */
  files: NoteFileMeta[]
  /** 展开的目录(持久化:下次打开还在原来的位置) */
  expanded: Set<string>
  /** 当前选中的目录(「新建笔记」建在这里;'' = 根层) */
  selectedFolder: string
  dir: string
  loaded: boolean
  error: string | null
  truncated: number
  truncatedFiles: number
  query: string
  searchResults: NoteMeta[] | null
  refFilter: NoteRef | null
  /** 标签筛选(已 normalize 的 key);与 query / refFilter 取交集 */
  tagFilter: string | null
  railCollapsed: boolean
  /** 置顶区折叠 */
  pinnedCollapsed: boolean
  // 编辑
  currentId: string | null
  draft: NoteDraft | null
  /** 正在打开的笔记 id:目录行立即出转圈,正文区延迟出骨架层 */
  openingId: string | null
  /**
   * 每次真正切换到另一篇时 +1。编辑器据此复位滚动/选区/撤销栈 ——
   * 用 id 判断不行:改名会让 id 变,但那是同一篇文档,不该跳回顶部、清掉撤销。
   */
  docSession: number
  dirty: boolean
  saving: boolean
  savedAt: number
  /** 磁盘被外部改动,但本地有未保存的修改 → 只出横幅,不覆盖缓冲 */
  externalChanged: boolean
  /** 保存时撞上外部改动 → 交给用户裁决 */
  conflict: Note | null
  viewMode: NotesViewMode
  splitRatio: number
  /** 编辑区 ↔ 预览区联动滚动 */
  scrollSync: boolean

  load(): Promise<void>
  open(id: string): Promise<void>
  close(): Promise<void>
  /**
   * 切到别的文档(文件行)时用:先让挂起的打开作废,把缓冲交给后台保存;
   * 只有在等待期间没有新打开的笔记、也没有留存改动时才清空视图。
   * 保存失败会留下 draft(dirty),下次打开该笔记时仍能看到并继续保存 —— 绝不静默丢字。
   */
  leave(): Promise<void>
  setBody(v: string): void
  setTitle(v: string): void
  setTags(tags: string[]): void
  togglePin(): void
  addRef(ref: NoteRef): void
  removeRef(ref: NoteRef): void
  toggleTask(line: number, next: boolean): void
  create(title?: string, parent?: string): Promise<void>
  /** 新建空文件(非 Markdown);成功返回文件相对路径,失败返回 null */
  createFile(parent: string, name: string): Promise<string | null>
  /**
   * 重命名文件(只改主名,扩展名由主进程沿用原文件)。
   * 成功返回服务端的权威元信息(路径已变),失败返回 null。
   */
  renameFile(path: string, name: string): Promise<NoteFileStat | null>
  createFolder(parent: string, name: string): Promise<void>
  removeFolder(id: string): Promise<void>
  renameFolder(id: string, name: string): Promise<void>
  toggleFolder(path: string): void
  setExpanded(path: string, open: boolean): void
  setSelectedFolder(path: string): void
  remove(id: string): Promise<void>
  /** 一次移动还没结束:目录顶部出不确定进度,期间不再接第二次拖拽 */
  moving: boolean
  /**
   * 刚成功落地的那一次移动。和换列表的那次 set 写在一起,
   * 目录树才能在新行出现的同一帧从旧位置滑过去。播完由目录树清掉。
   */
  moveLand: { fromId: string; toId: string; kind: 'note' | 'folder' | 'file' } | null
  clearMoveLand(): void
  /** 跨目录移动(笔记、目录、文件共用);parent 为空串 = 根层 */
  moveNote(id: string, parent: string, kind: 'note' | 'folder' | 'file'): Promise<void>
  /** 把 OS 文件/文件夹原样复制进目标目录(空串 = 根层) */
  importPaths(target: string, paths: string[]): Promise<void>
  /** 用系统默认应用打开文件 */
  openFile(path: string): Promise<void>
  /** 删除文件(进系统废纸篓) */
  removeFile(path: string): Promise<void>
  /** 置顶/取消置顶(纯元数据,不动 updated) */
  setPinned(id: string, pinned: boolean): Promise<void>
  /** 就地改名(列表里直接改,不必先打开) */
  renameNote(id: string, title: string): Promise<void>
  /**
   * 标题改了就把文件名跟着改(用户要求:改标题即改文件名,不需要再点一次)。
   * 只在**离开标题输入框**与**切换笔记**时调用 —— 边打字边改会让文件被反复重命名。
   */
  syncFileName(): Promise<void>
  scheduleSave(): void
  flush(): Promise<void>
  resolveConflict(choice: 'mine' | 'disk'): Promise<void>
  onExternalChange(ids: string[]): Promise<void>
  setQuery(q: string): Promise<void>
  setPinnedCollapsed(v: boolean): void
  filterByRef(ref: NoteRef | null): void
  /** 标签筛选;传 null 清除。key 会先 normalize */
  setTagFilter(tag: string | null): void
  setRailCollapsed(v: boolean): void
  setViewMode(m: NotesViewMode): void
  setSplitRatio(r: number): void
  toggleScrollSync(): void
}

function draftOf(note: Note, unclosed = false): NoteDraft {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    tags: note.tags,
    refs: note.refs,
    pinned: note.pinned,
    updated: note.updated,
    revision: note.revision,
    frontmatterIssues: note.frontmatterIssues,
    refsUnparsed: note.refsUnparsed,
    opaque: note.opaque,
    unclosed
  }
}

/**
 * 改名撞名时问一次。返回 true = 用户选了「保留两者」,可以带 onConflict 重试。
 *
 * 为什么由 store 统一处理:`renameNote`(列表就地改名)与 `syncFileName`(标题栏失焦)是两条
 * 平行的写路径,询问逻辑放一处,两条路径行为才一致。
 */
async function askNameClash(suggested: string): Promise<boolean> {
  const picked = await CHOICE.request({
    header: t()('notes.clash.header'),
    title: t()('notes.clash.message').replace('{NAME}', suggested),
    options: [{ label: t()('notes.clash.keep'), value: 'keep' }]
  })
  return picked === 'keep'
}

function persistExpanded(set: Set<string>): void {
  lsSet(EXPANDED_LS_KEY, JSON.stringify([...set]))
}

/** 保存请求里带走的字段快照 —— 用它判断「保存期间用户又改了没有」 */
function snapshot(d: NoteDraft): string {
  return JSON.stringify([d.body, d.title, d.tags, d.pinned, d.refs])
}

export const useNotesStore = create<NotesState>((set, get) => {
  /** 结构性改动(建/删/改名)后重载列表 —— id 可能变了,不能只打补丁 */
  async function reload(patch?: { moveLand: NotesState['moveLand'] }): Promise<void> {
    const payload = await dataSource().notes.list()
    set({
      notes: payload.notes,
      folders: payload.folders,
      files: payload.files,
      dir: payload.dir,
      truncated: payload.truncated,
      truncatedFiles: payload.truncatedFiles,
      error: payload.error,
      loaded: true,
      ...(patch ?? {})
    })
    if (get().query.trim() !== '') await get().setQuery(get().query)
  }

  /**
   * 保存成功只回写这一篇的元信息,不再整目录重扫。
   * 列表顺序由渲染层按 updated / pinned 现算,所以就地替换足够。
   */
  function patchNoteMeta(note: Note): void {
    const { body: _body, revision: _revision, ...meta } = note
    const notes = get().notes
    if (!notes.some((n) => n.id === meta.id)) {
      void reload() // 列表里没有(截断 / 刚被别处改动):退回完整扫描
      return
    }
    set({ notes: notes.map((n) => (n.id === meta.id ? meta : n)) })
  }

  return {
    notes: [],
    folders: [],
    files: [],
    expanded: readExpanded(),
    selectedFolder: '',
    dir: '',
    loaded: false,
    error: null,
    truncated: 0,
    truncatedFiles: 0,
    query: '',
    searchResults: null,
    refFilter: null,
    tagFilter: null,
    railCollapsed: lsGet(RAIL_LS_KEY) === '1',
    pinnedCollapsed: lsGet(PINNED_LS_KEY) === '1',
    currentId: null,
    draft: null,
    openingId: null,
    docSession: 0,
    dirty: false,
    saving: false,
    savedAt: 0,
    externalChanged: false,
    conflict: null,
    moving: false,
    moveLand: null,
    viewMode: readLs(VIEW_MODE_LS_KEY, ['split', 'edit', 'preview'] as const, 'split'),
    splitRatio: 0.5,
    scrollSync: lsGet(SCROLL_SYNC_LS_KEY) !== '0',

    async load() {
      try {
        await reload()
      } catch (err) {
        set({ loaded: true, error: cleanIpcErrorMessage(err) })
      }
    },

    async open(id) {
      if (get().currentId === id) {
        // 正在打开别的笔记时点回当前这篇 = 取消挂起的打开
        if (get().openingId !== null) {
          openSeq += 1
          set({ openingId: null })
        }
        return
      }
      if (get().openingId === id) return // 同一篇的重复点击

      const prevId = get().draft?.id ?? null
      set({ openingId: id })
      const seq = ++openSeq
      const reading = dataSource().notes.read(id)

      // 上一篇的保存与标题改名放到后台:打开只等目标笔记的这一次读取。
      // flush 的同步段会把旧 draft 的快照交给 IPC,所以这里不 await 也不会丢内容。
      if (prevId !== null) {
        void (async () => {
          await get().flush()
          // 已经切走了就放弃改名(改完也不该回写草稿),留给下次打开该篇时同步
          if (get().draft?.id !== prevId) return
          await get().syncFileName()
        })()
      }

      try {
        const note = await reading
        if (seq !== openSeq) return // 后面又点了别的:这次结果作废
        if (!note) {
          showToast(t()('toast.noteMissing'), '#fbbf24', 'fa-triangle-exclamation')
          await reload()
          if (seq !== openSeq) return
          set({
            currentId: null,
            draft: null,
            dirty: false,
            conflict: null,
            externalChanged: false,
            openingId: null
          })
          return
        }
        // 自动展开祖先目录:否则从搜索结果点进一篇深层笔记,列表里看不见它在哪
        const cur = get().expanded
        let next = cur
        for (const a of ancestorsOf(id)) {
          if (next.has(a)) continue
          if (next === cur) next = new Set(cur)
          next.add(a)
        }
        // 读盘这几毫秒里用户可能又在上一篇里敲了字:别让切换把它吞掉,先交给后台保存
        if (prevId !== null && get().draft?.id === prevId && get().dirty) void get().flush()
        set({
          currentId: id,
          draft: draftOf(note),
          dirty: false,
          conflict: null,
          externalChanged: false,
          savedAt: Date.now(),
          expanded: next,
          openingId: null,
          docSession: get().docSession + 1
        })
        if (next !== cur) persistExpanded(next)
      } catch (err) {
        if (seq !== openSeq) return
        set({ openingId: null })
        showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
      }
    },

    async close() {
      openSeq += 1 // 挂起的 open 回来后不能再把笔记打开
      set({ openingId: null })
      await get().flush() // 已有保存在飞时,等它落盘再清缓冲
      clearTimer()
      set({ currentId: null, draft: null, dirty: false, conflict: null, externalChanged: false })
    },

    async leave() {
      const seq = ++openSeq // 让挂起的 open 结果作废
      set({ openingId: null })
      await get().flush()
      clearTimer()
      // 等保存期间用户可能又打开了别的笔记或继续输入:两种情况下都不能清视图
      if (seq !== openSeq) return
      const s = get()
      if (s.dirty || s.saving || s.openingId !== null) return
      set({ currentId: null, draft: null, dirty: false, conflict: null, externalChanged: false })
    },

    setBody(v) {
      const d = get().draft
      if (!d) return
      if (d.body === v) return // 整篇回灌后的同文回调不该再标脏
      set({ draft: { ...d, body: v }, dirty: true })
      get().scheduleSave()
    },

    setTitle(v) {
      const d = get().draft
      if (!d) return
      set({ draft: { ...d, title: v }, dirty: true })
      get().scheduleSave()
    },

    setTags(tags) {
      const d = get().draft
      if (!d) return
      set({ draft: { ...d, tags }, dirty: true })
      get().scheduleSave()
    },

    togglePin() {
      const d = get().draft
      if (!d) return
      set({ draft: { ...d, pinned: !d.pinned }, dirty: true })
      get().scheduleSave()
    },

    addRef(ref) {
      const d = get().draft
      if (!d || d.refsUnparsed) return
      if (d.refs.some((r) => r.type === ref.type && r.key === ref.key)) return
      set({ draft: { ...d, refs: [...d.refs, ref] }, dirty: true })
      get().scheduleSave()
    },

    removeRef(ref) {
      const d = get().draft
      if (!d) return
      set({
        draft: { ...d, refs: d.refs.filter((r) => !(r.type === ref.type && r.key === ref.key)) },
        dirty: true
      })
      get().scheduleSave()
    },

    toggleTask(line, next) {
      const d = get().draft
      if (!d) return
      const body = toggleTaskLine(d.body, line, next)
      // 那一行已经不是任务项了(用户刚改过)→ 不动,给一句提示而不是猜
      if (body === null) {
        showToast(t()('notes.taskStale'), '#fbbf24', 'fa-triangle-exclamation')
        return
      }
      set({ draft: { ...d, body }, dirty: true })
      get().scheduleSave()
    },

    async create(title, parent) {
      await get().flush()
      try {
        const note = await dataSource().notes.create({
          title: title ?? '',
          body: '',
          // 默认建在根层。要建到某个目录里由调用方显式传 parent(目录行的按钮就是这么做的)——
          // 之前默认用 selectedFolder,是为了配合搜索框旁边那颗 +,那颗已经移除了
          parent: parent ?? ''
        })
        await reload()
        set({ currentId: null }) // 强制 open 生效
        await get().open(note.id)
        showToast(t()('toast.noteCreated'), '#4ade80', 'fa-circle-check')
      } catch (err) {
        showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
      }
    },

    async createFile(parent, name) {
      try {
        const outcome = await dataSource().notes.createFile({ parent, name })
        if (!outcome.ok) {
          showToast(
            outcome.kind === 'exists' ? t()('toast.fileExists') : outcome.message,
            '#f87171',
            'fa-circle-exclamation'
          )
          return null
        }
        const { file } = outcome
        // 展开父目录,新文件行才有地方显示
        if (file.path.lastIndexOf('/') >= 0) {
          const next = new Set(get().expanded)
          for (const a of ancestorsOf(file.path)) next.add(a)
          persistExpanded(next)
          set({ expanded: next })
        }
        await reload()
        showToast(t()('toast.fileCreated'), '#4ade80', 'fa-circle-check')
        return file.path
      } catch (err) {
        showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
        return null
      }
    },

    async renameFile(path, name) {
      try {
        const outcome = await dataSource().notes.renameFile({ path, name })
        if (!outcome.ok) {
          showToast(
            outcome.kind === 'exists' ? t()('toast.fileExists') : outcome.message,
            '#f87171',
            'fa-circle-exclamation'
          )
          return null
        }
        await reload()
        showToast(t()('toast.fileRenamed'), '#4ade80', 'fa-circle-check')
        return outcome.file
      } catch (err) {
        showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
        return null
      }
    },

    async createFolder(parent, name) {      try {
        const { id } = await dataSource().notes.createFolder({ parent, name })
        const next = new Set(get().expanded)
        for (const a of ancestorsOf(id)) next.add(a)
        next.add(id)
        persistExpanded(next)
        set({ expanded: next, selectedFolder: id })
        await reload()
        showToast(t()('toast.folderCreated'), '#4ade80', 'fa-folder-plus')
      } catch (err) {
        showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
      }
    },

    async importPaths(target, paths) {
      if (paths.length === 0) {
        showToast(t()('notes.import.noPath'), '#fbbf24', 'fa-triangle-exclamation')
        return
      }
      try {
        const out = await dataSource().notes.import({ target, paths })
        if (!out.ok) {
          showToast(out.message, '#f87171', 'fa-circle-exclamation')
          return
        }
        // 展开目标目录:导入完总得让用户看见东西落在哪
        const next = new Set(get().expanded)
        if (target !== '') {
          for (const a of ancestorsOf(target)) next.add(a)
          next.add(target)
        }
        persistExpanded(next)
        set({ expanded: next, selectedFolder: target })
        await reload()

        if (out.files === 0 && out.folders === 0) {
          showToast(t()('notes.import.noPath'), '#fbbf24', 'fa-triangle-exclamation')
          return
        }
        const partial = out.skipped > 0
        const msg = t()(partial ? 'notes.import.partial' : 'notes.import.done')
          .replace('{FILES}', String(out.files))
          .replace('{FOLDERS}', String(out.folders))
          .replace('{SKIPPED}', String(out.skipped))
        showToast(
          msg,
          partial ? '#fbbf24' : '#4ade80',
          partial ? 'fa-triangle-exclamation' : 'fa-file-import'
        )
      } catch (err) {
        showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
      }
    },

    async openFile(path) {
      try {
        const out = await dataSource().notes.openFile(path)
        if (!out.ok) showToast(out.message, '#f87171', 'fa-circle-exclamation')
      } catch (err) {
        showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
      }
    },

    async removeFile(path) {
      try {
        const out = await dataSource().notes.removeFile(path)
        if (!out.ok) {
          showToast(out.message, '#f87171', 'fa-circle-exclamation')
          return
        }
        await reload()
        showToast(t()('toast.noteFileDeleted'), '#4ade80', 'fa-trash-can')
      } catch (err) {
        showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
      }
    },

    async removeFolder(id) {
      try {
        const out = await dataSource().notes.removeFolder(id)
        if (!out.ok) {
          showToast(out.kind === 'conflict' ? out.latest.title : out.message, '#f87171', 'fa-circle-exclamation')
          return
        }
        // 当前打开的笔记若在这个目录里,一并关掉(文件已经进废纸篓了)
        const cur = get().currentId
        if (cur !== null && (cur === id || cur.startsWith(`${id}/`))) {
          clearTimer()
          set({ currentId: null, draft: null, dirty: false, conflict: null, externalChanged: false })
        }
        if (get().selectedFolder === id || get().selectedFolder.startsWith(`${id}/`)) {
          set({ selectedFolder: '' })
        }
        await reload()
        showToast(t()('toast.folderDeleted'), '#4ade80', 'fa-trash-can')
      } catch (err) {
        showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
      }
    },

    async renameFolder(id, name) {
      try {
        const { id: next } = await dataSource().notes.renameFolder({ id, name })
        const cur = get().currentId
        // 打开中的笔记在改名后的目录里 → 它的 id 前缀也变了,得跟着换(否则下一次保存会 not-found)
        if (cur !== null && cur.startsWith(`${id}/`)) {
          const moved = `${next}${cur.slice(id.length)}`
          const d = get().draft
          if (d) set({ currentId: moved, draft: { ...d, id: moved } })
        }
        if (get().selectedFolder === id) set({ selectedFolder: next })
        await reload()
        showToast(t()('toast.folderRenamed'), '#4ade80', 'fa-check')
      } catch (err) {
        showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
      }
    },

    toggleFolder(path) {
      const next = new Set(get().expanded)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      persistExpanded(next)
      set({ expanded: next })
    },

    setExpanded(path, open) {
      const next = new Set(get().expanded)
      if (open) next.add(path)
      else next.delete(path)
      persistExpanded(next)
      set({ expanded: next })
    },

    setSelectedFolder(path) {
      set({ selectedFolder: path })
    },

    async remove(id) {
      // 开着的笔记直接用草稿里的 revision;没开着的先读一次拿 revision
      // (rail 的删除按钮删的往往不是当前打开的那篇)
      const cur = get().currentId === id ? get().draft : null
      let revision = cur?.revision
      if (revision === undefined) {
        const note = await dataSource().notes.read(id)
        if (!note) {
          await reload()
          return
        }
        revision = note.revision
      }
      try {
        const out = await dataSource().notes.remove({ id, expectedRevision: revision })
        if (!out.ok) {
          if (out.kind === 'conflict') {
            set({ conflict: out.latest })
            showToast(t()('toast.noteConflict'), '#fbbf24', 'fa-triangle-exclamation')
            return
          }
          showToast(out.message, '#f87171', 'fa-circle-exclamation')
          return
        }
        if (get().currentId === id) {
          clearTimer()
          set({ currentId: null, draft: null, dirty: false, conflict: null, externalChanged: false })
        }
        await reload()
        showToast(t()('toast.noteDeleted'), '#4ade80', 'fa-trash-can')
      } catch (err) {
        showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
      }
    },

    async syncFileName() {
      // 连点两篇时两条后台链可能同时走到这里:复用同一个改名,避免第二次必然撞 revision
      if (syncInFlight !== null) {
        await syncInFlight
        return
      }
      const run = (async (): Promise<void> => {
        const d = get().draft
        if (!d || d.title.trim() === '') return
        // 标题算出来的文件名与当前文件名一致 → 什么都不用做(省掉一次无谓的写盘与 mtime 变动)
        if (slugifyNoteTitle(d.title) === baseNameOf(d.id)) return
        try {
          let out = await dataSource().notes.rename({
            id: d.id,
            title: d.title,
            expectedRevision: d.revision
          })
          if (!out.ok && out.kind === 'name-taken') {
            // 已经切走:不弹「保留两者」,保留旧文件名,下次打开该篇再同步
            if (get().draft?.id !== d.id) return
            if (!(await askNameClash(out.suggested ?? d.title))) return
            out = await dataSource().notes.rename({
              id: d.id,
              title: d.title,
              expectedRevision: d.revision,
              onConflict: 'auto-rename'
            })
          }
          if (!out.ok) {
            // 改名失败不该打断编辑:冲突就出横幅,其余情况静默留着旧文件名
            if (out.kind === 'conflict' && get().draft?.id === d.id) set({ conflict: out.latest })
            return
          }
          if (!('note' in out)) return
          if (get().draft?.id !== d.id) {
            // 文件已经改名,但用户已经切到别的笔记:草稿一个字都不能动,只让列表跟上新 id
            await reload()
            return
          }
          set({
            currentId: out.note.id,
            draft: draftOf(out.note, d.unclosed),
            dirty: false,
            conflict: null,
            externalChanged: false
          })
          await reload()
          if (out.note.title !== d.title.trim()) {
            showToast(
              t()('toast.noteMovedRenamed').replace('{NAME}', out.note.title),
              '#fbbf24',
              'fa-triangle-exclamation'
            )
          }
        } catch (err) {
          showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
        }
      })()
      syncInFlight = run
      try {
        await run
      } finally {
        if (syncInFlight === run) syncInFlight = null
      }
    },

    async moveNote(id, parent, kind) {
      if (get().moving) return
      // 上一次的落地信息如果还在,这次失败会让目录树再飞一遍。先清掉,成功时再写。
      set({ moving: true, moveLand: null })
      try {
        // 被移的就是打开中的那份(或它的父目录):先等在飞的保存落盘。
        // 不落的话,缓冲里还没写出去的字会写到旧路径,等于丢在原处。
        const d = get().draft
        const openFile = useFilesStore.getState().file
        const movesNote = d !== null && (d.id === id || d.id.startsWith(`${id}/`))
        const movesFile = openFile !== null && (openFile.path === id || openFile.path.startsWith(`${id}/`))
        if (movesNote) await get().flush()
        if (movesFile) await useFilesStore.getState().flush()

        const out = await dataSource().notes.move({ id, parent, kind })
        if (!out.ok) {
          showToast(out.message, '#f87171', 'fa-circle-exclamation')
          return
        }
        // 打开中的笔记(或它所在的目录)被移动了 → id 前缀跟着换,否则下次保存会 not-found
        const freshDraft = get().draft
        if (freshDraft !== null && (freshDraft.id === id || freshDraft.id.startsWith(`${id}/`))) {
          const moved = `${out.id}${freshDraft.id.slice(id.length)}`
          set({ currentId: moved, draft: { ...freshDraft, id: moved } })
          // 撞名时服务端会连 frontmatter 的 title 一起改。草稿不同步的话,
          // 下次标题失焦 syncFileName 会认为「标题与文件名不符」而把文件改回去 —— 又撞名,
          // 于是陷入连锁重命名。所以这里必须从磁盘重读一遍。
          if (out.renamed !== undefined) {
            const fresh = await dataSource().notes.read(moved)
            if (fresh !== null) {
              set({ draft: { ...draftOf(fresh), unclosed: freshDraft.unclosed }, dirty: false })
            }
          }
        }
        // 打开中的文件(或它所在的目录)跟着换路径。元信息用服务端带回的,
        // 渲染层不自己拼;目录移动时只知道新前缀,要再 stat 一次。
        const fileNow = useFilesStore.getState().file
        if (fileNow !== null && (fileNow.path === id || fileNow.path.startsWith(`${id}/`))) {
          const nextPath = `${out.id}${fileNow.path.slice(id.length)}`
          const stat =
            out.file !== undefined && out.file.path === nextPath
              ? out.file
              : await dataSource().notes.statFile(nextPath)
          if (stat !== null) useFilesStore.getState().repath(fileNow.path, stat)
        }
        // 展开状态和选中目录按前缀一起换。
        // 再展开目标所在的每一层(不含被移项自己),折叠着的目标移完也看得见。
        const expanded = new Set<string>()
        for (const path of get().expanded) {
          if (path === id || path.startsWith(`${id}/`)) expanded.add(`${out.id}${path.slice(id.length)}`)
          else expanded.add(path)
        }
        for (const a of ancestorsOf(joinNoteId(parent, baseNameOf(out.id)))) expanded.add(a)
        const selected = get().selectedFolder
        const selectedFolder =
          selected === id || selected.startsWith(`${id}/`)
            ? `${out.id}${selected.slice(id.length)}`
            : selected
        persistExpanded(expanded)
        set({ expanded, selectedFolder })
        // 新行和落地信息必须同一次提交。分开写的话,新行会先出现一帧再飞。
        await reload({ moveLand: { fromId: id, toId: out.id, kind } })
        // 目标已有同名项 → 服务端不会覆盖,而是加序号;这件事必须说出来,
        // 否则用户会以为文件没动(名字变了却不吭声是最难排查的一类)
        if (out.renamed !== undefined) {
          showToast(
            t()('toast.noteMovedRenamed').replace('{NAME}', out.renamed.to),
            '#fbbf24',
            'fa-triangle-exclamation'
          )
          return
        }
        showToast(t()('toast.noteMoved'), '#4ade80', 'fa-folder-tree')
      } catch (err) {
        showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
      } finally {
        set({ moving: false })
      }
    },

    clearMoveLand() {
      if (get().moveLand !== null) set({ moveLand: null })
    },

    async renameNote(id, title) {
      try {
        const note = await dataSource().notes.read(id)
        if (!note) {
          await reload()
          return
        }
        let out = await dataSource().notes.rename({ id, title, expectedRevision: note.revision })
        if (!out.ok && out.kind === 'name-taken') {
          if (!(await askNameClash(out.suggested ?? title))) return // 用户取消 → 保持原名
          out = await dataSource().notes.rename({
            id,
            title,
            expectedRevision: note.revision,
            onConflict: 'auto-rename'
          })
        }
        if (!out.ok) {
          if (out.kind === 'conflict') set({ conflict: out.latest })
          else showToast(out.message, '#f87171', 'fa-circle-exclamation')
          return
        }
        if (!('note' in out)) return
        const next = out.note
        // 打开中的就是这篇 → 草稿跟着换成新 id / 新标题(否则下一次保存会 not-found)
        const d = get().draft
        if (d !== null && d.id === id) {
          set({ currentId: next.id, draft: { ...draftOf(next), unclosed: d.unclosed }, dirty: false })
        }
        await reload()
        // 目标名已被占用时服务端会加序号,并把标题一起改成带序号的名字 —— 必须说出来
        if (next.title !== title.trim()) {
          showToast(
            t()('toast.noteMovedRenamed').replace('{NAME}', next.title),
            '#fbbf24',
            'fa-triangle-exclamation'
          )
          return
        }
        showToast(t()('toast.noteRenamed'), '#4ade80', 'fa-check')
      } catch (err) {
        showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
      }
    },

    async setPinned(id, pinned) {
      try {
        const note = await dataSource().notes.read(id)
        if (!note) {
          await reload()
          return
        }
        const out = await dataSource().notes.save({
          id,
          body: note.body,
          expectedRevision: note.revision,
          meta: { pinned },
          // 置顶不该把 updated 推到当前时间 —— 否则取消置顶时那篇会突然跳到最前
          touchUpdated: false
        })
        if (!out.ok) {
          if (out.kind === 'conflict') set({ conflict: out.latest })
          else showToast(out.message, '#f87171', 'fa-circle-exclamation')
          return
        }
        const d = get().draft
        if (d !== null && d.id === id && 'note' in out) {
          set({ draft: { ...d, pinned, revision: out.note.revision } })
        }
        await reload()
        showToast(
          t()(pinned ? 'toast.notePinned' : 'toast.noteUnpinned'),
          '#4ade80',
          'fa-thumbtack'
        )
      } catch (err) {
        showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
      }
    },

    scheduleSave() {
      if (get().conflict !== null) return // 冲突未决:暂停自动保存,等用户裁决
      clearTimer()
      saveTimer = setTimeout(() => {
        saveTimer = null
        void get().flush()
      }, SAVE_DEBOUNCE_MS)
    },

    async flush() {
      // 已有保存在飞:等它落盘后再判一次 —— 期间用户可能又改了,也可能已经换了笔记。
      // 不能直接 return:否则这次改动就永远没人保存了。
      if (inFlightSave !== null) {
        await inFlightSave
        return get().flush()
      }
      clearTimer()
      const { draft, dirty, conflict, saving } = get()
      if (!draft || !dirty || conflict !== null || saving) return

      const sent = snapshot(draft)
      set({ saving: true })
      const run = (async (): Promise<void> => {
        try {
          const out = await dataSource().notes.save({
            id: draft.id,
            body: draft.body,
            expectedRevision: draft.revision,
            meta: { title: draft.title, tags: draft.tags, pinned: draft.pinned, refs: draft.refs }
          })

          if (out.ok && 'note' in out) {
            // 保存期间用户又改了 → 回写 revision 但**保持 dirty**,再排一次;
            // 已经切到别的笔记 → 只更新列表,绝不碰当前缓冲(否则会清掉新笔记的 dirty)。
            const cur = get().draft
            const current = cur !== null && cur.id === draft.id
            const stillDirty = current && snapshot(cur) !== sent
            if (current) {
              set({
                draft: { ...cur, revision: out.note.revision, updated: out.note.updated },
                dirty: stillDirty,
                savedAt: Date.now(),
                externalChanged: false
              })
            }
            set({ saving: false })
            patchNoteMeta(out.note)
            if (get().query.trim() !== '') await get().setQuery(get().query)
            if (stillDirty) get().scheduleSave()
            else if (!current && get().dirty) get().scheduleSave() // 切走后新笔记又输入了
            return
          }

          if (!out.ok && out.kind === 'conflict') {
            // 暂停自动保存,出横幅让用户选;缓冲一个字都不动。
            // 已经切走时不能把旧笔记的 latest 挂到新笔记的裁决上。
            set({ saving: false })
            if (get().draft?.id === draft.id) set({ conflict: out.latest })
            else showToast(t()('toast.noteConflict'), '#fbbf24', 'fa-triangle-exclamation')
            return
          }

          set({ saving: false })
          if (!out.ok) showToast(out.message, '#f87171', 'fa-circle-exclamation')
        } catch (err) {
          // 失败保持 dirty:绝不静默丢缓冲
          set({ saving: false })
          showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
        }
      })()

      inFlightSave = run
      try {
        await run
      } finally {
        if (inFlightSave === run) inFlightSave = null
      }
    },

    async resolveConflict(choice) {
      const { conflict, draft } = get()
      if (!conflict || !draft) return

      if (choice === 'disk') {
        set({
          draft: { ...draftOf(conflict), unclosed: draft.unclosed },
          dirty: false,
          conflict: null,
          externalChanged: false,
          savedAt: Date.now()
        })
        showToast(t()('toast.noteReloaded'), '#60a5fa', 'fa-rotate')
        return
      }

      // 保留我的版本:以磁盘最新 revision 为基准强制覆盖(写前服务端会立刻重读,窗口极小)
      set({ conflict: null, saving: true })
      try {
        const out = await dataSource().notes.save({
          id: draft.id,
          body: draft.body,
          expectedRevision: conflict.revision,
          force: true,
          meta: { title: draft.title, tags: draft.tags, pinned: draft.pinned, refs: draft.refs }
        })
        if (out.ok && 'note' in out) {
          set({
            draft: { ...draft, revision: out.note.revision, updated: out.note.updated },
            dirty: false,
            saving: false
          })
          await reload()
          showToast(t()('toast.noteSaved'), '#4ade80', 'fa-circle-check')
          return
        }
        set({ saving: false, dirty: true })
        if (!out.ok) {
          // 强制覆盖仍撞上并发改动(极端窗口)→ 重新出横幅,不静默
          if (out.kind === 'conflict') set({ conflict: out.latest })
          else showToast(out.message, '#f87171', 'fa-circle-exclamation')
        }
      } catch (err) {
        set({ saving: false, dirty: true })
        showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
      }
    },

    async onExternalChange(ids) {
      await reload()
      const { currentId, dirty } = get()
      if (currentId === null || !ids.includes(currentId)) return

      if (dirty) {
        // 本地有未保存的改动 → 只提示,不覆盖缓冲
        set({ externalChanged: true })
        return
      }
      const note = await dataSource().notes.read(currentId)
      if (!note) return
      // 读盘期间可能已经切到别的笔记 / 开始打开新的 / 又输入了:这次回填作废
      if (get().currentId !== currentId || get().openingId !== null || get().dirty) return
      set({
        draft: draftOf(note, get().draft?.unclosed ?? false),
        dirty: false,
        externalChanged: false,
        savedAt: Date.now()
      })
      showToast(t()('toast.noteReloaded'), '#60a5fa', 'fa-rotate')
    },

    async setQuery(q) {
      set({ query: q })
      if (q.trim() === '') {
        set({ searchResults: null })
        return
      }
      try {
        const hits = await dataSource().notes.search(q)
        // 期间用户又改了输入 → 丢弃这次结果,避免旧结果盖住新输入
        if (get().query !== q) return
        set({ searchResults: hits })
      } catch {
        set({ searchResults: [] })
      }
    },

    setPinnedCollapsed(v) {
      lsSet(PINNED_LS_KEY, v ? '1' : '0')
      set({ pinnedCollapsed: v })
    },
    filterByRef(ref) {
      set({ refFilter: ref })
    },
    setTagFilter(tag) {
      set({ tagFilter: tag === null ? null : normalizeTag(tag) })
    },
    setRailCollapsed(v) {
      lsSet(RAIL_LS_KEY, v ? '1' : '0')
      set({ railCollapsed: v })
    },
    setViewMode(m) {
      lsSet(VIEW_MODE_LS_KEY, m)
      set({ viewMode: m })
    },
    setSplitRatio(r) {
      set({ splitRatio: Math.min(0.75, Math.max(0.25, r)) })
    },
    toggleScrollSync() {
      const v = !get().scrollSync
      lsSet(SCROLL_SYNC_LS_KEY, v ? '1' : '0')
      set({ scrollSync: v })
    }
  }
})
