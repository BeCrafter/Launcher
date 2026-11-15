// launcher-drawio:// 的三道闸:只认 app 主机 + 当前版本段、解析后仍在版本目录内、
// 没装包不假装装好。E2E stub 只在开关打开时存在,生产方式不受影响。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DRAWIO_PACK_DIR, DRAWIO_SCHEME, DRAWIO_STUB_HTML } from '../../shared/drawio'
import { drawioVersionDir } from './drawio-pack'
import { createDrawioHandler } from './drawio-protocol'

let dir = ''

function makeHandler(stub = false): (url: string) => Promise<Response> {
  dir = mkdtempSync(join(tmpdir(), 'launcher-drawio-protocol-'))
  return createDrawioHandler({ userDataDir: dir, stub })
}

function install(files: Record<string, string | Buffer>): void {
  const root = drawioVersionDir(dir)
  for (const [name, body] of Object.entries(files)) {
    const target = join(root, name)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, body)
  }
}

const appUrl = (path: string): string => `${DRAWIO_SCHEME}://app/${DRAWIO_PACK_DIR}/${path}`

afterEach(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true })
  dir = ''
})

describe('未安装', () => {
  it('版本目录里没有文件 → 404,不编造内容', async () => {
    const handler = makeHandler()
    const res = await handler(appUrl('index.html'))
    expect(res.status).toBe(404)
  })

  it('别的版本段一律 404', async () => {
    const handler = makeHandler()
    install({ 'index.html': '<html>v</html>' })
    expect((await handler(`${DRAWIO_SCHEME}://app/v0.0.1/index.html`)).status).toBe(404)
    expect((await handler(`${DRAWIO_SCHEME}://app/index.html`)).status).toBe(404)
  })

  it('别的 host 不服务', async () => {
    const handler = makeHandler()
    install({ 'index.html': '<html>v</html>' })
    expect((await handler(`${DRAWIO_SCHEME}://evil/${DRAWIO_PACK_DIR}/index.html`)).status).toBe(404)
  })
})

describe('路径', () => {
  it('正常资源按目录取', async () => {
    const handler = makeHandler()
    install({ 'index.html': '<html>ok</html>', 'js/app.min.js': 'var a = 1' })
    const index = await handler(appUrl('index.html'))
    expect(index.status).toBe(200)
    expect(await index.text()).toBe('<html>ok</html>')
    expect(await (await handler(appUrl('js/app.min.js'))).text()).toBe('var a = 1')
  })

  it('路径穿越拒绝,不读到版本目录外', async () => {
    const handler = makeHandler()
    install({ 'index.html': '<html>v</html>' })
    writeFileSync(join(dir, 'secret.txt'), 'secret')
    for (const evil of [
      `${DRAWIO_SCHEME}://app/${DRAWIO_PACK_DIR}/../secret.txt`,
      `${DRAWIO_SCHEME}://app/${DRAWIO_PACK_DIR}/%2e%2e/secret.txt`,
      `${DRAWIO_SCHEME}://app/${DRAWIO_PACK_DIR}/js/../../secret.txt`
    ]) {
      const res = await handler(evil)
      expect([403, 404]).toContain(res.status)
      if (res.status === 200) throw new Error(`越界读到内容:${evil}`)
    }
  })

  it('非法 URL 与非法百分号编码不抛异常', async () => {
    const handler = makeHandler()
    await expect(handler('not a url')).resolves.toMatchObject({ status: 403 })
    await expect(handler(`${DRAWIO_SCHEME}://app/${DRAWIO_PACK_DIR}/%ZZ.js`)).resolves.toMatchObject({
      status: 403
    })
  })
})

describe('响应头', () => {
  it('按扩展名给 MIME,并禁止嗅探', async () => {
    const handler = makeHandler()
    install({
      'index.html': '<html></html>',
      'js/app.min.js': 'var a = 1',
      'styles/grapheditor.css': 'a{}',
      'img/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      'notices.txt': 'notice'
    })
    const cases: Array<[string, string]> = [
      ['index.html', 'text/html'],
      ['js/app.min.js', 'javascript'],
      ['styles/grapheditor.css', 'text/css'],
      ['img/logo.png', 'image/png'],
      ['notices.txt', 'text/plain']
    ]
    for (const [path, mime] of cases) {
      const res = await handler(appUrl(path))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain(mime)
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('cache-control')).toContain('immutable')
    }
  })

  it('HTML 带能跑 draw.io 的 CSP,且不锁 frame-ancestors', async () => {
    const handler = makeHandler()
    install({ 'index.html': '<html></html>' })
    const csp = (await handler(appUrl('index.html'))).headers.get('content-security-policy') ?? ''
    expect(csp).toContain("'unsafe-eval'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).not.toContain('frame-ancestors')
    expect((await handler(appUrl('index.html'))).headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('E2E stub', () => {
  it('开关打开时 stub 页可用', async () => {
    const handler = makeHandler(true)
    const res = await handler(`${DRAWIO_SCHEME}://stub/index.html`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(DRAWIO_STUB_HTML)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('没装真实包时 index.html 由 stub 顶上,其他资源仍是 404', async () => {
    const handler = makeHandler(true)
    const index = await handler(appUrl('index.html'))
    expect(index.status).toBe(200)
    expect(await index.text()).toBe(DRAWIO_STUB_HTML)
    expect((await handler(appUrl('js/app.min.js'))).status).toBe(404)
  })

  it('装了真实包时优先真实 index.html', async () => {
    const handler = makeHandler(true)
    install({ 'index.html': '<html>real</html>' })
    expect(await (await handler(appUrl('index.html'))).text()).toBe('<html>real</html>')
  })

  it('开关关闭时 stub 主机不可达(生产如此)', async () => {
    const handler = makeHandler(false)
    expect((await handler(`${DRAWIO_SCHEME}://stub/index.html`)).status).toBe(404)
  })
})
