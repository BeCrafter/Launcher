import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { extractHeadings, renderMarkdown, slugifyHeading } from './markdown'

describe('slugifyHeading(与帮助文档手写的锚点对齐)', () => {
  it('中文标题:去序号点、空格转连字符', () => {
    expect(slugifyHeading('1. 四个页面各管什么')).toBe('1-四个页面各管什么')
  })

  it('中文标题带全角括号:括号被去掉', () => {
    expect(slugifyHeading('2. 三个最常用任务（照着做）')).toBe('2-三个最常用任务照着做')
  })

  it('中英混排:英文转小写', () => {
    expect(slugifyHeading('3. Agent 管理（launchd）')).toBe('3-agent-管理launchd')
  })

  it('英文标题', () => {
    expect(slugifyHeading('9. FAQ')).toBe('9-faq')
    expect(slugifyHeading('12. Still stuck?')).toBe('12-still-stuck')
  })

  it('保留连字符与下划线', () => {
    expect(slugifyHeading('a-b_c')).toBe('a-b_c')
  })
})

describe('extractHeadings(帮助页目录)', () => {
  it('只取 ## 级标题,顺序不变', () => {
    const md = ['# 一级不要', '## 一', '### 三级不要', '正文', '## 二'].join('\n')
    expect(extractHeadings(md)).toEqual([
      { text: '一', id: '一' },
      { text: '二', id: '二' }
    ])
  })
})

describe('renderMarkdown 块级解析', () => {
  const html = (md: string, anchors = false): string =>
    renderToStaticMarkup(<>{renderMarkdown(md, 't', { anchors })}</>)

  it('分隔线 --- 渲染为 hr(此前会退化成一段文字)', () => {
    expect(html('上\n\n---\n\n下')).toContain('md-hr')
  })

  it('--- 不会误伤表格分隔行', () => {
    const out = html('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(out).toContain('md-table')
    expect(out).not.toContain('md-hr')
  })

  it('开启 anchors 时标题带 id', () => {
    expect(html('## 1. 四个页面各管什么', true)).toContain('id="1-四个页面各管什么"')
  })

  it('默认不开 anchors:标题不带 id(AI 消息渲染保持原样)', () => {
    expect(html('## 标题')).not.toContain('id=')
  })

  it('开启 anchors 时 #内部链接不带外链图标;关闭时走外链', () => {
    const anchor = html('[跳转](#foo)', true)
    expect(anchor).toContain('md-anchor')
    expect(anchor).not.toContain('md-link-icon')

    const ext = html('[外链](https://example.com)')
    expect(ext).toContain('md-link-icon')
  })

  it('围栏代码块未闭合时吃到结尾(不静默丢后半段)', () => {
    const out = html('```bash\nls\n')
    expect(out).toContain('md-code')
    expect(out).toContain('ls')
  })

  it('表格单元格里的 \\| 是字面竖线,不能当分隔符(否则整行错位)', () => {
    const out = html('| a | b | c |\n|---|---|---|\n| x | `curl ... \\| bash` | y |')
    expect(out.match(/<th>/g)?.length).toBe(3)
    expect(out.match(/<td>/g)?.length).toBe(3)
    // 转义还原成字面竖线
    expect(out).toContain('| bash')
    expect(out).not.toContain('\\|')
  })
})
