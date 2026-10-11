// 笔记 store:列表 + 编辑缓冲 + 自动保存 + 冲突处理。
//
// 与其它三域最大的不同:笔记文件是**用户会在 Obsidian / iCloud / git 里同时改**的。
// 所以这里的核心不是 CRUD,而是「缓冲绝不静默丢失」:
//   · 保存失败 → toast + 保持 dirty,不丢缓冲;
//   · 磁盘被外部改过 → 出横幅让用户选,默认两边都不丢;
//   · 冲突未决时**暂停自动保存**,只由用户的显式选择恢复。

import { create } from 'zustand'
import { baseNameOf, type Note, type NoteMeta, type NoteRef } from '@shared/notes'
import { slugifyNoteTitle } from '@shared/note-slug'
import { dataSource } from '../data'
import { getCurrentLang, makeT } from '../i18n'
import { cleanIpcErrorMessage } from '../lib/ipc-error'
import { ancestorsOf } from '../lib/note-tree'
import { toggleTaskLine } from '../lib/note-task'
import { CHOICE } from '../lib/choice'
import { showToast } from '../lib/utils'

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
  /** 展开的目录(持久化:下次打开还在原来的位置) */
  expanded: Set<string>
  /** 当前选中的目录(「新建笔记」建在这里;'' = 根层) */
  selectedFolder: string
  dir: string
  loaded: boolean
  error: string | null
  truncated: number
  query: string
  searchResults: NoteMeta[] | null
  refFilter: NoteRef | null
  railCollapsed: boolean
  /** 置顶区折叠 */
  pinnedCollapsed: boolean
  // 编辑
  currentId: string | null
  draft: NoteDraft | null
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
  setBody(v: string): void
  setTitle(v: string): void
  setTags(tags: string[]): void
  togglePin(): void
  addRef(ref: NoteRef): void
  removeRef(ref: NoteRef): void
  toggleTask(line: number, next: boolean): void
  create(title?: string, parent?: string): Promise<void>
  createFolder(parent: string, name: string): Promise<void>
  removeFolder(id: string): Promise<void>
  renameFolder(id: string, name: string): Promise<void>
  toggleFolder(path: string): void
  setExpanded(path: string, open: boolean): void
  setSelectedFolder(path: string): void
  remove(id: string): Promise<void>
  /** 跨目录移动(笔记与目录共用);parent 为空串 = 根层 */
  moveNote(id: string, parent: string): Promise<void>
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
  async function reload(): Promise<void> {
    const payload = await dataSource().notes.list()
    set({
      notes: payload.notes,
      folders: payload.folders,
      dir: payload.dir,
      truncated: payload.truncated,
      error: payload.error,
      loaded: true
    })
    if (get().query.trim() !== '') await get().setQuery(get().query)
  }

  return {
    notes: [],
    folders: [],
    expanded: readExpanded(),
    selectedFolder: '',
    dir: '',
    loaded: false,
    error: null,
    truncated: 0,
    query: '',
    searchResults: null,
    refFilter: null,
    railCollapsed: lsGet(RAIL_LS_KEY) === '1',
    pinnedCollapsed: lsGet(PINNED_LS_KEY) === '1',
    currentId: null,
    draft: null,
    dirty: false,
    saving: false,
    savedAt: 0,
    externalChanged: false,
    conflict: null,
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
      if (get().currentId === id) return
      await get().flush() // 切笔记前先把上一篇存了
      await get().syncFileName() // 标题改过就把文件名跟上(否则旧名字会一直留着)
      try {
        const note = await dataSource().notes.read(id)
        if (!note) {
          showToast(t()('toast.noteMissing'), '#fbbf24', 'fa-triangle-exclamation')
          await reload()
          set({ currentId: null, draft: null, dirty: false, conflict: null, externalChanged: false })
          return
        }
        // 自动展开祖先目录:否则从搜索结果点进一篇深层笔记,列表里看不见它在哪
        const next = new Set(get().expanded)
        for (const a of ancestorsOf(id)) next.add(a)
        set({
          currentId: id,
          draft: draftOf(note),
          dirty: false,
          conflict: null,
          externalChanged: false,
          savedAt: Date.now(),
          expanded: next
        })
        persistExpanded(next)
      } catch (err) {
        showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
      }
    },

    async close() {
      await get().flush()
      clearTimer()
      set({ currentId: null, draft: null, dirty: false, conflict: null, externalChanged: false })
    },

    setBody(v) {
      const d = get().draft
      if (!d) return
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

    async createFolder(parent, name) {
      try {
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
          if (out.kind === 'conflict') set({ conflict: out.latest })
          return
        }
        if (!('note' in out)) return
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
    },

    async moveNote(id, parent) {
      try {
        const out = await dataSource().notes.move({ id, parent })
        if (!out.ok) {
          showToast(out.message, '#f87171', 'fa-circle-exclamation')
          return
        }
        // 打开中的笔记(或它所在的目录)被移动了 → id 前缀跟着换,否则下次保存会 not-found
        const d = get().draft
        if (d !== null && (d.id === id || d.id.startsWith(`${id}/`))) {
          const moved = `${out.id}${d.id.slice(id.length)}`
          set({ currentId: moved, draft: { ...d, id: moved } })
          // 撞名时服务端会连 frontmatter 的 title 一起改。草稿不同步的话,
          // 下次标题失焦 syncFileName 会认为「标题与文件名不符」而把文件改回去 —— 又撞名,
          // 于是陷入连锁重命名。所以这里必须从磁盘重读一遍。
          if (out.renamed !== undefined) {
            const fresh = await dataSource().notes.read(moved)
            if (fresh !== null) {
              set({ draft: { ...draftOf(fresh), unclosed: d.unclosed }, dirty: false })
            }
          }
        }
        if (get().selectedFolder === id) set({ selectedFolder: out.id })
        await reload()
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
      }
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
      clearTimer()
      const { draft, dirty, conflict, saving } = get()
      if (!draft || !dirty || conflict !== null || saving) return

      const sent = snapshot(draft)
      set({ saving: true })
      try {
        const out = await dataSource().notes.save({
          id: draft.id,
          body: draft.body,
          expectedRevision: draft.revision,
          meta: { title: draft.title, tags: draft.tags, pinned: draft.pinned, refs: draft.refs }
        })

        if (out.ok && 'note' in out) {
          const cur = get().draft
          // 保存期间用户又改了 → 回写 revision 但**保持 dirty**,再排一次;
          // 绝不拿服务端返回的内容覆盖当前缓冲(那会吞掉刚敲的字)
          const stillDirty = cur !== null && cur.id === draft.id && snapshot(cur) !== sent
          if (cur !== null && cur.id === draft.id) {
            set({ draft: { ...cur, revision: out.note.revision, updated: out.note.updated } })
          }
          set({ dirty: stillDirty, saving: false, savedAt: Date.now(), externalChanged: false })
          await reload()
          if (stillDirty) get().scheduleSave()
          return
        }

        if (!out.ok && out.kind === 'conflict') {
          // 暂停自动保存,出横幅让用户选;缓冲一个字都不动
          set({ saving: false, conflict: out.latest })
          return
        }

        set({ saving: false })
        if (!out.ok) showToast(out.message, '#f87171', 'fa-circle-exclamation')
      } catch (err) {
        // 失败保持 dirty:绝不静默丢缓冲
        set({ saving: false })
        showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
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
