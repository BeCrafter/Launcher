import { describe, expect, it, vi } from 'vitest'
import { checkForUpdate, compareVersions, fetchLatestRelease, parseTagVersion } from './update-check'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('parseTagVersion / compareVersions', () => {
  it('剥离 v 前缀', () => {
    expect(parseTagVersion('v2.0.0')).toBe('2.0.0')
    expect(parseTagVersion(' 1.2.3 ')).toBe('1.2.3')
  })

  it('数字段比较与缺段补 0', () => {
    expect(compareVersions('2.0.0', '0.1.0')).toBe(1)
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('v1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.0', '1.2.1')).toBe(-1)
  })

  it('预发布低于同版本正式版;非数字段回退 0', () => {
    expect(compareVersions('2.0.0-beta', '2.0.0')).toBe(-1)
    expect(compareVersions('2.0.0', '2.0.0-beta')).toBe(1)
    expect(compareVersions('x.y.z', '0.0.0')).toBe(0)
  })
})

describe('fetchLatestRelease', () => {
  it('200:解出 tag/version/htmlUrl', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ tag_name: 'v1.3.0', html_url: 'https://github.com/BeCrafter/Launcher/releases/tag/v1.3.0', name: 'Release 1.3' })
    )
    const r = await fetchLatestRelease({ fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r).toEqual({
      ok: true,
      release: {
        tagName: 'v1.3.0',
        version: '1.3.0',
        htmlUrl: 'https://github.com/BeCrafter/Launcher/releases/tag/v1.3.0',
        name: 'Release 1.3'
      }
    })
    // GitHub API 硬性要求 User-Agent
    const init = fetchImpl.mock.calls[0][1]
    expect((init?.headers as Record<string, string>)['User-Agent']).toBeTruthy()
  })

  it('404(未发布 Release)→ ok 且 release 为 null,与故障分态', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'Not Found' }, 404))
    const r = await fetchLatestRelease({ fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r).toEqual({ ok: true, release: null })
  })

  it('5xx → ok:false;响应形状异常 → ok:false', async () => {
    const bad = vi.fn(async () => jsonResponse({}, 500))
    expect((await fetchLatestRelease({ fetchImpl: bad as unknown as typeof fetch })).ok).toBe(false)
    const weird = vi.fn(async () => jsonResponse({ nothing: true }))
    expect((await fetchLatestRelease({ fetchImpl: weird as unknown as typeof fetch })).ok).toBe(false)
  })

  it('抛错/超时 → ok:false 且带 error', async () => {
    const throwing = vi.fn(async () => {
      throw new Error('network down')
    })
    const r1 = await fetchLatestRelease({ fetchImpl: throwing as unknown as typeof fetch })
    expect(r1.ok).toBe(false)

    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    const r2 = await fetchLatestRelease({ fetchImpl: hanging as unknown as typeof fetch, timeoutMs: 20 })
    expect(r2.ok).toBe(false)
  })
})

describe('checkForUpdate', () => {
  const releaseFetch = (tag: string): typeof fetch =>
    (async () => jsonResponse({ tag_name: tag, html_url: `https://example.com/${tag}`, name: null })) as unknown as typeof fetch

  it('有新版本 → available', async () => {
    const r = await checkForUpdate('0.1.0', { fetchImpl: releaseFetch('v2.0.0') })
    expect(r.status).toBe('available')
    expect(r.latest?.version).toBe('2.0.0')
    expect(r.currentVersion).toBe('0.1.0')
  })

  it('已最新(含本地领先)→ upToDate', async () => {
    expect((await checkForUpdate('0.1.0', { fetchImpl: releaseFetch('v0.0.9') })).status).toBe('upToDate')
    expect((await checkForUpdate('9.9.9', { fetchImpl: releaseFetch('v0.1.0') })).status).toBe('upToDate')
  })

  it('无 Release → noRelease;故障 → error 且 errorMessage 有值', async () => {
    const noRel = (async () => jsonResponse({}, 404)) as unknown as typeof fetch
    expect((await checkForUpdate('0.1.0', { fetchImpl: noRel })).status).toBe('noRelease')

    const broken = (async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch
    const r = await checkForUpdate('0.1.0', { fetchImpl: broken })
    expect(r.status).toBe('error')
    expect(r.errorMessage).toBeTruthy()
  })
})
