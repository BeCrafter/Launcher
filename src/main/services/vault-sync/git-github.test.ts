import { describe, expect, it } from 'vitest'
import { createGitHubStore } from './git-github'
import { IncompleteListError } from './store'

interface Call {
  url: string
  method: string
  body?: unknown
}

function fakeFetch(routes: { match: (url: string, method: string) => boolean; respond: (body: unknown) => unknown }[]) {
  const calls: Call[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body, (_key, value) => value) : undefined
    calls.push({ url, method, body })
    const route = routes.find((r) => r.match(url, method))
    if (!route) return new Response('not found', { status: 404 })
    const payload = route.respond(body)
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { fetchImpl, calls }
}

describe('createGitHubStore', () => {
  it('一次提交同时含更新与删除,base_tree 用树 SHA', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        match: (url) => url.endsWith('/git/ref/heads/main'),
        respond: () => ({ object: { sha: 'commit1' } })
      },
      {
        match: (url) => url.includes('/git/commits/commit1'),
        respond: () => ({ sha: 'commit1', tree: { sha: 'tree1' } })
      },
      {
        match: (url) => url.includes('/git/trees/tree1'),
        respond: () => ({
          sha: 'tree1',
          tree: [
            { path: 'a.md', mode: '100644', type: 'blob', sha: 'blobA', size: 1 },
            { path: 'gone.md', mode: '100644', type: 'blob', sha: 'blobG', size: 1 }
          ]
        })
      },
      {
        match: (url, method) => url.endsWith('/git/blobs') && method === 'POST',
        respond: () => ({ sha: 'blobNew' })
      },
      {
        match: (url, method) => url.endsWith('/git/trees') && method === 'POST',
        respond: () => ({ sha: 'tree2' })
      },
      {
        match: (url, method) => url.endsWith('/git/commits') && method === 'POST',
        respond: () => ({ sha: 'commit2' })
      },
      {
        match: (url, method) => url.includes('/git/refs/heads/main') && method === 'PATCH',
        respond: () => ({})
      }
    ])
    const store = createGitHubStore(
      { repo: 'o/r', branch: 'main', apiBaseUrl: 'https://api.github.com', token: 't' },
      { fetch: fetchImpl }
    )
    const listed = await store.list()
    expect(listed.get('a.md')?.etag).toBe('blobA')

    await store.write('a.md', Buffer.from('x'))
    await store.remove('gone.md')
    await store.flush?.()

    const treeCall = calls.find((c) => c.url.endsWith('/git/trees') && c.method === 'POST')
    const sent = treeCall?.body as { base_tree: string; tree: { path: string; sha?: string | null }[] }
    expect(sent.base_tree).toBe('tree1')
    expect(sent.tree).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'a.md', sha: 'blobNew' }),
        expect.objectContaining({ path: 'gone.md', mode: '100644', type: 'blob', sha: null })
      ])
    )
    const blobCall = calls.find((c) => c.url.endsWith('/git/blobs'))
    expect(blobCall?.body).toEqual({ content: Buffer.from('x').toString('base64'), encoding: 'base64' })
    expect(sent.tree.find((item) => item.path === 'a.md')).not.toHaveProperty('content')
    const refCall = calls.find((c) => c.method === 'PATCH')
    expect(refCall?.body).toEqual({ sha: 'commit2' })
    expect(JSON.stringify(refCall?.body)).not.toContain('force')
  })

  it('目录树被截断时拒绝列出', async () => {
    const { fetchImpl } = fakeFetch([
      { match: (url) => url.endsWith('/git/ref/heads/main'), respond: () => ({ object: { sha: 'c' } }) },
      {
        match: (url) => url.includes('/git/commits/'),
        respond: () => ({ sha: 'c', tree: { sha: 't' } })
      },
      {
        match: (url) => url.includes('/git/trees/'),
        respond: () => ({ sha: 't', truncated: true, tree: [] })
      }
    ])
    const store = createGitHubStore(
      { repo: 'o/r', branch: 'main', apiBaseUrl: '', token: 't' },
      { fetch: fetchImpl }
    )
    await expect(store.list()).rejects.toBeInstanceOf(IncompleteListError)
  })

  it('按 blob SHA 读回原始字节，不走会转码的 Contents API', async () => {
    const bytes = Buffer.from([0xff, 0xfe, 0x00])
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      const json = (payload: unknown): Response =>
        new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'commit1' } })
      if (url.includes('/git/commits/commit1')) return json({ sha: 'commit1', tree: { sha: 'tree1' } })
      if (url.includes('/git/trees/tree1')) {
        return json({ sha: 'tree1', tree: [{ path: 'raw.bin', mode: '100644', type: 'blob', sha: 'blob1', size: 3 }] })
      }
      if (url.endsWith('/git/blobs/blob1')) {
        return json({ content: `${bytes.toString('base64').slice(0, 4)}\n${bytes.toString('base64').slice(4)}`, encoding: 'base64' })
      }
      return new Response('not found', { status: 404 })
    }
    const store = createGitHubStore(
      { repo: 'o/r', branch: 'main', apiBaseUrl: 'https://api.github.com', token: 't' },
      { fetch: fetchImpl }
    )
    expect(Buffer.from(await store.read('raw.bin')).equals(bytes)).toBe(true)
  })

  it('空仓库先用 Contents API 落下一个小文件，其余文件再走 Git Data API', async () => {
    let seeded = false
    const calls: Call[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      calls.push({ url, method, body })
      const json = (payload: unknown, status = 200): Response =>
        new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
      if (url.includes('/git/ref/')) {
        return seeded
          ? json({ object: { sha: 'commit1' } })
          : json({ message: 'Git Repository is empty.' }, 409)
      }
      if (url.includes('/git/commits/commit1')) return json({ sha: 'commit1', tree: { sha: 'tree1' } })
      if (method === 'PUT' && url.includes('/contents/')) {
        seeded = true
        return json({ commit: { sha: 'commit1' } }, 201)
      }
      if (method === 'POST' && url.endsWith('/git/blobs')) return json({ sha: 'blob2' })
      if (method === 'POST' && url.endsWith('/git/trees')) return json({ sha: 'tree2' })
      if (method === 'POST' && url.endsWith('/git/commits')) return json({ sha: 'commit2' })
      if (method === 'PATCH') return json({})
      return new Response('not found', { status: 404 })
    }
    const store = createGitHubStore(
      { repo: 'o/r', branch: 'main', apiBaseUrl: 'https://api.github.com', token: 't' },
      { fetch: fetchImpl }
    )
    expect((await store.list()).size).toBe(0)
    await store.write('big.md', Buffer.from('hello'))
    await store.write('a.md', Buffer.from('hi'))
    await store.flush?.()

    const seededCall = calls.find((c) => c.method === 'PUT')
    expect(seededCall?.url).toContain('/contents/a.md')
    expect(seededCall?.body).toMatchObject({ message: 'vault sync', branch: 'main' })
    const tree = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/trees'))?.body as {
      base_tree: string
      tree: { path: string }[]
    }
    expect(tree.base_tree).toBe('tree1')
    expect(tree.tree.map((item) => item.path)).toEqual(['big.md'])
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/git/refs'))).toBe(false)
  })

  it('只剩一个文件时用 Contents API 删除，不提交空树', async () => {
    const calls: Call[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      calls.push({ url, method, body })
      const json = (payload: unknown): Response =>
        new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'commit1' } })
      if (url.includes('/git/commits/commit1')) return json({ sha: 'commit1', tree: { sha: 'tree1' } })
      if (url.includes('/git/trees/tree1')) {
        return json({ sha: 'tree1', tree: [{ path: 'only.md', mode: '100644', type: 'blob', sha: 'blob1', size: 1 }] })
      }
      if (method === 'GET' && url.endsWith('/contents/only.md')) return json({ sha: 'blob1' })
      if (method === 'DELETE') return json({ commit: { sha: 'commit0' } })
      return new Response('not found', { status: 404 })
    }
    const store = createGitHubStore(
      { repo: 'o/r', branch: 'main', apiBaseUrl: 'https://api.github.com', token: 't' },
      { fetch: fetchImpl }
    )
    await store.list()
    await store.remove('only.md')
    await store.flush?.()
    const removed = calls.find((call) => call.method === 'DELETE')
    expect(removed?.url).toContain('/contents/only.md')
    expect(removed?.body).toEqual({ message: 'vault sync', sha: 'blob1', branch: 'main' })
    expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/git/trees'))).toBe(false)
  })

  it('删最后一个文件的同时又写入别的文件时，仍走 Git Data API', async () => {
    const calls: Call[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      calls.push({ url, method, body })
      const json = (payload: unknown): Response =>
        new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'commit1' } })
      if (url.includes('/git/commits/commit1')) return json({ sha: 'commit1', tree: { sha: 'tree1' } })
      if (url.includes('/git/trees/tree1')) {
        return json({ sha: 'tree1', tree: [{ path: 'only.md', mode: '100644', type: 'blob', sha: 'blob1', size: 1 }] })
      }
      if (method === 'POST' && url.endsWith('/git/blobs')) return json({ sha: 'blob2' })
      if (method === 'POST' && url.endsWith('/git/trees')) return json({ sha: 'tree2' })
      if (method === 'POST' && url.endsWith('/git/commits')) return json({ sha: 'commit2' })
      if (method === 'PATCH') return json({})
      return new Response('not found', { status: 404 })
    }
    const store = createGitHubStore(
      { repo: 'o/r', branch: 'main', apiBaseUrl: 'https://api.github.com', token: 't' },
      { fetch: fetchImpl }
    )
    await store.list()
    await store.write('other.md', Buffer.from('x'))
    await store.remove('only.md')
    await store.flush?.()
    const tree = calls.find((call) => call.method === 'POST' && call.url.endsWith('/git/trees'))?.body as {
      tree: { path: string; sha: string | null }[]
    }
    expect(tree.tree).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'other.md', sha: 'blob2' }),
        expect.objectContaining({ path: 'only.md', sha: null })
      ])
    )
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
  })

  it('空仓库返回 409 时当成还没有分支', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.includes('/git/ref/')) {
        return new Response('{"message":"Git Repository is empty."}', {
          status: 409,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      return new Response('not found', { status: 404 })
    }
    const store = createGitHubStore(
      { repo: 'o/r', branch: 'main', apiBaseUrl: 'https://api.github.com', token: 't' },
      { fetch: fetchImpl }
    )
    expect((await store.list()).size).toBe(0)
  })
})
