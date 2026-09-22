// markdown.tsx 的纯度与安全测试:HTML 必须 inert、未闭合围栏不丢内容、嵌套粗体+行内代码、链接走 openExternal
import { describe, expect, it, vi } from 'vitest'
import { renderMarkdown } from './markdown'

// openExternal 直连主进程;纯函数测试里 mock 掉
vi.mock('./utils', () => ({ openExternal: vi.fn() }))

/** 递归拍平 React 节点树 → 纯文本(校验用) */
function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  const el = node as { props?: { children?: unknown } }
  return el.props ? textOf(el.props.children) : ''
}

/** 深度优先找第一个指定 tag 的 React 元素 */
function findElement(node: unknown, tag: string): unknown {
  if (node == null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findElement(n, tag)
      if (hit) return hit
    }
    return null
  }
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (el.type === tag) return el
  return el.props ? findElement(el.props.children, tag) : null
}

describe('renderMarkdown', () => {
  it('HTML in input stays inert text(产 React 节点,不拼 HTML)', () => {
    const nodes = renderMarkdown('hello <img src=x onerror=alert(1)> <b>bold</b>')
    const txt = textOf(nodes)
    expect(txt).toContain('<img src=x onerror=alert(1)>')
    expect(txt).toContain('<b>bold</b>')
    // 产物必须是 React 元素(文本子节点),不允许出现 html 字符串容器
    expect(nodes.every((n) => typeof n === 'object')).toBe(true)
  })

  it('unterminated code fence:未闭合围栏吃到结尾且原文保留', () => {
    const nodes = renderMarkdown('```\nconst a = 1\nconst b = 2')
    expect(nodes).toHaveLength(1)
    const el = nodes[0] as { props: { className: string; children: { props: { children: string } } } }
    expect(el.props.className).toBe('md-code')
    expect(el.props.children.props.children).toBe('const a = 1\nconst b = 2')
  })

  it('nested bold + inline code', () => {
    const nodes = renderMarkdown('**bold with `code` inside**')
    const txt = textOf(nodes)
    expect(txt).toBe('bold with code inside')
    // 结构:md-p > strong > [文本, code]
    const p = nodes[0] as { props: { children: unknown[] } }
    const strong = p.props.children[0] as { type: string; props: { children: unknown[] } }
    expect(strong.type).toBe('strong')
    const code = strong.props.children[1] as { type: string; props: { children: string } }
    expect(code.type).toBe('code')
    expect(code.props.children).toBe('code')
  })

  it('link renders clickable element routed to openExternal', async () => {
    const { openExternal } = await import('./utils')
    const nodes = renderMarkdown('see [Anthropic docs](https://docs.anthropic.com/llms.txt)')
    // 段落的 children 是行内节点数组,链接未必在首位(前面还有 "see ")——按类型找,不按下标猜
    const a = findElement(nodes, 'a') as {
      type: string
      props: { href: string; onClick: (e: { preventDefault: () => void }) => void }
    }
    expect(a?.type).toBe('a')
    expect(a.props.href).toBe('https://docs.anthropic.com/llms.txt')
    const preventDefault = vi.fn()
    a.props.onClick({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledWith('https://docs.anthropic.com/llms.txt')
  })

  it('GFM 表格:带分隔行才成表,单行竖线文本仍是段落', () => {
    const t1 = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |')
    const table = findElement(t1, 'table')
    expect(table).toBeTruthy()
    expect(textOf(table)).toContain('A')
    expect(textOf(table)).toContain('4')

    // 没有分隔行 → 不是表格(避免把正文里的竖线误判成表格)
    const t2 = renderMarkdown('| 这只是一句话 |')
    expect(findElement(t2, 'table')).toBeNull()
    expect(textOf(t2)).toContain('这只是一句话')
  })

  it('表格里的行内标记仍按行内解析,HTML 保持 inert', () => {
    const nodes = renderMarkdown('| 键 | 值 |\n|---|---|\n| `Label` | <b>x</b> |')
    const table = findElement(nodes, 'table')
    expect(textOf(table)).toContain('Label')
    expect(textOf(table)).toContain('<b>x</b>')
    expect(findElement(nodes, 'code')).toBeTruthy()
  })
})
