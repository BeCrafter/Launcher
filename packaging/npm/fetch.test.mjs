// 取数层的测试：真的发 HTTP 请求，但只打本地夹具服务器 —— 不依赖公网，CI 里也能跑。
//
// 为什么值得单独测：这两条路径把「网络失败」「清单不存在」「清单存在但没有版本」分成不同状态，
// 分错了用户会拿到误导性的提示（例如尚未发版却说「网络不可达」）。
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fetchLatestVersion, fetchReleases } from './lib.mjs'

/** CI 生成的那份清单的样子 */
const MANIFEST = ['0.4.0-rc.1 pre', '0.3.0', '0.2.0', '', '0.1.0'].join('\n') + '\n'

let server
let base
/** 让所有请求卡住不响应，用来触发客户端超时 */
let hang = false

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname
    res.setHeader('connection', 'close')
    if (hang) return
    switch (path) {
      case '/cdn/versions.txt':
        res.writeHead(200, { 'content-type': 'text/plain' })
        return res.end(MANIFEST)
      case '/empty/versions.txt':
        res.writeHead(200, { 'content-type': 'text/plain' })
        return res.end('')
      case '/missing/versions.txt':
        res.writeHead(404)
        return res.end('no such key')
      case '/broken/versions.txt':
        res.writeHead(500)
        return res.end('boom')
      // 别名 → 带版本号的产物名。相对 Location 也顺带覆盖（curl 与 fetch 都会解析它）
      case '/cdn/Launcher-latest-arm64.zip':
        res.writeHead(302, { location: '/cdn/Launcher-0.3.0-arm64.zip' })
        return res.end()
      case '/cdn/Launcher-0.3.0-arm64.zip':
        res.writeHead(200, { 'content-type': 'application/zip' })
        return res.end()
      case '/no-redirect.zip':
        res.writeHead(200, { 'content-type': 'application/zip' })
        return res.end()
      default:
        res.writeHead(404)
        return res.end('nope')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(() => server?.close())

describe('fetchReleases（读 cdn 上的 versions.txt）', () => {
  it('解析清单并算出最新稳定版', async () => {
    const r = await fetchReleases(`${base}/cdn`)
    expect(r.ok).toBe(true)
    expect(r.all.map((x) => x.version)).toEqual(['0.4.0-rc.1', '0.3.0', '0.2.0', '0.1.0'])
    expect(r.stable.map((x) => x.version)).toEqual(['0.3.0', '0.2.0', '0.1.0'])
    expect(r.latestStable).toBe('0.3.0')
    expect(r.url).toBe(`${base}/cdn/versions.txt`)
  })

  it('cdn 根末尾带斜杠也能拼对（用户可能带）', async () => {
    const r = await fetchReleases(`${base}/cdn/`)
    expect(r.ok).toBe(true)
    expect(r.url).toBe(`${base}/cdn/versions.txt`)
  })

  it('清单存在但没有版本 → 空列表，不是错误', async () => {
    const r = await fetchReleases(`${base}/empty`)
    expect(r.ok).toBe(true)
    expect(r.all).toEqual([])
    expect(r.latestStable).toBeNull()
  })

  it('404（清单还没建起来）与网络故障分态', async () => {
    const r = await fetchReleases(`${base}/missing`)
    expect(r).toMatchObject({ ok: false, error: 'HTTP 404' })
    expect(r.url).toContain('/missing/versions.txt')
  })

  it('其它 http 码原样上报，不谎报成「没有版本」', async () => {
    expect(await fetchReleases(`${base}/broken`)).toMatchObject({ ok: false, error: 'HTTP 500' })
  })

  it('超时收敛成 ok:false，不抛', async () => {
    hang = true
    try {
      const r = await fetchReleases(`${base}/cdn`, 120)
      expect(r).toMatchObject({ ok: false, error: '超时' })
    } finally {
      hang = false
    }
  })

  it('连不上时收敛成 ok:false，不抛', async () => {
    const r = await fetchReleases('http://127.0.0.1:1/cdn', 500)
    expect(r.ok).toBe(false)
  })
})

describe('fetchLatestVersion（问 latest 别名指向哪个版本）', () => {
  it('跟随重定向后从最终 URL 反解出版本号', async () => {
    const r = await fetchLatestVersion(`${base}/cdn/Launcher-latest-arm64.zip`)
    expect(r).toEqual({ ok: true, version: '0.3.0' })
  })

  it('没有重定向（对象未上传）→ 判不出，不瞎猜', async () => {
    const r = await fetchLatestVersion(`${base}/no-redirect.zip`)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/未暴露版本号/)
  })

  it('别名不存在 → HTTP 码如实上报（调用方据此提示「可能尚未发布」）', async () => {
    const r = await fetchLatestVersion(`${base}/cdn/Launcher-latest-x64.zip`)
    expect(r).toMatchObject({ ok: false, error: 'HTTP 404' })
  })

  it('超时收敛成 ok:false', async () => {
    hang = true
    try {
      const r = await fetchLatestVersion(`${base}/cdn/Launcher-latest-arm64.zip`, 120)
      expect(r).toMatchObject({ ok: false, error: '超时' })
    } finally {
      hang = false
    }
  })
})
