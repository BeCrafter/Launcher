import { describe, expect, it } from 'vitest'
import { createGitLabStore } from './git-gitlab'
import { IncompleteListError } from './store'

interface Call {
  url: string
  method: string
  body?: unknown
}

function fakeFetch(respond: (url: string, method: string, body: unknown) => unknown) {
  const calls: Call[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ url, method, body })
    const payload = respond(url, method, body)
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { fetchImpl, calls }
}

describe('createGitLabStore', () => {
  it('已有文件用 update,新文件用 create,删除单独一条;超过 100 条拆批', async () => {
    const tree = Array.from({ length: 100 }, (_, i) => ({
      path: `old/${i}.md`,
      type: 'blob' as const,
      id: `sha${i}`
    }))
    let page = 0
    const { fetchImpl, calls } = fakeFetch((url, method) => {
      if (method === 'GET' && url.includes('/repository/tree')) {
        page += 1
        return page === 1 ? tree : [{ path: 'keep.md', type: 'blob', id: 'keep' }]
      }
      if (method === 'POST' && url.includes('/repository/commits')) return { id: 'c' }
      return {}
    })
    const store = createGitLabStore(
      { repo: 'ns/proj', branch: 'main', apiBaseUrl: '', token: 't' },
      { fetch: fetchImpl }
    )
    const listed = await store.list()
    expect(listed.size).toBe(101)
    expect(listed.get('old/0.md')?.hash).toBe('sha0')

    await store.write('old/0.md', Buffer.from('changed'))
    await store.write('new.md', Buffer.from('fresh'))
    await store.remove('keep.md')
    for (let i = 1; i < 100; i += 1) await store.write(`more/${i}.md`, Buffer.from('x'))
    await store.flush?.()

    const commits = calls.filter((c) => c.method === 'POST')
    expect(commits).toHaveLength(2)
    const first = commits[0].body as { actions: { action: string; file_path: string }[] }
    expect(first.actions).toHaveLength(100)
    expect(first.actions[0]).toMatchObject({ action: 'update', file_path: 'old/0.md', encoding: 'base64' })
    expect(first.actions[1]).toMatchObject({ action: 'create', file_path: 'new.md' })
    expect(first.actions[2]).toMatchObject({ action: 'delete', file_path: 'keep.md' })
    const second = commits[1].body as { actions: unknown[] }
    expect(second.actions.length).toBeGreaterThan(0)
    expect(second.actions.length).toBeLessThanOrEqual(100)
  })

  it('分页没有结束时拒绝列出', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ path: `p/${i}.md`, type: 'blob', id: 'x' }))
    const { fetchImpl } = fakeFetch(() => page)
    const store = createGitLabStore(
      { repo: 'ns/proj', branch: '', apiBaseUrl: 'https://gitlab.example/api/v4', token: 't' },
      { fetch: fetchImpl }
    )
    await expect(store.list()).rejects.toBeInstanceOf(IncompleteListError)
  })
})
