import { describe, expect, it, vi } from 'vitest'
import type { WebFrameMain } from 'electron'
import {
  FRAME_SCROLLBAR_CSS,
  FRAME_SCROLLBAR_SCRIPT,
  installFrameScrollbar,
  isEmbeddedDocUrl,
  isWebEmbedUrl,
  shouldInstallFrameScrollbar
} from './frame-scrollbar'

describe('isEmbeddedDocUrl', () => {
  it('只处理附件协议里的 PDF / 本地网页', () => {
    expect(isEmbeddedDocUrl('launcher-note://asset/assets/a.pdf')).toBe(true)
    expect(isEmbeddedDocUrl('launcher-note://asset/assets/a.html')).toBe(true)
    expect(isEmbeddedDocUrl('launcher-note://asset/assets/a.htm')).toBe(true)
    expect(isEmbeddedDocUrl('launcher-note://asset/assets/A.HTML')).toBe(true)
  })

  it('带查询串 / 锚点也算(网页嵌入允许 user 写这类地址)', () => {
    expect(isEmbeddedDocUrl('launcher-note://asset/a.html?x=1#top')).toBe(true)
    expect(isEmbeddedDocUrl('launcher-note://asset/dir/a.pdf#page=3')).toBe(true)
  })

  it('文件协议 host 的 HTML / PDF 同样处理', () => {
    expect(isEmbeddedDocUrl('launcher-note://file/site/index.html')).toBe(true)
    expect(isEmbeddedDocUrl('launcher-note://file/site/index.html?v=2')).toBe(true)
    expect(isEmbeddedDocUrl('launcher-note://file/doc/manual.PDF#page=2')).toBe(true)
    expect(isEmbeddedDocUrl('launcher-note://file/site/app.js')).toBe(false)
    expect(isEmbeddedDocUrl('launcher-note://file/site/x.txt')).toBe(false)
  })

  it('外部文件协议的路径在查询串里,PDF 和网页仍换细滚动条', () => {
    expect(isEmbeddedDocUrl('launcher-note://external/?p=%2Ftmp%2Fa.pdf')).toBe(true)
    expect(isEmbeddedDocUrl('launcher-note://external/?p=%2Ftmp%2Fa.html&v=2')).toBe(true)
    expect(isEmbeddedDocUrl('launcher-note://external/?p=%2Ftmp%2Fa.mp4')).toBe(false)
    expect(isEmbeddedDocUrl('launcher-note://external/?p=')).toBe(false)
  })

  it('其它附件与外部页面不归这条规则', () => {
    expect(isEmbeddedDocUrl('launcher-note://asset/assets/sample.png')).toBe(false)
    expect(isEmbeddedDocUrl('launcher-note://asset/assets/sample.mp4')).toBe(false)
    expect(isEmbeddedDocUrl('https://example.com/a.html')).toBe(false)
    expect(isEmbeddedDocUrl('file:///tmp/a.html')).toBe(false)
    expect(isEmbeddedDocUrl('about:blank')).toBe(false)
    // 前缀必须是 /asset/,别把 assets 之类近似路径放进来
    expect(isEmbeddedDocUrl('launcher-note://assets/a.html')).toBe(false)
  })
})

describe('isWebEmbedUrl', () => {
  it('只放行 http / https', () => {
    expect(isWebEmbedUrl('https://example.com/a.html')).toBe(true)
    expect(isWebEmbedUrl('https://www.baidu.com/s?wd=1')).toBe(true)
    expect(isWebEmbedUrl('http://example.com/')).toBe(true)
    expect(isWebEmbedUrl('file:///tmp/a.html')).toBe(false)
    expect(isWebEmbedUrl('about:blank')).toBe(false)
    expect(isWebEmbedUrl('launcher-note://file/site/index.html')).toBe(false)
    expect(isWebEmbedUrl('javascript:alert(1)')).toBe(false)
    expect(isWebEmbedUrl('')).toBe(false)
    expect(isWebEmbedUrl('not a url')).toBe(false)
  })
})

