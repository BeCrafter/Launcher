import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { gzip } from 'pako'
import { archiveHtmlSrcdoc, openArchive } from './archive'

const enc = new TextEncoder()

function tarHeader(name: string, size: number, type = '0'): Uint8Array {
  const header = new Uint8Array(512)
  header.set(enc.encode(name).subarray(0, 100), 0)
  // size: 11 位八进制 + NUL
  header.set(enc.encode(size.toString(8).padStart(11, '0') + '\0'), 124)
  header[156] = type.charCodeAt(0)
  header.set(enc.encode('ustar'), 257)
  return header
}

function makeTar(files: { name: string; body: string }[]): Uint8Array {
  const chunks: Uint8Array[] = []
  for (const f of files) {
    const body = enc.encode(f.body)
    chunks.push(tarHeader(f.name, body.length))
    chunks.push(body)
    const pad = (512 - (body.length % 512)) % 512
    if (pad > 0) chunks.push(new Uint8Array(pad))
  }
  chunks.push(new Uint8Array(1024))
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

describe('openArchive:ZIP', () => {
  it('列出条目并读取内容', async () => {
    const zip = new JSZip()
    zip.file('a.txt', 'hello')
    zip.file('dir/b.js', 'const b = 2')
    zip.folder('dir')
    const data = await zip.generateAsync({ type: 'uint8array' })
    const src = await openArchive('x.zip', data)
    expect(src.entries.map((e) => e.path)).toEqual(expect.arrayContaining(['a.txt', 'dir', 'dir/b.js']))
    const bytes = await src.read('a.txt')
    expect(new TextDecoder().decode(bytes)).toBe('hello')
  })

  it('损坏的 ZIP 抛错', async () => {
    await expect(openArchive('bad.zip', enc.encode('not a zip'))).rejects.toBeTruthy()
  })
})

describe('openArchive:TAR / TAR.GZ / GZ', () => {
  it('TAR 普通文件与目录', async () => {
    const tar = makeTar([
      { name: 'dir/', body: '' },
      { name: 'dir/a.txt', body: 'tar text' }
    ])
    const src = await openArchive('x.tar', tar)
    expect(src.kind).toBe('tar')
    expect(src.entries.find((e) => e.path === 'dir')?.dir).toBe(true)
    expect(new TextDecoder().decode(await src.read('dir/a.txt'))).toBe('tar text')
  })

  it('拒绝含 .. 的条目', async () => {
    const tar = makeTar([{ name: '../evil.txt', body: 'x' }])
    const src = await openArchive('x.tar', tar)
    expect(src.unsafeSkipped).toBe(1)
    expect(src.entries).toEqual([])
  })

  it('TAR.GZ 解压后按 TAR 解析', async () => {
    const src = await openArchive('x.tgz', gzip(makeTar([{ name: 'a.txt', body: 'gz' }])))
    expect(src.kind).toBe('gzip')
    expect(new TextDecoder().decode(await src.read('a.txt'))).toBe('gz')
  })

  it('单文件 GZ 用去掉 .gz 的名字', async () => {
    const src = await openArchive('note.txt.gz', gzip(enc.encode('plain')))
    expect(src.entries).toEqual([{ path: 'note.txt', name: 'note.txt', dir: false, size: 5 }])
    expect(new TextDecoder().decode(await src.read('note.txt'))).toBe('plain')
  })
})

describe('archiveHtmlSrcdoc', () => {
  it('内联同包 CSS / JS / 图片,并注入 CSP', async () => {
    const zip = new JSZip()
    zip.file('site/index.html', '<link rel="stylesheet" href="style.css"><script src="app.js"></script><img src="pic.png">')
    zip.file('site/style.css', 'body{color:red;background:url(pic.png)}')
    zip.file('site/app.js', 'document.title = "hi"')
    zip.file('site/pic.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    const data = await zip.generateAsync({ type: 'uint8array' })
    const src = await openArchive('site.zip', data)
    const html = await archiveHtmlSrcdoc('site/index.html', await src.read('site/index.html'), src)

    expect(html.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true)
    expect(html).toContain('<style>body{color:red')
    expect(html).toContain('<script>document.title')
    expect(html).toContain('data:image/png;base64,')
    expect(html).not.toContain('src="pic.png"')
    expect(html).not.toContain('href="style.css"')
  })
})
