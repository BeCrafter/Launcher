import { describe, expect, it, vi } from 'vitest'
import {
  artifactUrl,
  fetchUpdateManifest,
  manifestUrl,
  parseUpdateManifest
} from './update-manifest'

const SHA = 'a'.repeat(64)

function manifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: '0.3.0',
    minSystemVersion: '12.0',
    files: {
      arm64: { path: 'Launcher-0.3.0-arm64.zip', sha256: SHA, size: 123 },
      x64: { path: 'Launcher-0.3.0-x64.zip', sha256: SHA, size: 456 }
    },
    ...overrides
  })
}

describe('parseUpdateManifest', () => {
  it('解析两个架构的路径 / sha256 / size', () => {
    const r = parseUpdateManifest(manifest(), '0.3.0')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.manifest.version).toBe('0.3.0')
    expect(r.manifest.minSystemVersion).toBe('12.0')
    expect(r.manifest.files.arm64).toEqual({
      path: 'Launcher-0.3.0-arm64.zip',
      sha256: SHA,
      size: 123
    })
    expect(r.manifest.files.x64.size).toBe(456)
  })

  it('版本与目标不一致 → 拒绝(防止把别的版本装进来)', () => {
    const r = parseUpdateManifest(manifest(), '0.3.1')
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('不一致') })
  })

  it('缺少任一架构 → 拒绝', () => {
    const text = JSON.stringify({
      version: '0.3.0',
      files: { arm64: { path: 'Launcher-0.3.0-arm64.zip', sha256: SHA, size: 1 } }
    })
    expect(parseUpdateManifest(text, '0.3.0')).toMatchObject({
      ok: false,
      error: expect.stringContaining('x64')
    })
  })

  it('路径穿越 / 绝对路径 / 非 zip → 拒绝', () => {
    for (const path of ['../evil.zip', '/tmp/evil.zip', 'sub/dir.zip', 'a.txt', 'a..b.zip']) {
      const text = JSON.stringify({
        version: '0.3.0',
        files: {
          arm64: { path, sha256: SHA, size: 1 },
          x64: { path: 'ok.zip', sha256: SHA, size: 1 }
        }
      })
      expect(parseUpdateManifest(text, '0.3.0').ok, path).toBe(false)
    }
  })

  it('sha256 / size 非法 → 拒绝', () => {
    for (const bad of [{ sha256: 'xyz', size: 1 }, { sha256: SHA, size: 0 }, { sha256: SHA, size: -1 }]) {
      const text = JSON.stringify({
        version: '0.3.0',
        files: {
          arm64: { path: 'a.zip', ...bad },
          x64: { path: 'b.zip', sha256: SHA, size: 1 }
        }
      })
      expect(parseUpdateManifest(text, '0.3.0').ok).toBe(false)
    }
  })

  it('非 JSON → 有意义的错误,不抛', () => {
    expect(parseUpdateManifest('<html>404</html>', '0.3.0')).toMatchObject({
      ok: false,
      error: expect.stringContaining('JSON')
    })
  })
})

describe('cdn 地址', () => {
  it('清单与产物都挂在 cdn 根下(可用 LAUNCHER_R2_BASE 覆盖)', () => {
    const env = { LAUNCHER_R2_BASE: 'https://mirror.test/launcher/' }
    expect(manifestUrl('0.3.0', env)).toBe('https://mirror.test/launcher/Launcher-0.3.0.json')
    expect(artifactUrl('Launcher-0.3.0-arm64.zip', env)).toBe(
      'https://mirror.test/launcher/Launcher-0.3.0-arm64.zip'
    )
  })
})

describe('fetchUpdateManifest', () => {
  const serving = (body: string, status = 200): typeof fetch =>
    (async () => new Response(body, { status })) as unknown as typeof fetch

  it('拉取并解析', async () => {
    const r = await fetchUpdateManifest('0.3.0', {
      fetchImpl: serving(manifest()),
      env: { LAUNCHER_R2_BASE: 'https://cdn.test' }
    })
    expect(r.ok).toBe(true)
  })

  it('404 / 网络错误 → 失败但不抛', async () => {
    expect(await fetchUpdateManifest('0.3.0', { fetchImpl: serving('', 404) })).toMatchObject({
      ok: false,
      error: expect.stringContaining('不存在')
    })
    const throwing = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    expect(await fetchUpdateManifest('0.3.0', { fetchImpl: throwing })).toMatchObject({
      ok: false,
      error: 'offline'
    })
  })

  it('超时 → 明确报超时', async () => {
    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    const r = await fetchUpdateManifest('0.3.0', {
      fetchImpl: hanging as unknown as typeof fetch,
      timeoutMs: 20
    })
    expect(r).toMatchObject({ ok: false, error: '清单请求超时' })
  })
})