describe('shouldInstallFrameScrollbar', () => {
  const child = { parent: {} }

  it('外部网页只给子帧装,主帧不动', () => {
    expect(shouldInstallFrameScrollbar({ url: 'https://example.com/a.html', ...child })).toBe(true)
    expect(shouldInstallFrameScrollbar({ url: 'http://localhost:5173/', parent: null })).toBe(false)
    expect(shouldInstallFrameScrollbar({ url: 'https://www.baidu.com/', parent: null })).toBe(false)
    expect(shouldInstallFrameScrollbar({ url: 'file:///tmp/a.html', ...child })).toBe(false)
    expect(shouldInstallFrameScrollbar({ url: 'about:blank', ...child })).toBe(false)
  })

  it('笔记协议的 PDF / 本地网页即使没有 parent 也装', () => {
    expect(shouldInstallFrameScrollbar({ url: 'launcher-note://asset/a.html', parent: null })).toBe(
      true
    )
  })
})

describe('注入内容', () => {
  it('滚动条与预览同款:10px 槽 + 4px 透明边,默认滑块完全透明', () => {
    expect(FRAME_SCROLLBAR_CSS).toContain('::-webkit-scrollbar{width:10px;height:10px}')
    expect(FRAME_SCROLLBAR_CSS).toContain('border:4px solid transparent')
    expect(FRAME_SCROLLBAR_CSS).toContain('--launcher-frame-thumb:transparent')
  })

  it('脚本幂等,并在滚动时点亮、停下 900ms 后重新隐去', () => {
    expect(FRAME_SCROLLBAR_SCRIPT).toContain('window.__launcherFrameScrollbar === true')
    expect(FRAME_SCROLLBAR_SCRIPT).toContain("style.id = 'launcher-frame-scrollbar'")
    expect(FRAME_SCROLLBAR_SCRIPT).toContain(JSON.stringify(FRAME_SCROLLBAR_CSS))
    expect(FRAME_SCROLLBAR_SCRIPT).toContain('adoptedStyleSheets')
    expect(FRAME_SCROLLBAR_SCRIPT).toContain("setProperty('--launcher-frame-thumb'")
    expect(FRAME_SCROLLBAR_SCRIPT).toContain('removeProperty')
    expect(FRAME_SCROLLBAR_SCRIPT).toMatch(/removeProperty\('--launcher-frame-thumb'\), 900\)/)
    expect(FRAME_SCROLLBAR_SCRIPT).toContain('capture: true')
  })
})

describe('installFrameScrollbar', () => {
  const fakeFrame = (
    url: string,
    run: () => Promise<unknown> = async () => 'installed',
    parent: WebFrameMain | null = null
  ) => ({ url, parent, executeJavaScript: vi.fn(run) }) as unknown as WebFrameMain

  it('目标文档:注入脚本', async () => {
    const frame = fakeFrame('launcher-note://asset/a.html')
    await expect(installFrameScrollbar(frame)).resolves.toBe(true)
    expect(frame.executeJavaScript).toHaveBeenCalledWith(FRAME_SCROLLBAR_SCRIPT)
  })

  it('外部网页的子帧:注入同一套脚本', async () => {
    const frame = fakeFrame('https://www.baidu.com/', async () => 'installed', {} as WebFrameMain)
    await expect(installFrameScrollbar(frame)).resolves.toBe(true)
    expect(frame.executeJavaScript).toHaveBeenCalledWith(FRAME_SCROLLBAR_SCRIPT)
  })

  it('应用自己的主帧、file 与 about:blank:连执行都不执行', async () => {
    const main = fakeFrame('http://localhost:5173/')
    await expect(installFrameScrollbar(main)).resolves.toBe(false)
    expect(main.executeJavaScript).not.toHaveBeenCalled()

    for (const url of ['file:///tmp/a.html', 'about:blank']) {
      const frame = fakeFrame(url, async () => 'installed', {} as WebFrameMain)
      await expect(installFrameScrollbar(frame)).resolves.toBe(false)
      expect(frame.executeJavaScript).not.toHaveBeenCalled()
    }
  })

  it('帧已销毁 / 注入失败:静默返回 false,不抛给调用方', async () => {
    const frame = fakeFrame('launcher-note://asset/a.pdf', async () => {
      throw new Error('frame destroyed')
    })
    await expect(installFrameScrollbar(frame)).resolves.toBe(false)
  })
})
