import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentHash, gitBlobSha } from './scan'
import { createVaultSync } from './service'
import { ConflictError, IncompleteListError, type RemoteStore } from './store'
import type { RemoteEntry } from './plan'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'launcher-sync-svc-'))
  dirs.push(d)
  return d
}

/** 内存里的远端:etag 用内容哈希,这样第一次同步能比对 */
function memoryStore(id = 'memory|test'): RemoteStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>()
  const store: RemoteStore & { files: Map<string, Buffer> } = {
    targetId: id,
    files,
    async list() {
      const out = new Map<string, RemoteEntry>()
      for (const [path, body] of files) {
        out.set(path, { path, etag: contentHash(body), size: body.length, hash: contentHash(body) })
      }
      return out
    },
    async read(path) {
      const body = files.get(path)
      if (!body) throw new Error(`not found: ${path}`)
      return body
    },
    async write(path, body, expected) {
      const current = files.get(path)
      if (expected !== undefined && current !== undefined && contentHash(current) !== expected) {
        throw new ConflictError(path)
      }
      files.set(path, Buffer.from(body))
      return { etag: contentHash(body) }
    },
    async remove(path) {
      files.delete(path)
    },
    async rename(from, to) {
      const body = files.get(from)
      if (!body) return false
      files.set(to, body)
      files.delete(from)
      return true
    }
  }
  return store
}

function make(
  root: string,
  store: RemoteStore,
  over: Partial<Parameters<typeof createVaultSync>[0]> = {},
  stateDir = temp()
) {
  return createVaultSync({
    getRoot: () => root,
    getIgnore: () => '.*\n*.tmp',
    getTargetId: () => store.targetId,
    getStore: () => store,
    statePath: join(stateDir, 'state.json'),
    maxBytes: 100,
    debounceMs: 1000,
    now: () => 1000,
    ...over
  })
}

