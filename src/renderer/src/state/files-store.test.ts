// 文件 store:打开 / 去抖保存 / 保存中再改 / 冲突 / leave 不丢缓冲 / 过期打开。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoteFileStat, NoteFileTextDoc } from '@shared/notes'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  statFile: vi.fn(),
  readFile: vi.fn(),
  saveFile: vi.fn()
}))

vi.mock('../lib/utils', () => ({ showToast: mocks.toast }))
vi.mock('../data', () => ({
  dataSource: (): unknown => ({
    notes: {
      statFile: mocks.statFile,
      readFile: mocks.readFile,
      saveFile: mocks.saveFile,
      readFileBytes: vi.fn(),
      list: vi.fn(),
      read: vi.fn(),
      save: vi.fn(),
      search: vi.fn(),
      rename: vi.fn()
    }
  })
}))

import { useFilesStore } from './files-store'

function statOf(path: string, kind: NoteFileStat['kind'] = 'text'): NoteFileStat {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  return {
    path,
    name,
    ext,
    kind,
    mime: 'text/plain',
    size: 3,
    mtimeMs: 1000,
    editable: kind === 'text' || kind === 'code' || kind === 'markdown' || kind === 'html' || kind === 'csv',
    tooLarge: false
  }
}

function textDocOf(path: string, text: string, revision: string): NoteFileTextDoc {
  return {
    ...statOf(path),
    editable: true,
    revision,
    encoding: 'utf8',
    eol: '\n',
    text
  }
}

function reset(): void {
  useFilesStore.setState({
    file: null,
    openingPath: null,
    dirty: false,
    saving: false,
    savedAt: 0,
    conflict: null,
    error: null,
    saveNonce: 0,
    docSession: 0
  })
  mocks.toast.mockReset()
}

