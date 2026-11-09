// 笔记 store 的「保存被切走」竞态。
// 打开笔记时,上一篇的保存已经改成后台执行 —— 它完成得比切换晚是常态,
// 这条晚到的回写绝不能碰当前笔记的缓冲:
//   · 不能把新笔记的 dirty 清掉(否则新笔记的输入再也不会被保存);
//   · 旧笔记的冲突不能挂到新笔记的裁决上(否则「使用磁盘版本」会把旧内容灌进新草稿)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Note } from '@shared/notes'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  search: vi.fn()
}))

vi.mock('../lib/utils', () => ({ showToast: mocks.toast }))
vi.mock('../data', () => ({
  dataSource: (): unknown => ({
    notes: {
      list: mocks.list,
      read: mocks.read,
      save: mocks.save,
      search: mocks.search,
      rename: vi.fn()
    }
  })
}))

import { useNotesStore } from './notes-store'

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
