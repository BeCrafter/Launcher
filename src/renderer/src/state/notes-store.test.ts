// 笔记 store 的「保存被切走」竞态。
// 打开笔记时,上一篇的保存已经改成后台执行 —— 它完成得比切换晚是常态,
// 这条晚到的回写绝不能碰当前笔记的缓冲:
//   · 不能把新笔记的 dirty 清掉(否则新笔记的输入再也不会被保存);
//   · 旧笔记的冲突不能挂到新笔记的裁决上(否则「使用磁盘版本」会把旧内容灌进新草稿)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Note, NoteFileStat, NoteFileTextDoc } from '@shared/notes'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  search: vi.fn(),
  createFile: vi.fn(),
  renameFile: vi.fn(),
  move: vi.fn(),
  statFile: vi.fn(),
  flushFile: vi.fn(),
  repath: vi.fn()
}))

vi.mock('../lib/utils', () => ({ showToast: mocks.toast }))
vi.mock('../data', () => ({
  dataSource: (): unknown => ({
    notes: {
      list: mocks.list,
      read: mocks.read,
      save: mocks.save,
      search: mocks.search,
      createFile: mocks.createFile,
      renameFile: mocks.renameFile,
      move: mocks.move,
      statFile: mocks.statFile,
      rename: vi.fn()
    }
  })
}))
vi.mock('./files-store', () => ({
  useFilesStore: {
    getState: (): unknown => ({
      file: filesState.file,
      flush: mocks.flushFile,
      repath: mocks.repath
    })
  }
}))

import { useNotesStore } from './notes-store'

/** files-store 被桩掉了,移动用例用这个对象模拟「当前打开的文件」。 */
const filesState: { file: NoteFileTextDoc | null } = { file: null }

function noteOf(id: string, body: string): Note {
  return {
    id,
    title: id,
    body,
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    tags: [],
    pinned: false,
    refs: [],
    excerpt: '',
    mtimeMs: 0,
    size: body.length,
    frontmatterIssues: [],
    refsUnparsed: false,
    opaque: false,
    revision: `rev-${id}-${body}`
  }
}

function metaOf(note: Note): Omit<Note, 'body' | 'revision'> {
  const { body: _body, revision: _revision, ...meta } = note
  return meta
}

function seed(notes: Note[]): void {
  useNotesStore.setState({
    notes: notes.map(metaOf),
    folders: [],
    files: [],
    expanded: new Set(),
    loaded: true,
    error: null,
    query: '',
    searchResults: null,
    currentId: null,
    draft: null,
    openingId: null,
    docSession: 0,
    dirty: false,
    saving: false,
    savedAt: 0,
    externalChanged: false,
    conflict: null
  })
}

