// 附件协议的三道闸:只服务 assets/、只放行白名单扩展名、解析后仍在目录内。
// 这是「读到笔记目录之外」的唯一入口,所以路径用例要写全。
//
// 白名单从「只有图片」扩到了视频 / 音频 / PDF / 本地网页 —— 每加一类都要在这里点名,
// 尤其是**必须继续拒绝**的那几类(svg、js、md…)。

import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileHeadersFor, parseRange, resolveAssetPath, resolveExternalPath, resolveFilePath } from './notes-protocol'

const DIR = '/Users/tester/.config/launcher/notes'

const url = (p: string): string => `launcher-note://asset/${p}`
const pathOf = (p: string): string | null => resolveAssetPath(DIR, url(p))?.path ?? null
const kindOf = (p: string): string | null => resolveAssetPath(DIR, url(p))?.kind ?? null

describe('resolveAssetPath:路径', () => {
  it('正常相对路径解析到目录内', () => {
    expect(pathOf('assets/a.png')).toBe(`${DIR}/assets/a.png`)
    expect(pathOf('assets/Pasted%20image%201.png')).toBe(`${DIR}/assets/Pasted image 1.png`)
  })

  it('中文文件名', () => {
    expect(pathOf('assets/截图.png')).toBe(`${DIR}/assets/截图.png`)
  })

  it('只服务 assets/ 下的文件', () => {
    expect(pathOf('secret.png')).toBeNull()
    expect(pathOf('notes.md')).toBeNull()
    expect(pathOf('.trash/old.png')).toBeNull()
  })

  it('路径穿越一律拒绝', () => {
    for (const evil of [
      'assets/../../etc/passwd.png',
      'assets/..%2f..%2fetc/passwd.png',
      'assets/%2e%2e/%2e%2e/etc/secret.png',
      'assets/sub/../../../outside.png',
      'assets//etc/hosts.png'
    ]) {
      const out = resolveAssetPath(DIR, url(evil))
      expect(out === null || out.path.startsWith(`${DIR}/assets/`)).toBe(true)
    }
  })

  it('穿越到目录外必须为 null(逐个点名,不靠上面的宽松断言)', () => {
    expect(pathOf('assets/../../etc/passwd.png')).toBeNull()
    expect(pathOf('assets/%2e%2e/%2e%2e/etc/secret.png')).toBeNull()
  })

  it('host 不是 asset 一律拒绝', () => {
    expect(resolveAssetPath(DIR, 'launcher-note://evil/assets/a.png')).toBeNull()
    expect(resolveAssetPath(DIR, 'launcher-note://assets/a.png')).toBeNull()
  })

  it('非法输入不抛异常,一律 null', () => {
    for (const bad of ['', 'not a url', 'launcher-note://asset/', 'launcher-note://asset/assets/%ZZ.png']) {
      expect(() => resolveAssetPath(DIR, bad)).not.toThrow()
      expect(resolveAssetPath(DIR, bad)).toBeNull()
    }
  })

  it('目录本身带符号链接式写法也归一化后再判', () => {
    // resolve() 会消掉 `.` 与重复斜杠,所以这些写法不会绕过前缀断言
    expect(pathOf('assets/./x.png')).toBe('/Users/tester/.config/launcher/notes/assets/x.png')
    expect(resolveAssetPath('/a/./b', url('assets/./x.png'))?.path).toBe('/a/b/assets/x.png')
  })
})

describe('resolveAssetPath:扩展名白名单', () => {
  it('图片', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp']) {
      expect(kindOf(`assets/x.${ext}`)).toBe('image')
    }
  })

  it('视频 / 音频 / PDF / 本地网页', () => {
    for (const ext of ['mp4', 'webm', 'mov', 'm4v', 'ogv']) expect(kindOf(`assets/x.${ext}`)).toBe('video')
    for (const ext of ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac']) expect(kindOf(`assets/x.${ext}`)).toBe('audio')
    expect(kindOf('assets/x.pdf')).toBe('pdf')
    expect(kindOf('assets/x.html')).toBe('page')
    expect(kindOf('assets/x.htm')).toBe('page')
  })

  it('大小写不敏感', () => {
    expect(kindOf('assets/x.PNG')).toBe('image')
    expect(kindOf('assets/x.MP4')).toBe('video')
  })

  it.each(['html5', 'md', 'js', 'json', 'x', 'txt', 'yml'])('%s 不在白名单里', (ext) => {
    expect(resolveAssetPath(DIR, url(`assets/x.${ext}`))).toBeNull()
  })

  it('svg 仍然拒绝 —— 作为文档打开时是 XSS 向量', () => {
    expect(resolveAssetPath(DIR, url('assets/x.svg'))).toBeNull()
    expect(resolveAssetPath(DIR, url('assets/x.SVG'))).toBeNull()
  })
})

