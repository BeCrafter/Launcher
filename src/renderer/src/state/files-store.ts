// 非 Markdown 文件的文档 store:打开 / 编辑缓冲 / 自动保存 / 冲突。
//
// 与 notes-store 同构(900ms 去抖、in-flight 等待、sha1 CAS、冲突暂停自动保存),
// 但内容不是 frontmatter 笔记,而是磁盘上的原文件:
//   · 文本按原编码 / BOM / EOL 写回(编码探测在 main,渲染层只拿 LF 文本);
//   · 图片 / PDF / 媒体 / Office / 压缩包 / 3D 是只读的,`editable = false`,
//     其内容由 viewer 自己按需读字节或走 launcher-note:// 协议。
//
// 两个 store 互不 import:笔记 ↔ 文件的切换由 modules/notes/doc-actions.ts 协调。

import { create } from 'zustand'
import type {
  NoteFileBinaryReason,
  NoteFileDoc,
  NoteFileStat,
  NoteFileTextEncoding,
  NoteFileTextDoc
} from '@shared/notes'
import { dataSource } from '../data'
import { getCurrentLang, makeT } from '../i18n'
import { cleanIpcErrorMessage } from '../lib/ipc-error'
import { showToast } from '../lib/utils'

const t = (): ((k: string) => string) => makeT(getCurrentLang())

const SAVE_DEBOUNCE_MS = 900

export type FileViewMode = 'source' | 'preview' | 'split'

const HTML_MODE_LS_KEY = 'launcherFileHtmlMode'
const CSV_MODE_LS_KEY = 'launcherFileCsvMode'

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

function readMode(key: string, fallback: FileViewMode): FileViewMode {
  const v = lsGet(key)
  return v === 'source' || v === 'preview' || v === 'split' ? v : fallback
}

/** 打开中的文件文档(可编辑时 text/revision/encoding 有值) */
export interface FileDoc extends NoteFileStat {
  /** sha1(磁盘原始字节);只读文件为 null */
  revision: string | null
  /** LF 归一后的正文;只读文件为空串 */
  text: string
  encoding: NoteFileTextEncoding | null
  eol: '\n' | '\r\n'
  /** 只读原因;可编辑时为 null */
  binaryReason: NoteFileBinaryReason | null
}

export interface FileConflict {
  revision: string
  size: number
  mtimeMs: number
}

interface FilesState {
  file: FileDoc | null
  /** 正在读取的路径(左栏转圈、NotesView 优先显示文件视图) */
  openingPath: string | null
  dirty: boolean
  saving: boolean
  savedAt: number
  conflict: FileConflict | null
  error: string | null
  /** 每次保存成功 +1:HTML 预览用它判断是否要刷新 iframe */
  saveNonce: number
  /** 外部「重新加载」或换文件时 +1,编辑器据此重建 */
  docSession: number
  viewModes: { html: FileViewMode; csv: FileViewMode }