/** 把当前微任务队列跑干净(deferred save 的续体都在这里) */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('notes-store:保存期间切换笔记', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.toast.mockReset()
    mocks.list.mockReset()
    mocks.read.mockReset()
    mocks.save.mockReset()
    mocks.search.mockReset()
    mocks.list.mockResolvedValue({
      notes: [],
      folders: [],
      files: [],
      dir: '',
      truncated: 0,
      truncatedFiles: 0,
      error: null
    })
    mocks.search.mockResolvedValue([])
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('旧笔记的保存完成不清掉新笔记的 dirty,新笔记仍会被保存', async () => {
    const a = noteOf('A', 'a1')
    const b = noteOf('B', 'b1')
    seed([a, b])
    mocks.read.mockImplementation(async (id: string) => (id === 'A' ? a : b))
    const pending: Array<{
      input: { id: string; body: string }
      resolve: (value: unknown) => void
    }> = []
    mocks.save.mockImplementation(
      (input: { id: string; body: string }) =>
        new Promise((resolve) => {
          pending.push({ input, resolve })
        })
    )

    await useNotesStore.getState().open('A')
    useNotesStore.getState().setBody('a2')
    expect(useNotesStore.getState().dirty).toBe(true)

    // 切到 B:不会等 A 的保存;B 显示出来后立刻在 B 里输入
    await useNotesStore.getState().open('B')
    expect(useNotesStore.getState().currentId).toBe('B')
    expect(useNotesStore.getState().draft?.body).toBe('b1')
    expect(pending).toHaveLength(1) // A 的保存在飞

    useNotesStore.getState().setBody('b2')
    expect(useNotesStore.getState().dirty).toBe(true)

    // A 的保存晚到:它的完成只能更新列表,不能动当前草稿
    pending[0]!.resolve({ ok: true, note: noteOf('A', 'a2') })
    await settle()
    expect(useNotesStore.getState().currentId).toBe('B')
    expect(useNotesStore.getState().draft?.body).toBe('b2')
    expect(useNotesStore.getState().dirty).toBe(true) // 关键:B 的 dirty 不能被清掉

    // 900ms 去抖后 B 自己的一次保存带上 b2
    await vi.advanceTimersByTimeAsync(900)
    expect(pending).toHaveLength(2)
    expect(pending[1]!.input.id).toBe('B')
    expect(pending[1]!.input.body).toBe('b2')

    pending[1]!.resolve({ ok: true, note: noteOf('B', 'b2') })
    await settle()
    expect(useNotesStore.getState().dirty).toBe(false)
  })

  it('打开期间又在上一篇里输入:切换前仍把它交给后台保存', async () => {
    const a = noteOf('A', 'a1')
    const b = noteOf('B', 'b1')
    seed([a, b])
    let releaseRead: ((value: Note) => void) | null = null
    mocks.read.mockImplementation((id: string) =>
      id === 'B'
        ? new Promise((resolve) => {
            releaseRead = resolve
          })
        : Promise.resolve(a)
    )
    const saves: Array<{ id: string; body: string }> = []
    mocks.save.mockImplementation(async (input: { id: string; body: string }) => {
      saves.push({ id: input.id, body: input.body })
      return { ok: true, note: noteOf(input.id, input.body) }
    })

    await useNotesStore.getState().open('A')
    const opening = useNotesStore.getState().open('B')
    await settle() // 让 open(B) 的同步段与后台链跑完,此时还停在 A
    expect(useNotesStore.getState().currentId).toBe('A')

    useNotesStore.getState().setBody('a2-读盘期间输入')
    releaseRead!(b)
    await opening
    await settle()

    expect(useNotesStore.getState().currentId).toBe('B')
    expect(useNotesStore.getState().draft?.body).toBe('b1')
    expect(saves).toContainEqual({ id: 'A', body: 'a2-读盘期间输入' })
  })

  it('旧笔记的保存冲突不挂到新笔记上,只提示一次', async () => {
    const a = noteOf('A', 'a1')
    const b = noteOf('B', 'b1')
    seed([a, b])
    mocks.read.mockImplementation(async (id: string) => (id === 'A' ? a : b))
    const pending: Array<(value: unknown) => void> = []
    mocks.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve)
        })
    )

    await useNotesStore.getState().open('A')
    useNotesStore.getState().setBody('a2')
    await useNotesStore.getState().open('B')
    expect(pending).toHaveLength(1)

    pending[0]!({ ok: false, kind: 'conflict', latest: noteOf('A', '磁盘上的 A') })
    await settle()

    const state = useNotesStore.getState()
    expect(state.currentId).toBe('B')
    expect(state.draft?.body).toBe('b1')
    expect(state.conflict).toBeNull() // 不能把 A 的 latest 交给 B 的冲突裁决
    expect(mocks.toast).toHaveBeenCalledTimes(1)
  })
})

describe('notes-store:leave(切到文件视图)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.toast.mockReset()
    mocks.read.mockReset()
    mocks.save.mockReset()
    mocks.list.mockResolvedValue({
      notes: [],
      folders: [],
      files: [],
      dir: '',
      truncated: 0,
      truncatedFiles: 0,
      error: null
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('干净笔记 leave 后清空视图', async () => {
    const a = noteOf('A', 'a1')
    seed([a])
    mocks.read.mockResolvedValue(a)

    await useNotesStore.getState().open('A')
    await useNotesStore.getState().leave()

    const s = useNotesStore.getState()
    expect(s.currentId).toBeNull()
    expect(s.draft).toBeNull()
  })

  it('保存失败时 leave 保留草稿与 dirty,不丢字', async () => {
    const a = noteOf('A', 'a1')
    seed([a])
    mocks.read.mockResolvedValue(a)
    mocks.save.mockResolvedValue({ ok: false, kind: 'io', message: '磁盘不可写' })

    await useNotesStore.getState().open('A')
    useNotesStore.getState().setBody('a2-没存上')
    await useNotesStore.getState().leave()

    const s = useNotesStore.getState()
    expect(s.currentId).toBe('A')
    expect(s.draft?.body).toBe('a2-没存上')
    expect(s.dirty).toBe(true)
    expect(mocks.toast).toHaveBeenCalled()
  })

  it('leave 等保存期间又打开了新笔记:leave 不清新笔记', async () => {
    const a = noteOf('A', 'a1')
    const b = noteOf('B', 'b1')
    seed([a, b])
    mocks.read.mockImplementation(async (id: string) => (id === 'A' ? a : b))
    const pending: Array<(value: unknown) => void> = []
    mocks.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve)
        })
    )

    await useNotesStore.getState().open('A')
    useNotesStore.getState().setBody('a2')
    const leaving = useNotesStore.getState().leave()
    await settle()
    expect(pending).toHaveLength(1) // A 的保存在飞

    await useNotesStore.getState().open('B')
    pending[0]!({ ok: true, note: noteOf('A', 'a2') })
    await leaving
    await settle()

    const s = useNotesStore.getState()
    expect(s.currentId).toBe('B')
    expect(s.draft?.body).toBe('b1')
  })
})

