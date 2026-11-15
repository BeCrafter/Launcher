// 离线资源包:下载校验、只解 webapp 静态资源、失败/取消不留半个包。
//
// 真实包 50MB 不在这里造:用 JSZip 现做一个同结构的 war 作为注入的下载源,
// 摘要经 deps 注入 —— 生产路径的常量仍由 shared/drawio 固定。

import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { DRAWIO_PACK_DIR, DRAWIO_PACK_VERSION } from '../../shared/drawio'
import { createDrawioPack, drawioVersionDir, type DrawioFetch } from './drawio-pack'

let dirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-drawio-pack-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function buildWar(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, body] of Object.entries(entries)) zip.file(name, body)
  return zip.generateAsync({ type: 'nodebuffer' })
}

const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

const WEBAPP = {
  'webapp/index.html': '<html><script src="js/app.min.js"></script></html>',
  'webapp/js/app.min.js': 'var a = 1',
  'webapp/styles/grapheditor.css': 'a{}',
  'WEB-INF/web.xml': '<web-app/>',
  'webapp/WEB-INF/web.xml': '<web-app/>',
  'webapp/META-INF/MANIFEST.MF': 'Manifest-Version: 1.0',
  'webapp/servlet/DrawServlet.java': 'class X {}',
  'webapp/servlet/DrawServlet.class': Buffer.from([0xca, 0xfe]),
  'webapp/index.jsp': '<% %>',
  'LICENSE': 'Apache License 2.0',
  'NOTICE': 'draw.io'
}

function mockFetch(bytes: Buffer, onRequest?: (url: string) => void): DrawioFetch {
  return async (url) => {
    onRequest?.(url)
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { 'content-length': String(bytes.byteLength) }
    })
  }
}

describe('status', () => {
  it('没装过 → installed false,版本取固定值', async () => {
    const dir = makeDir()
    const pack = createDrawioPack({ userDataDir: dir })
    expect(await pack.status()).toEqual({
      installed: false,
      version: DRAWIO_PACK_VERSION,
      stub: false,
      downloading: false
    })
  })

  it('stub 模式视作已装(E2E 不下载真实包)', async () => {
    const pack = createDrawioPack({ userDataDir: makeDir(), stub: true })
    expect(await pack.status()).toMatchObject({ installed: true, stub: true })
  })

  it('只有 marker 没有 index.html 不算装好', async () => {
    const dir = makeDir()
    const versionDir = drawioVersionDir(dir)
    const { mkdirSync } = await import('node:fs')
    mkdirSync(versionDir, { recursive: true })
    writeFileSync(
      join(versionDir, '.ready.json'),
      JSON.stringify({ version: DRAWIO_PACK_VERSION, sha256: 'x', bytes: 1, source: 'manual' })
    )
    const pack = createDrawioPack({ userDataDir: dir })
    expect((await pack.status()).installed).toBe(false)
  })
})

