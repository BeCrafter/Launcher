import { describe, expect, it } from 'vitest'
import { cardTextPreview } from './canvas-card-text'

describe('cardTextPreview', () => {
  it('Markdown:去 frontmatter,首行标题单独返回,去掉行内标记', () => {
    const text = [
      '---',
      'tags: [a]',
      '---',
      '# 周报',
      '',
      '**重点** 和 [链接](https://example.com) 以及 `代码`。',
      '- 第一项',
      '1. 第二项',
      '> 引用'
    ].join('\n')
    const preview = cardTextPreview({ text, kind: 'markdown' })
    expect(preview.heading).toBe('周报')
    expect(preview.lines).toEqual(['重点 和 链接 以及 代码。', '第一项', '第二项', '引用'])
    expect(preview.mono).toBe(false)
  })

  it('代码保留缩进,tab 转成两个空格', () => {
    const text = ['function a() {', '\treturn 1', '}'].join('\n')
    const preview = cardTextPreview({ text, kind: 'code' })
    expect(preview.heading).toBeNull()
    expect(preview.mono).toBe(true)
    expect(preview.lines).toEqual(['function a() {', '  return 1', '}'])
  })

  it('CSV 只取前几行,分隔符转成 ·', () => {
    const rows = Array.from({ length: 20 }, (_, index) => `${index},值${index},x`)
    const preview = cardTextPreview({ text: rows.join('\n'), kind: 'csv' })
    expect(preview.lines).toHaveLength(12)
    expect(preview.lines[0]).toBe('0 · 值0 · x')
  })

  it('行数与字符数都截断', () => {
    const text = Array.from({ length: 100 }, (_, index) => `第 ${index} 行`).join('\n')
    const preview = cardTextPreview({ text, kind: 'note', maxLines: 5, maxChars: 12 })
    expect(preview.lines.length).toBeLessThanOrEqual(5)
    expect(preview.lines.join('\n').length).toBeLessThanOrEqual(12)
    expect(preview.truncated).toBe(true)
  })

  it('图片、HTML 标签和空行被清掉', () => {
    const preview = cardTextPreview({
      text: '正文<br/>![图](a.png)\n\n\n结尾',
      kind: 'text'
    })
    expect(preview.lines.join('')).not.toContain('<br')
    expect(preview.lines.join('')).not.toContain('a.png')
  })
})