describe('notes-store:createFile(新建任意类型的文件)', () => {
  it('成功后重扫列表、展开父目录并返回路径', async () => {
    seed([])
    mocks.list.mockResolvedValue({
      notes: [],
      folders: ['docs'],
      files: [
        {
          path: 'docs/app.js',
          name: 'app.js',
          ext: 'js',
          kind: 'code',
          mime: 'text/javascript',
          size: 0,
          mtimeMs: 1,
          editable: true,
          tooLarge: false
        }
      ],
      dir: '/notes',
      truncated: 0,
      truncatedFiles: 0,
      error: null
    })
    mocks.createFile.mockResolvedValue({
      ok: true,
      file: { path: 'docs/app.js', name: 'app.js', ext: 'js', kind: 'code', mime: 'text/javascript', size: 0, mtimeMs: 1, editable: true, tooLarge: false }
    })

    const path = await useNotesStore.getState().createFile('docs', 'app.js')
    expect(path).toBe('docs/app.js')
    expect(mocks.createFile).toHaveBeenCalledWith({ parent: 'docs', name: 'app.js' })
    expect(useNotesStore.getState().expanded.has('docs')).toBe(true)
    expect(useNotesStore.getState().files.map((f) => f.path)).toContain('docs/app.js')
  })

  it('失败(同名/非法名)返回 null 并提示', async () => {
    seed([])
    mocks.createFile.mockResolvedValue({ ok: false, kind: 'exists', message: '同名文件已存在' })
    expect(await useNotesStore.getState().createFile('', 'app.js')).toBeNull()
    expect(mocks.toast).toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })
})

describe('notes-store:renameFile(重命名文件)', () => {
  const renamed = {
    path: 'docs/new.js',
    name: 'new.js',
    ext: 'js',
    kind: 'code',
    mime: 'text/javascript',
    size: 3,
    mtimeMs: 2,
    editable: true,
    tooLarge: false
  }

  it('成功后重扫列表、返回权威元信息并提示', async () => {
    seed([])
    mocks.renameFile.mockResolvedValue({ ok: true, file: renamed })
    mocks.list.mockResolvedValue({
      notes: [],
      folders: ['docs'],
      files: [renamed],
      dir: '/notes',
      truncated: 0,
      truncatedFiles: 0,
      error: null
    })

    const out = await useNotesStore.getState().renameFile('docs/old.js', 'new.js')
    expect(out).toEqual(renamed)
    expect(mocks.renameFile).toHaveBeenCalledWith({ path: 'docs/old.js', name: 'new.js' })
    expect(useNotesStore.getState().files.map((f) => f.path)).toContain('docs/new.js')
    expect(mocks.toast).toHaveBeenCalled()
  })

  it('同名 / 失败返回 null 并提示', async () => {
    seed([])
    mocks.renameFile.mockResolvedValue({ ok: false, kind: 'exists', message: '同名文件已存在' })
    expect(await useNotesStore.getState().renameFile('a.js', 'b.js')).toBeNull()
    expect(mocks.toast).toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })
})

const emptyList = {
  notes: [],
  folders: [] as string[],
  files: [] as NoteFileStat[],
  dir: '/notes',
  truncated: 0,
  truncatedFiles: 0,
  error: null
}

function fileDoc(path: string): NoteFileTextDoc {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return {
    path,
    name,
    ext: dot < 0 ? '' : name.slice(dot + 1),
    kind: 'text',
    mime: 'text/plain',
    size: 4,
    mtimeMs: 1,
    editable: true,
    tooLarge: false,
    revision: 'rev-1',
    encoding: 'utf8',
    eol: '\n',
    text: 'hello'
  }
}