describe('download', () => {
  it('校验通过后只落 webapp 静态资源,写 marker', async () => {
    const dir = makeDir()
    const bytes = await buildWar(WEBAPP)
    let requested = ''
    const pack = createDrawioPack({
      userDataDir: dir,
      packUrls: ['https://example.test/draw.war'],
      expectedSha256: sha(bytes),
      fetchImpl: mockFetch(bytes, (url) => {
        requested = url
      })
    })

    const phases: string[] = []
    const status = await pack.download((p) => phases.push(p.phase))

    expect(requested).toBe('https://example.test/draw.war')
    expect(status.installed).toBe(true)
    expect(phases).toContain('verify')
    expect(phases).toContain('extract')

    const versionDir = drawioVersionDir(dir)
    expect(readFileSync(join(versionDir, 'index.html'), 'utf8')).toContain('app.min.js')
    expect(readFileSync(join(versionDir, 'js/app.min.js'), 'utf8')).toBe('var a = 1')
    expect(readFileSync(join(versionDir, 'LICENSE'), 'utf8')).toBe('Apache License 2.0')
    expect(existsSync(join(versionDir, 'WEB-INF'))).toBe(false)
    expect(existsSync(join(versionDir, 'META-INF'))).toBe(false)
    expect(existsSync(join(versionDir, 'servlet/DrawServlet.java'))).toBe(false)
    expect(existsSync(join(versionDir, 'servlet/DrawServlet.class'))).toBe(false)
    expect(existsSync(join(versionDir, 'index.jsp'))).toBe(false)

    const marker = JSON.parse(readFileSync(join(versionDir, '.ready.json'), 'utf8'))
    expect(marker).toMatchObject({
      version: DRAWIO_PACK_VERSION,
      sha256: sha(bytes),
      bytes: bytes.byteLength,
      source: 'download'
    })
    // 临时文件/目录都清干净了
    const leftovers = readdirSync(join(dir, 'drawio')).filter((name) => name !== DRAWIO_PACK_DIR)
    expect(leftovers).toEqual([])
  })

  it('摘要不符 → 报错且不留下版本目录', async () => {
    const dir = makeDir()
    const bytes = await buildWar(WEBAPP)
    const pack = createDrawioPack({
      userDataDir: dir,
      packUrls: ['https://example.test/draw.war'],
      expectedSha256: 'deadbeef',
      fetchImpl: mockFetch(bytes)
    })
    await expect(pack.download()).rejects.toThrow(/校验失败/)
    expect(existsSync(drawioVersionDir(dir))).toBe(false)
    expect((await pack.status()).installed).toBe(false)
    const root = join(dir, 'drawio')
    if (existsSync(root)) expect(readdirSync(root)).toEqual([])
  })

  it('HTTP 失败与缺正文都报错,不留临时文件', async () => {
    const dir = makeDir()
    const bad = createDrawioPack({
      userDataDir: dir,
      packUrls: ['https://example.test/bad.war'],
      fetchImpl: async () => new Response('nope', { status: 404 })
    })
    await expect(bad.download()).rejects.toThrow(/HTTP 404/)

    const noBody = createDrawioPack({
      userDataDir: dir,
      packUrls: ['https://example.test/empty.war'],
      fetchImpl: async () => new Response(null, { status: 200 })
    })
    await expect(noBody.download()).rejects.toThrow(/没有正文/)
    const root = join(dir, 'drawio')
    if (existsSync(root)) expect(readdirSync(root)).toEqual([])
  })

  it('已有的包装好后再下载直接返回,不再发请求', async () => {
    const dir = makeDir()
    const bytes = await buildWar(WEBAPP)
    const pack = createDrawioPack({
      userDataDir: dir,
      packUrls: ['https://example.test/draw.war'],
      expectedSha256: sha(bytes),
      fetchImpl: mockFetch(bytes)
    })
    await pack.download()
    let calls = 0
    const again = createDrawioPack({
      userDataDir: dir,
      fetchImpl: async () => {
        calls += 1
        return new Response('x')
      }
    })
    expect((await again.download()).installed).toBe(true)
    expect(calls).toBe(0)
  })

  it('取消后按中止处理,不落盘', async () => {
    const dir = makeDir()
    const bytes = await buildWar(WEBAPP)
    const pack = createDrawioPack({
      userDataDir: dir,
      packUrls: ['https://example.test/draw.war'],
      expectedSha256: sha(bytes),
      fetchImpl: mockFetch(bytes)
    })
    const run = pack.download((p) => {
      if (p.received > 0) pack.cancel()
    })
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(existsSync(drawioVersionDir(dir))).toBe(false)
    const root = join(dir, 'drawio')
    if (existsSync(root)) expect(readdirSync(root)).toEqual([])
  })

  it('下载源连不上 → 自动换下一个镜像', async () => {
    const dir = makeDir()
    const bytes = await buildWar(WEBAPP)
    const seen: string[] = []
    const pack = createDrawioPack({
      userDataDir: dir,
      packUrls: ['https://mirror-a.test/draw.war', 'https://mirror-b.test/draw.war'],
      expectedSha256: sha(bytes),
      fetchImpl: async (url) => {
        seen.push(url)
        if (url.includes('mirror-a')) throw new Error('connect ECONNREFUSED')
        return new Response(new Uint8Array(bytes), {
          status: 200,
          headers: { 'content-length': String(bytes.byteLength) }
        })
      }
    })

    const status = await pack.download()
    expect(status.installed).toBe(true)
    expect(seen).toEqual(['https://mirror-a.test/draw.war', 'https://mirror-b.test/draw.war'])
  })

  it('某个镜像返回被篡改的内容(摘要不符)也换下一个源', async () => {
    const dir = makeDir()
    const bytes = await buildWar(WEBAPP)
    const tampered = await buildWar({ ...WEBAPP, 'webapp/js/app.min.js': 'evil()' })
    const pack = createDrawioPack({
      userDataDir: dir,
      packUrls: ['https://mirror-a.test/draw.war', 'https://mirror-b.test/draw.war'],
      expectedSha256: sha(bytes),
      fetchImpl: async (url) => {
        const body = url.includes('mirror-a') ? tampered : bytes
        return new Response(new Uint8Array(body), { status: 200 })
      }
    })

    const status = await pack.download()
    expect(status.installed).toBe(true)
    const versionDir = drawioVersionDir(dir)
    expect(readFileSync(join(versionDir, 'js/app.min.js'), 'utf8')).toBe('var a = 1')
    expect(readFileSync(join(versionDir, '.ready.json'), 'utf8')).toContain(sha(bytes))
  })

  it('所有源都失败 → 报最后一个错误,不留版本目录', async () => {
    const dir = makeDir()
    const pack = createDrawioPack({
      userDataDir: dir,
      packUrls: ['https://a.test/draw.war', 'https://b.test/draw.war'],
      fetchImpl: async (url) =>
        new Response('x', { status: url.includes('a.test') ? 502 : 503 })
    })
    await expect(pack.download()).rejects.toThrow(/HTTP 503/)
    expect(existsSync(drawioVersionDir(dir))).toBe(false)
  })
})

