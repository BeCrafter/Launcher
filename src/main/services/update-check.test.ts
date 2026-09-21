import { describe, expect, it, vi } from 'vitest'
import { checkForUpdate, compareVersions, parseManifest } from './update-check'

const MANIFEST = '0.4.0-rc.1 pre\n0.3.0\n0.2.0\n0.1.0\n'

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
}

const serving = (text: string, status = 200): typeof fetch =>
  (async () => textResponse(text, status)) as unknown as typeof fetch

describe('compareVersions', () => {
  it('数字段比较与缺段补 0', () => {
    expect(compareVersions('2.0.0', '0.1.0')).toBe(1)
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('v1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.0', '1.2.1')).toBe(-1)
  })

  it('正式版 > 同号预发布', () => {
    expect(compareVersions('2.0.0-beta', '2.0.0')).toBe(-1)
    expect(compareVersions('2.0.0', '2.0.0-beta')).toBe(1)
  })

  // 这条是本次修的真 bug:旧实现用字符串比,rc.10 < rc.9(字典序),把较新的 rc 判成不更新
  it('预发布段按数值比,不是字典序(rc.10 > rc.9)', () => {
    expect(compareVersions('0.3.0-rc.10', '0.3.0-rc.9')).toBe(1)
    expect(compareVersions('0.3.0-rc.9', '0.3.0-rc.10')).toBe(-1)
    expect(compareVersions('0.3.0-rc', '0.3.0-rc.1')).toBe(-1) // 段数少的更小
    expect(compareVersions('0.3.0-rc.2', '0.3.0-rc.2')).toBe(0)
  })

  it('非数字段回退 0(不抛)', () => {
    expect(compareVersions('x.y.z', '0.0.0')).toBe(0)
  })
})

describe('parseManifest', () => {
  it('解析两列格式,分出稳定版与最新稳定版', () => {
    const r = parseManifest(MANIFEST)
    expect(r.all).toEqual(['0.4.0-rc.1', '0.3.0', '0.2.0', '0.1.0'])
    expect(r.stable).toEqual(['0.3.0', '0.2.0', '0.1.0'])
    expect(r.latestStable).toBe('0.3.0')
  })

  it('坏行一律丢掉(空行、缩进、混进来的 404 页面)', () => {
    const r = parseManifest('0.2.0\n\n   \n<!doctype html>\n0.1.0')
    expect(r.all).toEqual(['0.2.0', '0.1.0'])
  })

  it('没标 pre 但版本号自带后缀 → 仍算预发布', () => {
    const r = parseManifest('1.0.0-rc.2')
    expect(r.stable).toEqual([])
    expect(r.latestStable).toBeNull()
  })

  it('空文本 → 空清单,不崩', () => {
    expect(parseManifest('')).toMatchObject({ all: [], stable: [], latestStable: null })
  })
})

describe('checkForUpdate(读 cdn 清单)', () => {
  it('有新版本 → available,并带上该通道的升级命令', async () => {
    const r = await checkForUpdate('0.1.0', { fetchImpl: serving(MANIFEST), channel: 'brew' })
    expect(r.status).toBe('available')
    expect(r.latest?.version).toBe('0.3.0')
    expect(r.currentVersion).toBe('0.1.0')
    expect(r.upgradeCommand).toBe('brew upgrade --cask becrafter/brew/launcher')
  })

  it('已最新(含本地领先) → upToDate', async () => {
    expect((await checkForUpdate('0.3.0', { fetchImpl: serving(MANIFEST) })).status).toBe('upToDate')
    expect((await checkForUpdate('9.9.9', { fetchImpl: serving(MANIFEST) })).status).toBe('upToDate')
  })

  it('装了预发布 → 仍会被提示正式版(清单里最新稳定版更高)', async () => {
    const r = await checkForUpdate('0.3.0-rc.1', { fetchImpl: serving(MANIFEST) })
    expect(r.status).toBe('available')
    expect(r.latest).toEqual({ version: '0.3.0', stable: '0.3.0' })
  })

  it('清单里全是预发布 → 拿最高预发布比对,latest.stable 为 null', async () => {
    const r = await checkForUpdate('0.1.0', { fetchImpl: serving('0.4.0-rc.1 pre\n') })
    expect(r.status).toBe('available')
    expect(r.latest).toEqual({ version: '0.4.0-rc.1', stable: null })
  })

  it('清单在但没有版本 → noRelease(与「取不到」分态)', async () => {
    const r = await checkForUpdate('0.1.0', { fetchImpl: serving('') })
    expect(r.status).toBe('noRelease')
    expect(r.errorMessage).toBeNull()
  })

  it('404 → error 且原因点明清单不存在', async () => {
    const r = await checkForUpdate('0.1.0', { fetchImpl: serving('nope', 404) })
    expect(r.status).toBe('error')
    expect(r.errorMessage).toMatch(/清单不存在/)
  })

  it('5xx → error 带 http 码;抛错/超时 → error 且不抛', async () => {
    expect((await checkForUpdate('0.1.0', { fetchImpl: serving('boom', 500) })).errorMessage).toBe('HTTP 500')

    const throwing = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    expect((await checkForUpdate('0.1.0', { fetchImpl: throwing })).status).toBe('error')

    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    const r = await checkForUpdate('0.1.0', { fetchImpl: hanging as unknown as typeof fetch, timeoutMs: 20 })
    expect(r.status).toBe('error')
    expect(r.errorMessage).toBe('请求超时')
  })

  it('没探测到来源时给 manual 那条命令(不猜)', async () => {
    const r = await checkForUpdate('0.1.0', { fetchImpl: serving(MANIFEST) })
    expect(r.upgradeCommand).toContain('install.sh')
  })
})