describe('notes-store:moveNote(拖拽移动)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.toast.mockReset()
    mocks.move.mockReset()
    mocks.statFile.mockReset()
    mocks.flushFile.mockReset()
    mocks.repath.mockReset()
    mocks.list.mockReset()
    mocks.list.mockResolvedValue(emptyList)
    mocks.flushFile.mockResolvedValue(undefined)
    filesState.file = null
    useNotesStore.setState({
      moving: false,
      draft: null,
      currentId: null,
      dirty: false,
      expanded: new Set(),
      selectedFolder: ''
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    filesState.file = null
  })

  it('move 挂起时 moving 为真,结束后为假;挂起期间第二次调用不再请求', async () => {
    let release: ((value: unknown) => void) | null = null
    mocks.move.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )

    const first = useNotesStore.getState().moveNote('甲', '乙', 'folder')
    await vi.advanceTimersByTimeAsync(0)
    expect(useNotesStore.getState().moving).toBe(true)
    expect(mocks.move).toHaveBeenCalledTimes(1)

    await useNotesStore.getState().moveNote('甲', '丙', 'folder')
    expect(mocks.move).toHaveBeenCalledTimes(1)

    release!({ ok: true, id: '乙/甲' })
    await first
    expect(useNotesStore.getState().moving).toBe(false)
    expect([...useNotesStore.getState().expanded]).toEqual(['乙'])
    // 目录树播完才清。这里不挂目录树,落地信息留着。
    expect(useNotesStore.getState().moveLand).toEqual({ fromId: '甲', toId: '乙/甲', kind: 'folder' })
  })

  it('移动失败也要清掉 moving', async () => {
    useNotesStore.setState({ moveLand: { fromId: '旧', toId: '旧/处', kind: 'note' } })
    mocks.move.mockResolvedValue({ ok: false, message: '不能把目录移动到它自己里面' })
    await useNotesStore.getState().moveNote('甲', '甲', 'folder')
    expect(useNotesStore.getState().moving).toBe(false)
    expect(useNotesStore.getState().moveLand).toBeNull()
    expect(mocks.toast).toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('打开的文件路径跟着换,展开的子目录前缀和目标祖先一起换', async () => {
    filesState.file = fileDoc('甲/note.txt')
    useNotesStore.setState({
      expanded: new Set(['甲', '甲/子', '旁路']),
      selectedFolder: '甲/子'
    })
    const next: NoteFileStat = {
      path: '乙/甲/note.txt',
      name: 'note.txt',
      ext: 'txt',
      kind: 'text',
      mime: 'text/plain',
      size: 4,
      mtimeMs: 2,
      editable: true,
      tooLarge: false
    }
    mocks.move.mockResolvedValue({ ok: true, id: '乙/甲' })
    mocks.statFile.mockResolvedValue(next)

    await useNotesStore.getState().moveNote('甲', '乙', 'folder')

    expect(mocks.flushFile).toHaveBeenCalledTimes(1)
    expect(mocks.statFile).toHaveBeenCalledWith('乙/甲/note.txt')
    expect(mocks.repath).toHaveBeenCalledWith('甲/note.txt', next)
    expect([...useNotesStore.getState().expanded].sort()).toEqual(['乙', '乙/甲', '乙/甲/子', '旁路'])
    expect(useNotesStore.getState().selectedFolder).toBe('乙/甲/子')
    expect(useNotesStore.getState().moving).toBe(false)
    expect(useNotesStore.getState().moveLand).toEqual({ fromId: '甲', toId: '乙/甲', kind: 'folder' })
  })

  it('文件移动直接用返回的元信息,不再 stat', async () => {
    filesState.file = fileDoc('pic.png')
    const next: NoteFileStat = {
      path: '乙/pic.png',
      name: 'pic.png',
      ext: 'png',
      kind: 'image',
      mime: 'image/png',
      size: 4,
      mtimeMs: 2,
      editable: false,
      tooLarge: false
    }
    mocks.move.mockResolvedValue({ ok: true, id: '乙/pic.png', file: next })

    await useNotesStore.getState().moveNote('pic.png', '乙', 'file')

    expect(mocks.statFile).not.toHaveBeenCalled()
    expect(mocks.repath).toHaveBeenCalledWith('pic.png', next)
    expect([...useNotesStore.getState().expanded]).toEqual(['乙'])
    expect(useNotesStore.getState().moveLand).toEqual({ fromId: 'pic.png', toId: '乙/pic.png', kind: 'file' })
  })
})
