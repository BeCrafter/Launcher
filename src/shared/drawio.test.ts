import { describe, expect, it } from 'vitest'
import {
  DRAWIO_ONLINE_ORIGIN,
  DRAWIO_PACK_DIR,
  DRAWIO_PACK_MIRRORS,
  DRAWIO_PACK_URL,
  DRAWIO_PACK_VERSION,
  DRAWIO_SCHEME,
  DRAWIO_STUB_HTML,
  blankDrawioXml,
  drawioFrameUrl,
  drawioLoadMessage,
  drawioPackSources,
  isDrawioExtension,
  isDrawioText,
  parseDrawioMessage
} from './drawio'

describe('isDrawioExtension', () => {
  it('认 drawio / dio,大小写与前导点都放过', () => {
    for (const ext of ['drawio', 'dio', '.drawio', 'DRAWIO', 'Dio']) {
      expect(isDrawioExtension(ext)).toBe(true)
    }
  })

  it('别的扩展名不是', () => {
    for (const ext of ['drawio.svg', 'drawio.png', 'md', 'excal', '']) {
      expect(isDrawioExtension(ext)).toBe(false)
    }
  })
})

describe('isDrawioText', () => {
  it('空文件合法:新建后还没画,交给 draw.io 填空白图', () => {
    expect(isDrawioText('')).toBe(true)
    expect(isDrawioText('  \n\t ')).toBe(true)
  })

  it('mxfile / mxGraphModel 都认,大小写与属性写法不敏感', () => {
    expect(isDrawioText('<mxfile host="app.diagrams.net">')).toBe(true)
    expect(isDrawioText('<?xml version="1.0"?>\n<mxfile>')).toBe(true)
    expect(isDrawioText('<mxGraphModel dx="1">')).toBe(true)
    expect(isDrawioText('<MXFILE HOST="x">')).toBe(true)
  })

  it('非空但不是图的内容挡住', () => {
    for (const text of ['# 标题', '<svg></svg>', '<mxCell id="0"/>', 'not xml']) {
      expect(isDrawioText(text)).toBe(false)
    }
  })
})

describe('blankDrawioXml', () => {
  it('每次给一个新 diagram id,但结构固定', () => {
    const a = blankDrawioXml()
    const b = blankDrawioXml()
    expect(a).toMatch(/^<mxfile /)
    expect(a).toContain('<mxGraphModel ')
    expect(a).toContain('<mxCell id="0"/><mxCell id="1" parent="0"/>')
    expect(a).toContain(`version="${DRAWIO_PACK_VERSION}"`)
    expect(a).not.toBe(b)
    expect(isDrawioText(a)).toBe(true)
  })
})

describe('drawioFrameUrl', () => {
  const paramsOf = (url: string): URLSearchParams => new URL(url).searchParams

  it('在线走官方 embed 主机,带 embed 协议与中文/浅色', () => {
    const url = drawioFrameUrl({ mode: 'online' })
    expect(url.startsWith(`${DRAWIO_ONLINE_ORIGIN}/?`)).toBe(true)
    const params = paramsOf(url)
    expect(params.get('embed')).toBe('1')
    expect(params.get('proto')).toBe('json')
    expect(params.get('spin')).toBe('1')
    expect(params.get('noSaveBtn')).toBe('1')
    expect(params.get('noExitBtn')).toBe('1')
    expect(params.get('saveAndExit')).toBe('0')
    expect(params.get('configure')).toBe('1')
    expect(params.get('lang')).toBe('zh')
    expect(params.get('dark')).toBe('0')
    expect(params.get('offline')).toBeNull()
    expect(params.get('lightbox')).toBeNull()
  })

  it('离线走本地特权 scheme,带上版本目录与 offline=1', () => {
    const url = drawioFrameUrl({ mode: 'offline', dark: true, lang: 'en' })
    expect(url.startsWith(`${DRAWIO_SCHEME}://app/${DRAWIO_PACK_DIR}/index.html?`)).toBe(true)
    const params = paramsOf(url)
    expect(params.get('offline')).toBe('1')
    expect(params.get('configure')).toBe('1')
    expect(params.get('dark')).toBe('1')
    expect(params.get('lang')).toBe('en')
  })

  it('卡片用 lightbox + nav,单页只读', () => {
    const url = drawioFrameUrl({ mode: 'online', lightbox: true })
    const params = paramsOf(url)
    expect(params.get('lightbox')).toBe('1')
    expect(params.get('nav')).toBe('1')
    expect(params.get('configure')).toBe('1')
  })

  it('packVersion 可覆盖(老版本目录仍能打开)', () => {
    const url = drawioFrameUrl({ mode: 'offline', packVersion: '1.2.3' })
    expect(url).toContain(`${DRAWIO_SCHEME}://app/v1.2.3/index.html`)
  })
})

describe('drawioLoadMessage', () => {
  it('autosave 转成 1/0,标题可选', () => {
    expect(drawioLoadMessage('<mxfile/>', { autosave: true, dark: false })).toEqual({
      action: 'load',
      xml: '<mxfile/>',
      autosave: 1,
      dark: false
    })
    expect(drawioLoadMessage('x', { autosave: false, dark: true, title: '图.drawio' })).toEqual({
      action: 'load',
      xml: 'x',
      autosave: 0,
      dark: true,
      title: '图.drawio'
    })
  })
})

