import { describe, expect, it } from 'vitest'
import { compileIgnore, DEFAULT_SYNC_IGNORE } from './ignore'
import { planSync, type RemoteEntry } from './plan'
import type { LocalFile, SnapshotFile } from './scan'

const ignore = compileIgnore(DEFAULT_SYNC_IGNORE)

function local(path: string, hash: string, size = 1): LocalFile {
  return { path, size, mtimeMs: 1, hash }
}

function snap(hash: string, etag: string, size = 1): SnapshotFile {
  return { etag, size, mtimeMs: 1, hash }
}

function remote(path: string, etag: string, hash?: string, size = 1): RemoteEntry {
  return { path, etag, size, hash }
}

function run(over: Partial<Parameters<typeof planSync>[0]> = {}) {
  return planSync({
    local: new Map(),
    remote: new Map(),
    snapshot: new Map(),
    firstSync: false,
    ignore,
    ...over
  })
}

describe('planSync', () => {
  it('只本地变了就推,只远端变了就拉', () => {
    const plan = run({
      local: new Map([
        ['a.md', local('a.md', 'new')],
        ['b.md', local('b.md', 'same')]
      ]),
      remote: new Map([
        ['a.md', remote('a.md', 'e1')],
        ['b.md', remote('b.md', 'e2-new')]
      ]),
      snapshot: new Map([
        ['a.md', snap('old', 'e1')],
        ['b.md', snap('same', 'e2')]
      ])
    })
    expect(plan.push).toEqual(['a.md'])
    expect(plan.pull).toEqual(['b.md'])
    expect(plan.conflicts).toEqual([])
  })

  it('两边都变了是冲突,不进推也不进拉', () => {
    const plan = run({
      local: new Map([['a.md', local('a.md', 'local')]]),
      remote: new Map([['a.md', remote('a.md', 'e2')]]),
      snapshot: new Map([['a.md', snap('old', 'e1')]])
    })
    expect(plan.conflicts).toEqual(['a.md'])
    expect(plan.push).toEqual([])
    expect(plan.pull).toEqual([])
  })

  it('本地没了且远端没变就删远端;远端没了且本地没变就删本地', () => {
    const plan = run({
      local: new Map([['keep.md', local('keep.md', 'h')]]),
      remote: new Map([
        ['keep.md', remote('keep.md', 'e0')],
        ['gone-local.md', remote('gone-local.md', 'e1')]
      ]),
      snapshot: new Map([
        ['keep.md', snap('h', 'e0')],
        ['gone-local.md', snap('h2', 'e1')]
      ])
    })
    expect(plan.deleteRemote).toEqual(['gone-local.md'])
    expect(plan.deleteLocal).toEqual([])

    const other = run({
      local: new Map([['gone-remote.md', local('gone-remote.md', 'h')]]),
      remote: new Map(),
      snapshot: new Map([['gone-remote.md', snap('h', 'e1')]])
    })
    expect(other.deleteLocal).toEqual(['gone-remote.md'])
  })

  it('第一次同步:两边都有且哈希不同是冲突,相同就不动,只有远端有就拉', () => {
    const plan = run({
      firstSync: true,
      local: new Map([
        ['same.md', local('same.md', 'h')],
        ['diff.md', local('diff.md', 'local')]
      ]),
      remote: new Map([
        ['same.md', remote('same.md', 'blob', 'h')],
        ['diff.md', remote('diff.md', 'blob2', 'remote')],
        ['only.md', remote('only.md', 'blob3', 'x')]
      ])
    })
    expect(plan.conflicts).toEqual(['diff.md'])
    expect(plan.baseline).toEqual(['same.md'])
    expect(plan.pull).toEqual(['only.md'])
    expect(plan.push).toEqual([])
  })

  it('第一次同步:Git blob SHA 对得上就不冲突,对不上仍是冲突', () => {
    const same = run({
      firstSync: true,
      local: new Map([['a.md', { ...local('a.md', 'sha256'), gitHash: 'blob' }]]),
      remote: new Map([['a.md', remote('a.md', 'blob', 'blob')]])
    })
    expect(same.conflicts).toEqual([])
    expect(same.baseline).toEqual(['a.md'])
    expect(same.push).toEqual([])

    const different = run({
      firstSync: true,
      local: new Map([['a.md', { ...local('a.md', 'sha256'), gitHash: 'blob-local' }]]),
      remote: new Map([['a.md', remote('a.md', 'blob-remote', 'blob-remote')]])
    })
    expect(different.conflicts).toEqual(['a.md'])
    expect(different.baseline).toEqual([])
  })

  it('第一次同步比不出内容哈希时不猜,记为冲突', () => {
    const plan = run({
      firstSync: true,
      local: new Map([['a.md', local('a.md', 'h', 10)]]),
      remote: new Map([['a.md', remote('a.md', 'etag', undefined, 10)]])
    })
    expect(plan.conflicts).toEqual(['a.md'])
  })

  it('相同哈希的旧路径消失、新路径出现,当成改名', () => {
    const plan = run({
      local: new Map([['b.md', local('b.md', 'h')]]),
      remote: new Map([['a.md', remote('a.md', 'e1')]]),
      snapshot: new Map([['a.md', snap('h', 'e1')]])
    })
    expect(plan.renames).toEqual([{ from: 'a.md', to: 'b.md' }])
    expect(plan.deleteRemote).toEqual([])
    expect(plan.push).toEqual([])
  })

  it('规则收紧后,被排除的远端路径不进删除清单', () => {
    const plan = run({
      local: new Map(),
      remote: new Map([['.obsidian/a.json', remote('.obsidian/a.json', 'e1')]]),
      snapshot: new Map([['.obsidian/a.json', snap('h', 'e1')]])
    })
    expect(plan.deleteRemote).toEqual([])
    expect(plan.pull).toEqual([])
  })
})