  open(path: string): Promise<void>
  /**
   * 磁盘上文件改名后跟随新路径:只换元信息,不碰缓冲 / revision / dirty / 冲突。
   * 正在打开的旧路径先作废,再按新路径重开。
   */
  repath(oldPath: string, next: NoteFileStat): void
  setText(v: string): void
  scheduleSave(): void
  flush(): Promise<void>
  leave(): Promise<void>
  reload(): Promise<void>
  resolveConflict(choice: 'disk' | 'mine'): Promise<void>
  setViewMode(kind: 'html' | 'csv', mode: FileViewMode): void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let inFlightSave: Promise<void> | null = null
let openSeq = 0

function clearTimer(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

function fromReadDoc(doc: NoteFileDoc): FileDoc {
  if (doc.editable) return { ...doc, binaryReason: null }
  // 有对应查看器的二进制类型(图片/PDF/Office/压缩包/3D…)要交给 BinaryBody,
  // 不能因为「不可编辑」就当成「无法预览」。
  return {
    ...doc,
    text: '',
    encoding: null,
    eol: '\n',
    binaryReason: hasViewer(doc.kind) ? null : doc.reason
  }
}

/** 这些类型有自己的查看器;其余(旧 Office、RAR/7z、未知二进制)只能给占位 */
const VIEWER_KINDS = new Set<NoteFileStat['kind']>([
  'image',
  'psd',
  'tiff',
  'heic',
  'pdf',
  'video',
  'audio',
  'docx',
  'xlsx',
  'pptx',
  'archive',
  'model'
])

function hasViewer(kind: NoteFileStat['kind']): boolean {
  return VIEWER_KINDS.has(kind)
}

function binaryFromStat(stat: NoteFileStat): FileDoc {
  return {
    ...stat,
    revision: null,
    text: '',
    encoding: null,
    eol: '\n',
    binaryReason: hasViewer(stat.kind) ? null : 'unsupported'
  }
}

function fromTextDoc(doc: NoteFileTextDoc): FileDoc {
  return { ...doc, binaryReason: null }
}

export const useFilesStore = create<FilesState>((set, get) => ({
  file: null,
  openingPath: null,
  dirty: false,
  saving: false,
  savedAt: 0,
  conflict: null,
  error: null,
  saveNonce: 0,
  docSession: 0,
  viewModes: {
    html: readMode(HTML_MODE_LS_KEY, 'preview'),
    csv: readMode(CSV_MODE_LS_KEY, 'source')
  },

  async open(path) {
    if (get().file?.path === path) return
    if (get().openingPath === path) return

    const seq = ++openSeq
    set({ openingPath: path, error: null })
    try {
      const stat = await dataSource().notes.statFile(path)
      if (seq !== openSeq) return
      if (stat === null) {
        set({ openingPath: null })
        showToast(t()('toast.fileMissing'), '#fbbf24', 'fa-triangle-exclamation')
        return
      }

      let doc: FileDoc
      if (stat.editable || stat.kind === 'unsupported') {
        // 文本 / 未知扩展名:按内容判断(未知扩展名解码成功 → 纯文本)
        const read = await dataSource().notes.readFile(path)
        if (seq !== openSeq) return
        if (!read.ok) {
          set({ openingPath: null })
          showToast(read.message, '#f87171', 'fa-circle-exclamation')
          return
        }
        doc = fromReadDoc(read.doc)
      } else {
        // 已知二进制类型不读正文:viewer 自己读字节或走协议
        doc = binaryFromStat(stat)
      }

      set({
        file: doc,
        openingPath: null,
        dirty: false,
        saving: false,
        savedAt: Date.now(),
        conflict: null,
        error: null,
        docSession: get().docSession + 1
      })
    } catch (err) {
      if (seq !== openSeq) return
      set({ openingPath: null })
      showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
    }
  },

  repath(oldPath, next) {
    const cur = get().file
    if (cur !== null && cur.path === oldPath) {
      // next 只有元信息;text / revision / encoding / eol / dirty / 冲突原样保留
      set({ file: { ...cur, ...next } })
    }
    if (get().openingPath === oldPath) {
      // 作废在飞的旧路径读取,再按新路径重开
      openSeq++
      set({ openingPath: null })
      void get().open(next.path)
    }
  },

  setText(v) {    const f = get().file
    if (f === null || !f.editable || f.text === v) return
    set({ file: { ...f, text: v }, dirty: true })
    get().scheduleSave()
  },

  scheduleSave() {
    if (get().conflict !== null) return // 冲突未决:暂停自动保存
    clearTimer()
    saveTimer = setTimeout(() => {
      saveTimer = null
      void get().flush()
    }, SAVE_DEBOUNCE_MS)
  },

  async flush() {
    if (inFlightSave !== null) {
      await inFlightSave
      return get().flush()
    }
    clearTimer()
    const { file, dirty, conflict, saving } = get()
    if (file === null || !file.editable || file.revision === null) return
    if (!dirty || conflict !== null || saving) return

    const sent = file.text
    const sentPath = file.path
    const sentRevision = file.revision
    set({ saving: true })

    const run = (async (): Promise<void> => {
      try {
        const out = await dataSource().notes.saveFile({
          path: sentPath,
          text: sent,
          expectedRevision: sentRevision
        })

        if (out.ok) {
          const cur = get().file
          const current = cur !== null && cur.path === sentPath
          const stillDirty = current && cur.text !== sent
          if (current) {
            set({
              file: { ...fromTextDoc(out.doc), text: stillDirty ? cur.text : out.doc.text },
              dirty: stillDirty,
              savedAt: Date.now(),
              error: null,
              // 预览只有在真的落盘后才刷新
              saveNonce: get().saveNonce + 1
            })
          }
          set({ saving: false })
          if (stillDirty) get().scheduleSave()
          else if (!current && get().dirty) get().scheduleSave()
          return
        }

        if (out.kind === 'conflict') {
          set({ saving: false })
          // 已切走的旧文件不能把冲突挂到新文件上
          if (get().file?.path === sentPath) set({ conflict: out.latest })
          else showToast(t()('toast.fileConflict'), '#fbbf24', 'fa-triangle-exclamation')
          return
        }

        set({ saving: false })
        showToast(out.message, '#f87171', 'fa-circle-exclamation')
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

  async leave() {
    const seq = ++openSeq
    set({ openingPath: null })
    await get().flush()
    clearTimer()
    // 等保存期间又打开了新文件 / 又输入了 → 保留当前视图与缓冲
    if (seq !== openSeq) return
    const s = get()
    if (s.dirty || s.saving || s.conflict !== null) return
    set({ file: null, dirty: false, conflict: null, error: null })
  },

  async reload() {
    const f = get().file
    if (f === null) return
    const seq = ++openSeq
    try {
      const read = await dataSource().notes.readFile(f.path)
      if (seq !== openSeq) return
      if (!read.ok) {
        showToast(read.message, '#f87171', 'fa-circle-exclamation')
        return
      }
      clearTimer()
      set({
        file: fromReadDoc(read.doc),
        dirty: false,
        conflict: null,
        error: null,
        savedAt: Date.now(),
        docSession: get().docSession + 1,
        saveNonce: get().saveNonce + 1
      })
    } catch (err) {
      showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
    }
  },

  async resolveConflict(choice) {
    const { conflict, file } = get()
    if (conflict === null || file === null || !file.editable) return

    if (choice === 'disk') {
      await get().reload()
      return
    }

    // 保留我的版本:以磁盘最新版本为基准强制覆盖
    set({ conflict: null })
    try {
      const out = await dataSource().notes.saveFile({
        path: file.path,
        text: file.text,
        expectedRevision: conflict.revision,
        force: true
      })
      if (out.ok) {
        set({
          file: fromTextDoc(out.doc),
          dirty: false,
          savedAt: Date.now(),
          saveNonce: get().saveNonce + 1
        })
        return
      }
      if (out.kind === 'conflict') {
        set({ conflict: out.latest })
        return
      }
      showToast(out.message, '#f87171', 'fa-circle-exclamation')
    } catch (err) {
      showToast(cleanIpcErrorMessage(err), '#f87171', 'fa-circle-exclamation')
    }
  },

  setViewMode(kind, mode) {
    set({ viewModes: { ...get().viewModes, [kind]: mode } })
    lsSet(kind === 'html' ? HTML_MODE_LS_KEY : CSV_MODE_LS_KEY, mode)
  }
}))