describe('files-store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.statFile.mockReset()
    mocks.readFile.mockReset()
    mocks.saveFile.mockReset()
    reset()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('打开文本文件 → 输入 → 900ms 去抖保存,成功后刷新 revision 与 saveNonce', async () => {
    mocks.statFile.mockResolvedValue(statOf('a.txt'))
    mocks.readFile.mockResolvedValue({ ok: true, doc: textDocOf('a.txt', 'one', 'r1') })
    mocks.saveFile.mockImplementation(async (input: { text: string }) => ({
      ok: true,
      doc: textDocOf('a.txt', input.text, 'r2')
    }))

    await useFilesStore.getState().open('a.txt')
    expect(useFilesStore.getState().file?.text).toBe('one')

    useFilesStore.getState().setText('one two')
    expect(useFilesStore.getState().dirty).toBe(true)
    expect(mocks.saveFile).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(900)
    expect(mocks.saveFile).toHaveBeenCalledWith({
      path: 'a.txt',
      text: 'one two',
      expectedRevision: 'r1'
    })
    const s = useFilesStore.getState()
    expect(s.dirty).toBe(false)
    expect(s.file?.revision).toBe('r2')
    expect(s.saveNonce).toBe(1)
  })

  it('保存还在飞时继续输入:旧保存不清 dirty,随后再保存新内容', async () => {
    mocks.statFile.mockResolvedValue(statOf('a.txt'))
    mocks.readFile.mockResolvedValue({ ok: true, doc: textDocOf('a.txt', 'one', 'r1') })
    const pending: Array<(v: unknown) => void> = []
    mocks.saveFile.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve))
    )

    await useFilesStore.getState().open('a.txt')
    useFilesStore.getState().setText('v1')
    await vi.advanceTimersByTimeAsync(900)
    expect(pending).toHaveLength(1)

    useFilesStore.getState().setText('v2')
    pending[0]!({ ok: true, doc: textDocOf('a.txt', 'v1', 'r2') })
    await vi.advanceTimersByTimeAsync(0)

    expect(useFilesStore.getState().dirty).toBe(true)
    expect(useFilesStore.getState().file?.text).toBe('v2')

    await vi.advanceTimersByTimeAsync(900)
    expect(pending).toHaveLength(2)
    expect(mocks.saveFile).toHaveBeenLastCalledWith({
      path: 'a.txt',
      text: 'v2',
      expectedRevision: 'r2'
    })
    pending[1]!({ ok: true, doc: textDocOf('a.txt', 'v2', 'r3') })
    await vi.advanceTimersByTimeAsync(0)
    expect(useFilesStore.getState().dirty).toBe(false)
  })

  it('冲突暂停自动保存;「使用磁盘版本」重新加载', async () => {
    mocks.statFile.mockResolvedValue(statOf('a.txt'))
    mocks.readFile.mockResolvedValueOnce({ ok: true, doc: textDocOf('a.txt', 'one', 'r1') })
    mocks.saveFile.mockResolvedValue({
      ok: false,
      kind: 'conflict',
      latest: { revision: 'r9', size: 9, mtimeMs: 2000 }
    })

    await useFilesStore.getState().open('a.txt')
    useFilesStore.getState().setText('changed')
    await vi.advanceTimersByTimeAsync(900)
    expect(useFilesStore.getState().conflict?.revision).toBe('r9')

    useFilesStore.getState().setText('changed again')
    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.saveFile).toHaveBeenCalledTimes(1) // 冲突期间不再自动保存

    mocks.readFile.mockResolvedValueOnce({ ok: true, doc: textDocOf('a.txt', 'on disk', 'r9') })
    await useFilesStore.getState().resolveConflict('disk')
    const s = useFilesStore.getState()
    expect(s.conflict).toBeNull()
    expect(s.file?.text).toBe('on disk')
    expect(s.dirty).toBe(false)
  })

  it('保存失败时 leave 保留缓冲,不清空文件视图', async () => {
    mocks.statFile.mockResolvedValue(statOf('a.txt'))
    mocks.readFile.mockResolvedValue({ ok: true, doc: textDocOf('a.txt', 'one', 'r1') })
    mocks.saveFile.mockResolvedValue({ ok: false, kind: 'io', message: '磁盘不可写' })

    await useFilesStore.getState().open('a.txt')
    useFilesStore.getState().setText('unsaved')
    await useFilesStore.getState().leave()

    const s = useFilesStore.getState()
    expect(s.file?.path).toBe('a.txt')
    expect(s.file?.text).toBe('unsaved')
    expect(s.dirty).toBe(true)
    expect(mocks.toast).toHaveBeenCalled()
  })

  it('干净文件 leave 直接关闭', async () => {
    mocks.statFile.mockResolvedValue(statOf('a.txt'))
    mocks.readFile.mockResolvedValue({ ok: true, doc: textDocOf('a.txt', 'one', 'r1') })

    await useFilesStore.getState().open('a.txt')
    await useFilesStore.getState().leave()
    expect(useFilesStore.getState().file).toBeNull()
  })

  it('过期的打开结果不覆盖后打开的文件', async () => {
    let releaseA: ((v: unknown) => void) | null = null
    mocks.statFile.mockImplementation((path: string) =>
      path === 'a.txt'
        ? new Promise((resolve) => {
            releaseA = resolve
          })
        : Promise.resolve(statOf('b.txt'))
    )
    mocks.readFile.mockResolvedValue({ ok: true, doc: textDocOf('b.txt', 'bee', 'rb') })

    void useFilesStore.getState().open('a.txt')
    await useFilesStore.getState().open('b.txt')
    expect(useFilesStore.getState().file?.path).toBe('b.txt')

    releaseA!(statOf('a.txt'))
    await vi.advanceTimersByTimeAsync(0)
    expect(useFilesStore.getState().file?.path).toBe('b.txt')
  })

  it('只读类型不读正文,但已知类型仍交给查看器(binaryReason 为 null)', async () => {
    mocks.statFile.mockResolvedValue(statOf('pic.png', 'image'))
    await useFilesStore.getState().open('pic.png')
    expect(mocks.readFile).not.toHaveBeenCalled()
    const s = useFilesStore.getState()
    expect(s.file?.editable).toBe(false)
    expect(s.file?.binaryReason).toBeNull()
  })

  it('没有查看器的二进制类型标记为 unsupported 占位', async () => {
    mocks.statFile.mockResolvedValue(statOf('old.doc', 'legacy-office'))
    await useFilesStore.getState().open('old.doc')
    const s = useFilesStore.getState()
    expect(s.file?.binaryReason).toBe('unsupported')
  })

  describe('repath(磁盘改名后跟随新路径)', () => {
    async function openDirty(): Promise<void> {
      mocks.statFile.mockResolvedValue(statOf('docs/old.txt'))
      mocks.readFile.mockResolvedValue({ ok: true, doc: textDocOf('docs/old.txt', 'one', 'r1') })
      await useFilesStore.getState().open('docs/old.txt')
      useFilesStore.getState().setText('one changed')
    }

    it('命中当前文件:只换元信息,缓冲 / revision / dirty 原样保留', async () => {
      await openDirty()
      const next = { ...statOf('docs/new.txt'), size: 99, mtimeMs: 2000 }
      useFilesStore.getState().repath('docs/old.txt', next)

      const s = useFilesStore.getState()
      expect(s.file?.path).toBe('docs/new.txt')
      expect(s.file?.name).toBe('new.txt')
      expect(s.file?.size).toBe(99)
      expect(s.file?.mtimeMs).toBe(2000)
      expect(s.file?.text).toBe('one changed')
      expect(s.file?.revision).toBe('r1')
      expect(s.dirty).toBe(true)
      expect(s.docSession).toBe(1)
    })

    it('不匹配的旧路径不影响当前文档', async () => {
      await openDirty()
      useFilesStore.getState().repath('other.txt', statOf('other-new.txt'))
      expect(useFilesStore.getState().file?.path).toBe('docs/old.txt')
    })

    it('正在打开的旧路径:作废在飞的读取并按新路径重开', async () => {
      let releaseOld: ((v: unknown) => void) | null = null
      mocks.statFile.mockImplementation((path: string) =>
        path === 'old.txt'
          ? new Promise((resolve) => {
              releaseOld = resolve
            })
          : Promise.resolve(statOf('new.txt'))
      )
      mocks.readFile.mockResolvedValue({ ok: true, doc: textDocOf('new.txt', 'n', 'rn') })

      void useFilesStore.getState().open('old.txt')
      expect(useFilesStore.getState().openingPath).toBe('old.txt')
      useFilesStore.getState().repath('old.txt', statOf('new.txt'))
      await vi.advanceTimersByTimeAsync(0)

      expect(useFilesStore.getState().file?.path).toBe('new.txt')
      expect(useFilesStore.getState().openingPath).toBeNull()

      // 旧路径晚到的结果不能再覆盖新文档
      releaseOld!(statOf('old.txt'))
      await vi.advanceTimersByTimeAsync(0)
      expect(useFilesStore.getState().file?.path).toBe('new.txt')
    })
  })
})