describe('importWar', () => {
  it('手动导入同样过滤服务端代码,记录实际摘要', async () => {
    const dir = makeDir()
    const warPath = join(makeDir(), 'draw.war')
    const bytes = await buildWar(WEBAPP)
    writeFileSync(warPath, bytes)

    const pack = createDrawioPack({ userDataDir: dir })
    const status = await pack.importWar(warPath)
    expect(status.installed).toBe(true)

    const versionDir = drawioVersionDir(dir)
    expect(existsSync(join(versionDir, 'js/app.min.js'))).toBe(true)
    expect(existsSync(join(versionDir, 'WEB-INF'))).toBe(false)
    const marker = JSON.parse(readFileSync(join(versionDir, '.ready.json'), 'utf8'))
    expect(marker).toMatchObject({ source: 'manual', sha256: sha(bytes), bytes: bytes.byteLength })
  })

  it('包里的路径穿越条目不会写到版本目录外', async () => {
    const dir = makeDir()
    const warPath = join(makeDir(), 'evil.war')
    writeFileSync(
      warPath,
      await buildWar({
        'webapp/index.html': '<html>ok</html>',
        'webapp/../escaped.txt': 'escaped',
        'webapp/a/../../escaped2.txt': 'escaped'
      })
    )

    const pack = createDrawioPack({ userDataDir: dir })
    await pack.importWar(warPath)

    expect(existsSync(join(dir, 'drawio', 'escaped.txt'))).toBe(false)
    expect(existsSync(join(dir, 'drawio', DRAWIO_PACK_DIR, 'escaped.txt'))).toBe(false)
    expect(existsSync(join(dir, 'drawio', 'escaped2.txt'))).toBe(false)
    expect(existsSync(join(dir, 'escaped.txt'))).toBe(false)
    expect(existsSync(join(dir, 'drawio', DRAWIO_PACK_DIR, 'index.html'))).toBe(true)
  })

  it('没有 index.html → 报错,不留版本目录', async () => {
    const dir = makeDir()
    const warPath = join(makeDir(), 'empty.war')
    writeFileSync(warPath, await buildWar({ 'WEB-INF/web.xml': '<x/>', 'readme.txt': 'x' }))
    const pack = createDrawioPack({ userDataDir: dir })
    await expect(pack.importWar(warPath)).rejects.toThrow(/index\.html/)
    expect(existsSync(drawioVersionDir(dir))).toBe(false)
  })

  it('GitHub release 的 war 布局(静态资源在根,不带 webapp/ 前缀)也能装', async () => {
    const dir = makeDir()
    const warPath = join(makeDir(), 'release.war')
    // 真实 draw.war:index.html / js/ 与 WEB-INF/ 同级
    writeFileSync(
      warPath,
      await buildWar({
        'index.html': '<html><script src="js/app.min.js"></script></html>',
        'js/app.min.js': 'var a = 1',
        'styles/grapheditor.css': 'a{}',
        'WEB-INF/web.xml': '<web-app/>',
        'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0',
        'DrawServlet.java': 'class X {}'
      })
    )

    const pack = createDrawioPack({ userDataDir: dir })
    await pack.importWar(warPath)

    const versionDir = drawioVersionDir(dir)
    expect(readFileSync(join(versionDir, 'index.html'), 'utf8')).toContain('app.min.js')
    expect(existsSync(join(versionDir, 'js/app.min.js'))).toBe(true)
    expect(existsSync(join(versionDir, 'WEB-INF'))).toBe(false)
    expect(existsSync(join(versionDir, 'META-INF'))).toBe(false)
    expect(existsSync(join(versionDir, 'DrawServlet.java'))).toBe(false)
  })

  it('不是文件 → 报错', async () => {
    const pack = createDrawioPack({ userDataDir: makeDir() })
    await expect(pack.importWar(makeDir())).rejects.toThrow(/不是 \.war 文件/)
  })
})
