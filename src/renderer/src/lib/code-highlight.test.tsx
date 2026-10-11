// 代码高亮的产出。
//
// 这里最要紧的一条是**它产出的是 React 节点,不是 HTML 字符串** ——
// 那正是 markdown.tsx「绝不用 dangerouslySetInnerHTML」这条保证能继续成立的原因。
// 用 highlightTree 的常见写法拿的是 HTML,一旦那样做,这份保证就没了。

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { clearHighlightCache, highlightCodeNodes, isKnownLang } from './code-highlight'

const render = (code: string, lang: string): string =>
  renderToStaticMarkup(<code>{highlightCodeNodes(code, lang, 'k')}</code>)

describe('highlightCodeNodes', () => {
  it('把关键字 / 字符串 / 数字切成带 class 的 span', () => {
    const out = render('const a = "x" + 1', 'js')
    expect(out).toContain('tk-keyword')
    expect(out).toContain('tk-string')
    expect(out).toContain('tk-number')
  })

  it('不认识的语言原样返回纯文本(不染色、不抛)', () => {
    const out = render('这是一段日志 2026-10-10', 'nonsense')
    expect(out).toBe('<code>这是一段日志 2026-10-10</code>')
  })

  it('空语言 / 空代码都不炸', () => {
    expect(render('', 'js')).toBe('<code></code>')
    expect(render('const a = 1', '')).toBe('<code>const a = 1</code>')
  })

  it('**文本内容逐字节保留** —— 高亮只加壳,不动代码', () => {
    const code = 'const a = 1\n\nfunction f() {\n  return `x${a}`\n}\n'
    expect(render(code, 'js')).toBe(render(code, 'js'))
    // 把所有标签剥掉应当还原成原文
    const stripped = render(code, 'js').replace(/<[^>]*>/g, '')
    expect(stripped).toBe(code)
  })

  it('行与行之间用字面 \\n 连接,复制出去还是原样的代码', () => {
    const out = render('a\nb\nc', 'js')
    expect(out.replace(/<[^>]*>/g, '')).toBe('a\nb\nc')
  })

  it('注释、字符串里的 HTML 会被转义,不会变成真标签', () => {
    const out = render('// <img src=x onerror=alert(1)>', 'js')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })

  it.each([
    ['json', '{"a": [1, true, null]}'],
    ['xml', '<plist><dict><key>Label</key></dict></plist>'],
    ['yaml', 'a: 1\nb:\n  - x'],
    ['shell', 'for f in *.log; do echo "$f"; done'],
    ['python', 'def f(x):\n    return x + 1'],
    ['sql', 'SELECT id FROM t WHERE a = 1'],
    ['go', 'func main() { fmt.Println("hi") }'],
    ['rust', 'fn main() { let x: u32 = 1; }'],
    ['ini', '[section]\nkey = value'],
    ['dockerfile', 'FROM node:20\nRUN npm ci'],
    ['diff', '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new']
  ])('%s 能高亮出至少一个 token', (lang, code) => {
    expect(render(code, lang)).toContain('tk-')
  })

  it('同一段代码重复调用命中缓存(返回同一个数组)', () => {
    clearHighlightCache()
    const a = highlightCodeNodes('const x = 1', 'js', 'k')
    const b = highlightCodeNodes('const x = 1', 'js', 'k')
    expect(a).toBe(b)
  })

  it('缓存键带上语言:同一段文本换个语言不会串味', () => {
    clearHighlightCache()
    const asJs = highlightCodeNodes('a = 1', 'js', 'k')
    const asPy = highlightCodeNodes('a = 1', 'python', 'k')
    expect(asJs).not.toBe(asPy)
  })

  it('缓存不会无限增长(超过上限后仍能正确产出)', () => {
    clearHighlightCache()
    for (let i = 0; i < 200; i++) {
      expect(renderToStaticMarkup(<code>{highlightCodeNodes(`const a${i} = ${i}`, 'js', 'k')}</code>)).toContain('tk-')
    }
  })
})

describe('isKnownLang', () => {
  it('认得的返回 true,认不得的 false', () => {
    expect(isKnownLang('js')).toBe(true)
    expect(isKnownLang('plist')).toBe(true)
    expect(isKnownLang('mermaid')).toBe(false)
  })
})