describe('createVaultSync', () => {
  it('本地新文件推上去,远端新文件拉下来', async () => {
    const root = temp()
    writeFileSync(join(root, 'local.md'), 'mine')
    const store = memoryStore()
    store.files.set('remote.md', Buffer.from('theirs'))
    const pulled: string[] = []
    const sync = make(root, store, { onPulled: (p) => pulled.push(...p) })

    const status = await sync.syncNow()
    expect(status.phase).toBe('idle')
    expect(store.files.get('local.md')?.toString()).toBe('mine')
    expect(readFileSync(join(root, 'remote.md'), 'utf8')).toBe('theirs')
    expect(pulled).toEqual(['remote.md'])
  })

  it('Git 首次同步内容相同不冲突,下一轮也不把没改过的当成两边都变', async () => {
    const root = temp()
    const body = Buffer.from('same-bytes')
    writeFileSync(join(root, 'a.md'), body)
    const files = new Map<string, Buffer>([['a.md', Buffer.from(body)]])
    let writes = 0
    const store: RemoteStore = {
      targetId: 'github|test',
      cursor: () => 'commit1',
      async list() {
        const out = new Map<string, RemoteEntry>()
        for (const [path, buf] of files) {
          const sha = gitBlobSha(buf)
          out.set(path, { path, etag: sha, size: buf.length, hash: sha })
        }
        return out
      },
      async read(path) {
        const buf = files.get(path)
        if (buf === undefined) throw new Error(`not found: ${path}`)
        return buf
      },
      async write(_path, buf) {
        writes += 1
        return { etag: gitBlobSha(buf) }
      },
      async remove() {}
    }
    const stateDir = temp()
    const sync = make(root, store, {}, stateDir)
    const first = await sync.syncNow()
    expect(first.phase).toBe('idle')
    expect(first.conflicts).toEqual([])
    expect(writes).toBe(0)
    const saved = JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8')) as {
      cursor?: string
      files: Record<string, { hash: string; etag: string }>
    }
    expect(saved.cursor).toBe('commit1')
    expect(saved.files['a.md']?.hash).toBe(contentHash(body))
    expect(saved.files['a.md']?.etag).toBe(gitBlobSha(body))

    const second = await sync.syncNow()
    expect(second.phase).toBe('idle')
    expect(second.conflicts).toEqual([])
    expect(writes).toBe(0)
  })

  it('两边都改过就停下来,不覆盖', async () => {
    const root = temp()
    const store = memoryStore()
    writeFileSync(join(root, 'a.md'), 'v1')
    store.files.set('a.md', Buffer.from('v1'))
    const sync = make(root, store)
    await sync.syncNow()

    writeFileSync(join(root, 'a.md'), 'local-edit')
    store.files.set('a.md', Buffer.from('remote-edit'))
    const status = await sync.syncNow()
    expect(status.phase).toBe('conflict')
    expect(status.conflicts).toEqual(['a.md'])
    expect(readFileSync(join(root, 'a.md'), 'utf8')).toBe('local-edit')
    expect(store.files.get('a.md')?.toString()).toBe('remote-edit')
  })

  it('保留远端会覆盖本地并清掉冲突', async () => {
    const root = temp()
    const store = memoryStore()
    writeFileSync(join(root, 'a.md'), 'v1')
    store.files.set('a.md', Buffer.from('v1'))
    const sync = make(root, store)
    await sync.syncNow()
    writeFileSync(join(root, 'a.md'), 'local-edit')
    store.files.set('a.md', Buffer.from('remote-edit'))
    await sync.syncNow()

    const status = await sync.resolve('a.md', 'remote')
    expect(status.conflicts).toEqual([])
    expect(readFileSync(join(root, 'a.md'), 'utf8')).toBe('remote-edit')
  })

  it('超限文件跳过,快照里不记成已同步', async () => {
    const root = temp()
    writeFileSync(join(root, 'big.bin'), Buffer.alloc(200))
    const store = memoryStore()
    const stateDir = temp()
    const sync = make(root, store, {}, stateDir)
    const status = await sync.syncNow()
    expect(store.files.has('big.bin')).toBe(false)
    expect(status.errors[0]?.path).toBe('big.bin')
    const saved = JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8')) as {
      files: Record<string, unknown>
    }
    expect(saved.files['big.bin']).toBeUndefined()
  })

  it('列目录不完整时整轮不动,不写快照', async () => {
    const root = temp()
    writeFileSync(join(root, 'a.md'), 'v')
    const store = memoryStore()
    store.list = async () => {
      throw new IncompleteListError('truncated')
    }
    const stateDir = temp()
    const sync = make(root, store, {}, stateDir)
    const status = await sync.syncNow()
    expect(status.phase).toBe('error')
    expect(existsSync(join(stateDir, 'state.json'))).toBe(false)
  })

  it('提交没成功时,排队的写入不记进快照', async () => {
    const root = temp()
    const store = memoryStore()
    writeFileSync(join(root, 'a.md'), 'v1')
    const stateDir = temp()
    const sync = make(root, store, {}, stateDir)
    await sync.syncNow()

    writeFileSync(join(root, 'a.md'), 'v2')
    const before = JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8')) as {
      files: Record<string, { etag: string }>
    }
    let flushed = false
    store.flush = async () => {
      flushed = true
      throw new Error('ref rejected')
    }
    const status = await sync.syncNow()
    expect(flushed).toBe(true)
    expect(status.phase).toBe('error')
    const saved = JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8')) as {
      files: Record<string, { etag: string }>
    }
    expect(saved.files['a.md']?.etag).toBe(before.files['a.md']?.etag)
  })

  it('有冲突就不提交排队的写入,下一轮成功时也不会带上', async () => {
    const root = temp()
    const store = memoryStore()
    writeFileSync(join(root, 'a.md'), 'v1')
    writeFileSync(join(root, 'b.md'), 'keep')
    const sync = make(root, store)
    await sync.syncNow()

    writeFileSync(join(root, 'a.md'), 'local-edit')
    store.files.set('a.md', Buffer.from('remote-edit'))
    writeFileSync(join(root, 'b.md'), 'b2')
    const queued: string[] = []
    store.flush = async () => {
      queued.push('flushed')
    }
    const held = await sync.syncNow()
    expect(held.phase).toBe('conflict')
    expect(queued).toEqual([])

    // 选定保留本地。resolve 自己会 flush 一次;如果冲突那一轮的队列没丢掉,
    // 这一次会把当时排队的 b 一起交出去,flush 就不止一次
    const kept = await sync.resolve('a.md', 'local')
    expect(kept.conflicts).toEqual([])
    expect(queued).toEqual(['flushed'])
  })

  it('换 targetId 后旧快照不再生效', async () => {
    const root = temp()
    const store = memoryStore()
    writeFileSync(join(root, 'a.md'), 'v1')
    const stateDir = temp()
    const sync = make(root, store, {}, stateDir)
    await sync.syncNow()

    const other = memoryStore('memory|other')
    other.files.set('a.md', Buffer.from('different'))
    const next = make(root, other, {}, stateDir)
    const status = await next.syncNow()
    // 旧快照对不上,按第一次同步:两边内容不同 → 冲突,不覆盖
    expect(status.conflicts).toEqual(['a.md'])
    expect(readFileSync(join(root, 'a.md'), 'utf8')).toBe('v1')
  })
})