describe('parseRange', () => {
  it('没有 Range 头 → null(调用方回 200 整份)', () => {
    expect(parseRange(null, 1000)).toBeNull()
    expect(parseRange('', 1000)).toBeNull()
  })

  it('bytes=0-499', () => {
    expect(parseRange('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 })
  })

  it('bytes=500- → 到文件尾', () => {
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
  })

  it('bytes=-200 → 最后 200 字节', () => {
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 })
  })

  it('end 超出文件大小会被夹到末尾', () => {
    expect(parseRange('bytes=900-99999', 1000)).toEqual({ start: 900, end: 999 })
  })

  it.each(['bytes=abc', 'bytes=', 'items=0-1', 'bytes=1000-', 'bytes=2000-3000', 'bytes=500-100'])(
    '非法区间 %s → null(回整份,而不是 416)',
    (h) => {
      expect(parseRange(h, 1000)).toBeNull()
    }
  )

  it('不支持多区间(播放器不会发),返回 null', () => {
    expect(parseRange('bytes=0-99,200-299', 1000)).toBeNull()
  })

  it('单字节文件', () => {
    expect(parseRange('bytes=0-0', 1)).toEqual({ start: 0, end: 0 })
  })
})

describe('launcher-note://file/ host', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  function makeDir(): string {
    const d = mkdtempSync(join(tmpdir(), 'launcher-proto-file-'))
    roots.push(d)
    return d
  }
  const fileUrl = (p: string): string => `launcher-note://file/${p}`

  it('解析目录内文件,允许根层 assets/,忽略查询串', () => {
    const dir = makeDir()
    mkdirSync(join(dir, 'assets'), { recursive: true })
    writeFileSync(join(dir, 'assets', 'logo.png'), 'x')
    mkdirSync(join(dir, 'site'), { recursive: true })
    writeFileSync(join(dir, 'site', 'index.html'), '<h1>x</h1>')

    expect(resolveFilePath(dir, fileUrl('assets/logo.png'))).toBe(join(dir, 'assets', 'logo.png'))
    expect(resolveFilePath(dir, `${fileUrl('site/index.html')}?v=3`)).toBe(join(dir, 'site', 'index.html'))
    // 查询串里的穿越不能参与解析
    expect(resolveFilePath(dir, `${fileUrl('site/index.html')}?x=../../etc`)).toBe(
      join(dir, 'site', 'index.html')
    )
  })

  it('拒绝越界、asset host、绝对路径与目录', () => {
    const dir = makeDir()
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'a.txt'), 'a')
    // URL 解析本身会把 `..` 夹在 host 根,拿不到目录外;剩下 decode 出来的
    // `%2f` 变成相对段,最终仍走同一条包含性检查
    expect(resolveFilePath(dir, fileUrl('../a.txt'))).toBe(join(dir, 'a.txt'))
    expect(resolveFilePath(dir, fileUrl('%2e%2e/%2e%2e/etc/passwd'))).toBeNull()
    expect(resolveFilePath(dir, `launcher-note://asset/assets/a.png`)).toBeNull()
    expect(resolveFilePath(dir, fileUrl('sub'))).toBeNull()
    expect(resolveFilePath(dir, 'not a url')).toBeNull()
  })
})

describe('launcher-note://external/ host', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('放行可预览的普通文件,拒绝目录、链接、旧版 Office 和相对路径', () => {
    const dir = mkdtempSync(join(tmpdir(), 'launcher-proto-ext-'))
    roots.push(dir)
    const pdf = join(dir, '说明.pdf')
    writeFileSync(pdf, '%PDF')
    writeFileSync(join(dir, '旧.doc'), 'doc')
    symlinkSync(pdf, join(dir, '链.pdf'))

    const external = (path: string): string =>
      `launcher-note://external/?p=${encodeURIComponent(path)}`
    expect(resolveExternalPath(external(pdf))).toBe(realpathSync(pdf))
    expect(resolveExternalPath(external(join(dir, '旧.doc')))).toBeNull()
    expect(resolveExternalPath(external(join(dir, '链.pdf')))).toBeNull()
    expect(resolveExternalPath(external(dir))).toBeNull()
    expect(resolveExternalPath('launcher-note://external/?p=说明.pdf')).toBeNull()
    expect(resolveExternalPath('launcher-note://file/说明.pdf')).toBeNull()
  })
})

describe('fileHeadersFor', () => {
  it('HTML 用 scheme 源 CSP(iframe 无同源,不能用 self)', () => {
    const h = fileHeadersFor('/notes/site/index.html')
    expect(h['Content-Type']).toBe('text/html; charset=utf-8')
    expect(h['Content-Security-Policy']).toContain('default-src launcher-note:')
    expect(h['Content-Security-Policy']).not.toContain("'self'")
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['Access-Control-Allow-Origin']).toBe('*')
    expect(h['Content-Disposition']).toContain("filename*=UTF-8''index.html")
  })

  it('SVG 按图片档收紧,其余类型不发 CSP', () => {
    expect(fileHeadersFor('/n/logo.svg')['Content-Security-Policy']).toBe("default-src 'none'; sandbox")
    expect(fileHeadersFor('/n/app.js')['Content-Security-Policy']).toBeUndefined()
    expect(fileHeadersFor('/n/app.js')['Content-Type']).toBe('text/javascript; charset=utf-8')
    expect(fileHeadersFor('/n/x.weird')['Content-Type']).toBe('application/octet-stream')
    expect(fileHeadersFor('/n/中文 图.png')['Content-Disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('中文 图.png')}`
    )
  })
})