describe('parseDrawioMessage', () => {
  it('init / configure', () => {
    expect(parseDrawioMessage({ event: 'init' })).toEqual({ event: 'init' })
    expect(parseDrawioMessage({ event: 'configure' })).toEqual({ event: 'configure' })
    expect(parseDrawioMessage('{"event":"configure"}')).toEqual({ event: 'configure' })
  })

  it('真实 draw.io 发的是 JSON 字符串 —— 必须同样认', () => {
    expect(parseDrawioMessage('{"event":"init"}')).toEqual({ event: 'init' })
    expect(parseDrawioMessage('{"event":"autosave","xml":"<mxfile/>"}')).toEqual({
      event: 'autosave',
      xml: '<mxfile/>'
    })
    expect(parseDrawioMessage('{"event":"export","format":"xml","xml":"a"}')).toEqual({
      event: 'export',
      format: 'xml',
      xml: 'a'
    })
    expect(parseDrawioMessage('not json')).toBeNull()
    expect(parseDrawioMessage('')).toBeNull()
  })

  it('autosave / save 带 XML', () => {
    expect(parseDrawioMessage({ event: 'autosave', xml: '<mxfile/>' })).toEqual({
      event: 'autosave',
      xml: '<mxfile/>'
    })
    expect(parseDrawioMessage({ event: 'save', xml: '<mxfile/>' })).toEqual({
      event: 'save',
      xml: '<mxfile/>'
    })
  })

  it('export 缺 format 时按 xml 处理', () => {
    expect(parseDrawioMessage({ event: 'export', xml: '<mxfile/>' })).toEqual({
      event: 'export',
      format: 'xml',
      xml: '<mxfile/>'
    })
    expect(parseDrawioMessage({ event: 'export', format: 'xml', xml: 'a' })).toEqual({
      event: 'export',
      format: 'xml',
      xml: 'a'
    })
  })

  it('openLink 只认非空 href', () => {
    expect(parseDrawioMessage({ event: 'openLink', href: 'https://example.com' })).toEqual({
      event: 'openLink',
      href: 'https://example.com'
    })
    expect(parseDrawioMessage({ event: 'openLink', href: '' })).toBeNull()
  })

  it('字段类型不对或无关事件一律丢掉', () => {
    for (const bad of [
      null,
      undefined,
      42,
      'init',
      {},
      { event: 'autosave' },
      { event: 'autosave', xml: 1 },
      { event: 'autosave', xml: '' },
      { event: 'export', xml: '' },
      { event: 'openLink' }
    ]) {
      expect(parseDrawioMessage(bad)).toBeNull()
    }
  })
})

describe('打包常量', () => {
  it('下载地址与版本目录同源', () => {
    expect(DRAWIO_PACK_URL).toContain(`/v${DRAWIO_PACK_VERSION}/draw.war`)
    expect(DRAWIO_PACK_DIR).toBe(`v${DRAWIO_PACK_VERSION}`)
  })

  it('下载源:加速镜像在前,GitHub 原文兜底', () => {
    const sources = drawioPackSources()
    expect(sources.slice(0, -1)).toEqual([...DRAWIO_PACK_MIRRORS])
    expect(sources.at(-1)).toBe(DRAWIO_PACK_URL)
    // 镜像只换前缀,包路径必须完全一致(否则镜像 404,白白浪费一次超时)
    for (const url of DRAWIO_PACK_MIRRORS) expect(url.endsWith(DRAWIO_PACK_URL)).toBe(true)
  })

  it('stub 页实现完整 embed 协议,可直接在 E2E 里驱动', () => {
    expect(DRAWIO_STUB_HTML).toContain("post({ event: 'init' })")
    expect(DRAWIO_STUB_HTML).toContain("d.action === 'load'")
    expect(DRAWIO_STUB_HTML).toContain("d.action === 'export'")
    expect(DRAWIO_STUB_HTML).toContain("event: 'autosave'")
    expect(DRAWIO_STUB_HTML).toContain('dataset.stubAction')
    // configure=1 时先问父页要配置,收到 customCss 才继续 init
    expect(DRAWIO_STUB_HTML).toContain("params.get('configure') === '1'")
    expect(DRAWIO_STUB_HTML).toContain("post({ event: 'configure' })")
    expect(DRAWIO_STUB_HTML).toContain("d.action === 'configure'")
    expect(DRAWIO_STUB_HTML).toContain('drawio-custom-css')
    expect(DRAWIO_STUB_HTML).toContain('stub.config = config')
    // stub 必须像真实 draw.io 一样用 JSON 字符串收发,否则又把协议差异盖住
    expect(DRAWIO_STUB_HTML).toContain('parent.postMessage(JSON.stringify(m)')
    expect(DRAWIO_STUB_HTML).toContain("typeof d === 'string'")
    expect(DRAWIO_STUB_HTML).not.toMatch(/https?:\/\//)
  })
})
