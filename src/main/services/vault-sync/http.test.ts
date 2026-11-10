import { describe, expect, it } from 'vitest'
import { request } from './http'

function failing(status: number): { fetchImpl: typeof fetch; calls: () => number } {
  let count = 0
  const fetchImpl: typeof fetch = async () => {
    count += 1
    return new Response('no', { status, headers: { 'retry-after': '0.001' } })
  }
  return { fetchImpl, calls: () => count }
}

describe('request', () => {
  it('429 重试一次，412 不重试', async () => {
    const limited = failing(429)
    const res = await request({ fetch: limited.fetchImpl }, 'https://dav.example/notes')
    expect(res.status).toBe(429)
    expect(limited.calls()).toBe(2)

    const precondition = failing(412)
    const denied = await request({ fetch: precondition.fetchImpl }, 'https://s3.amazonaws.com/vault/a')
    expect(denied.status).toBe(412)
    expect(precondition.calls()).toBe(1)
  })

  it('403 只在 GitHub 主机上重试，S3 和名字像的主机不重试', async () => {
    const github = failing(403)
    await request({ fetch: github.fetchImpl }, 'https://api.github.com/repos/o/r')
    expect(github.calls()).toBe(2)

    const s3 = failing(403)
    await request({ fetch: s3.fetchImpl }, 'https://s3.amazonaws.com/vault/a')
    expect(s3.calls()).toBe(1)

    const lookalike = failing(403)
    await request({ fetch: lookalike.fetchImpl }, 'https://notgithub.com/repos/o/r')
    expect(lookalike.calls()).toBe(1)
  })
})
