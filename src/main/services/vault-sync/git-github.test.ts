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
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
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
        expect.objectContaining({ path: 'a.md' }),
        expect.objectContaining({ path: 'gone.md', sha: null })
      ])
    )
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
})
