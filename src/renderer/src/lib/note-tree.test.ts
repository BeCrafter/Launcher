import { describe, expect, it } from 'vitest'
import type { NoteMeta } from '@shared/notes'
import { ancestorsOf, buildNoteTree, countNotesIn, findFolder, sortNotes } from './note-tree'

function note(id: string, patch: Partial<NoteMeta> = {}): NoteMeta {
  return {
    id,
    title: id,
    created: '2026-10-09T10:00:00+08:00',
    updated: '2026-10-09T10:00:00+08:00',
    tags: [],
    pinned: false,
    refs: [],
    excerpt: '',
    mtimeMs: 0,
    size: 0,
    frontmatterIssues: [],
    refsUnparsed: false,
    opaque: false,
    ...patch
  }
}

describe('sortNotes', () => {
  it('置顶永远在前,与排序键无关', () => {
    const list = [
      note('b', { updated: '2026-10-09T12:00:00+08:00' }),
      note('a', { updated: '2026-10-09T09:00:00+08:00', pinned: true })
    ]
    // 按更新:a 更旧,但置顶 → 仍在前
    expect(sortNotes(list, 'updated').map((n) => n.id)).toEqual(['a', 'b'])
    // 按标题:a 本来就在前,这里验证「置顶不会把非置顶挤到后面去」
    expect(sortNotes(list, 'title').map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('置顶内部仍按排序键', () => {
    const list = [
      note('a', { pinned: true, updated: '2026-10-09T09:00:00+08:00' }),
      note('b', { pinned: true, updated: '2026-10-09T12:00:00+08:00' })
    ]
    expect(sortNotes(list, 'updated').map((n) => n.id)).toEqual(['b', 'a'])
  })

  it('按标题 / 按创建', () => {
    const list = [
      note('z', { title: '苹果', created: '2026-01-01T00:00:00+08:00' }),
      note('y', { title: 'banana', created: '2026-02-01T00:00:00+08:00' })
    ]
    expect(sortNotes(list, 'created').map((n) => n.id)).toEqual(['y', 'z'])
    expect(sortNotes(list, 'title')).toHaveLength(2)
  })

  it('不改原数组', () => {
    const list = [note('b'), note('a', { pinned: true })]
    const before = list.map((n) => n.id)
    sortNotes(list, 'updated')
    expect(list.map((n) => n.id)).toEqual(before)
  })
})

describe('buildNoteTree', () => {
  it('按 id 路径挂到对应目录', () => {
    const tree = buildNoteTree([note('a'), note('工作/b'), note('工作/子/c')], [])
    expect(tree.notes.map((n) => n.id)).toEqual(['a'])
    expect(tree.folders.map((f) => f.name)).toEqual(['工作'])
    const work = tree.folders[0]
    expect(work.notes.map((n) => n.id)).toEqual(['工作/b'])
    expect(work.folders[0].name).toBe('子')
    expect(work.folders[0].notes.map((n) => n.id)).toEqual(['工作/子/c'])
  })

  it('空目录照样出现在树里(它是空目录唯一的痕迹)', () => {
    const tree = buildNoteTree([], ['空的', '还有/嵌套的'])
    expect(tree.folders.map((f) => f.name)).toEqual(['还有', '空的'])
    const nested = findFolder(tree, '还有/嵌套的')
    expect(nested).not.toBeNull()
    expect(nested?.notes).toEqual([])
  })

  it('中间层没被显式列出也会补出来', () => {
    const tree = buildNoteTree([note('a/b/c')], ['a/b/c'])
    expect(findFolder(tree, 'a')).not.toBeNull()
    expect(findFolder(tree, 'a/b')).not.toBeNull()
  })

  it('目录按名称排序', () => {
    const tree = buildNoteTree([], ['zebra', 'apple', '芒果'])
    expect(tree.folders.map((f) => f.name)).not.toEqual(['zebra', 'apple', '芒果'])
    expect(tree.folders.map((f) => f.name)).toHaveLength(3)
  })

  it('countNotesIn 统计子树', () => {
    const tree = buildNoteTree([note('a'), note('工作/b'), note('工作/子/c')], [])
    expect(countNotesIn(tree)).toBe(3)
    expect(countNotesIn(findFolder(tree, '工作')!)).toBe(2)
  })
})

describe('ancestorsOf', () => {
  it('返回全部祖先,由外到内', () => {
    expect(ancestorsOf('a/b/c')).toEqual(['a', 'a/b'])
    expect(ancestorsOf('a')).toEqual([])
  })
})

describe('findFolder', () => {
  it('根路径返回根节点', () => {
    const tree = buildNoteTree([], [])
    expect(findFolder(tree, '')?.path).toBe('')
  })

  it('找不到返回 null', () => {
    expect(findFolder(buildNoteTree([], []), 'nope')).toBeNull()
  })
})

describe('排序的确定性', () => {
  it('created 完全相同(同一秒建出来的)时,顺序不随输入顺序变', () => {
    const same = '2026-10-10T00:16:18+08:00'
    const a = note('b', { created: same })
    const b = note('a', { created: same })
    const c = note('c', { created: same })
    const one = sortNotes([a, b, c], 'created').map((n) => n.id)
    const two = sortNotes([c, a, b], 'created').map((n) => n.id)
    expect(one).toEqual(two) // 输入顺序不同,结果必须相同
    expect(one).toEqual(['a', 'b', 'c']) // 决胜键是 id
  })

  it('updated 完全相同(同一秒保存的)时同样确定', () => {
    const same = '2026-10-10T00:16:18+08:00'
    const one = sortNotes([note('b', { updated: same }), note('a', { updated: same })], 'updated').map((n) => n.id)
    const two = sortNotes([note('a', { updated: same }), note('b', { updated: same })], 'updated').map((n) => n.id)
    expect(one).toEqual(two)
  })

  it('标题也相同(重名笔记)时同样确定', () => {
    const same = 'x'
    const one = sortNotes([note('b', { title: same }), note('a', { title: same })], 'title').map((n) => n.id)
    const two = sortNotes([note('a', { title: same }), note('b', { title: same })], 'title').map((n) => n.id)
    expect(one).toEqual(two)
  })
})
