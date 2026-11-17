import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installLauncherStub } from '../test/launcher-stub'
import { buildMarkdownHtml, buildPlainHtml } from './note-export-html'

function stubAssets(
  readFileBytes: (rel: string, maxBytes?: number) => Promise<unknown>
): void {
  installLauncherStub({
    notes: {
      readFileBytes: readFileBytes as never
    }
  })
}

beforeEach(() => {
  stubAssets(async () => ({ ok: false, kind: 'not-found', message: 'missing' }))
})

describe('buildPlainHtml', () => {
  it('整段转义进 pre，标题也转义', () => {
    const out = buildPlainHtml({ title: '<标题>', text: 'a < b && c\n<script>x</script>' })
    expect(out).toContain('<title>&lt;标题&gt;</title>')
    expect(out).toContain('<pre class="md-export-plain">a &lt; b &amp;&amp; c\n&lt;script&gt;x&lt;/script&gt;</pre>')
    expect(out).not.toContain('<script>')
  })

  it('带 charset / 内联样式 / article 骨架', () => {
    const out = buildPlainHtml({ title: 't', text: 'x' })
    expect(out.startsWith('<!doctype html>')).toBe(true)
    expect(out).toContain('<meta charset="utf-8">')
    expect(out).toContain('<style>')
    expect(out).toContain('<article class="md-export">')
  })
})

describe('buildMarkdownHtml', () => {
  it('标题、段落、表格、代码块渲染成静态 HTML', async () => {
    const out = await buildMarkdownHtml({
      title: '导出测试',
      source: '# 大标题\n\n一段正文\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = 1\n```\n'
    })
    expect(out).toContain('<title>导出测试</title>')
    expect(out).toContain('md-h1')
    expect(out).toContain('一段正文')
    expect(out).toContain('<table')
    expect(out).toContain('const x = 1')
    expect(out).toContain('<article class="md-export">')
  })

  it('本地图片内联成 data: URL', async () => {
    stubAssets(async () => ({
      ok: true,
      data: new Uint8Array([1, 2, 3]),
      size: 3,
      mtimeMs: 0
    }))
    const out = await buildMarkdownHtml({
      title: 't',
      source: '![图](assets/pic.png)\n'
    })
    expect(out).toContain('src="data:image/png;base64,AQID"')
  })

  it('读不到的本地图片保留笔记协议地址，不中断导出', async () => {
    const out = await buildMarkdownHtml({
      title: 't',
      source: '![图](assets/missing.png)\n'
    })
    expect(out).toContain('launcher-note://asset/')
    expect(out).not.toContain('data:image')
  })

  it('远程图片保留原地址（不下载）', async () => {
    const read = vi.fn(async () => ({ ok: false as const, kind: 'not-found' as const, message: '' }))
    stubAssets(read as never)
    const out = await buildMarkdownHtml({
      title: 't',
      source: '![远程](https://example.com/a.png)\n'
    })
    expect(out).toContain('src="https://example.com/a.png"')
    expect(read).not.toHaveBeenCalled()
  })

  it('脚本内容被转义，不会在导出文件里执行', async () => {
    const out = await buildMarkdownHtml({
      title: 't',
      source: '<script>alert(1)</script>\n'
    })
    expect(out).not.toContain('<script>alert(1)</script>')
    expect(out).toContain('&lt;script&gt;')
  })
})
