import { describe, expect, it } from 'vitest'
import {
  exportExt,
  exportFileName,
  exportFormatsFor,
  sanitizeExportStem
} from './note-export'

describe('exportFormatsFor', () => {
  it('笔记三个格式，Markdown 是默认第一项', () => {
    expect(exportFormatsFor('markdown')).toEqual(['markdown', 'html', 'pdf'])
  })

  it('HTML 文件只导出 HTML 与 PDF', () => {
    expect(exportFormatsFor('html')).toEqual([])
  })

  it('text / code / csv 导出原文、HTML、PDF', () => {
    for (const kind of ['text', 'code', 'csv'] as const) {
      expect(exportFormatsFor(kind)).toEqual(['text', 'html', 'pdf'])
    }
  })

  it('非文本类没有导出格式（头部不显示按钮）', () => {
    for (const kind of ['image', 'pdf', 'canvas', 'drawio', 'docx', 'unsupported'] as const) {
      expect(exportFormatsFor(kind)).toEqual([])
    }
    expect(exportFormatsFor(null)).toEqual([])
  })
})

describe('exportExt', () => {
  it('固定扩展名', () => {
    expect(exportExt('markdown')).toBe('md')
    expect(exportExt('html')).toBe('html')
    expect(exportExt('pdf')).toBe('pdf')
  })

  it('原文保留文件自己的扩展名', () => {
    expect(exportExt('text', 'csv')).toBe('csv')
    expect(exportExt('text', '.TSV')).toBe('tsv')
  })

  it('原文没有扩展名时回退 txt', () => {
    expect(exportExt('text', '')).toBe('txt')
    expect(exportExt('text', null)).toBe('txt')
    expect(exportExt('text', '...')).toBe('txt')
  })
})

describe('sanitizeExportStem / exportFileName', () => {
  it('非法字符换成下划线', () => {
    expect(sanitizeExportStem('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('控制字符换成下划线，连续空白压成一个空格', () => {
    expect(sanitizeExportStem('a\u0001b   c')).toBe('a_b c')
  })

  it('去掉首尾空格与点', () => {
    expect(sanitizeExportStem('  .隐藏笔记.  ')).toBe('隐藏笔记')
  })

  it('清洗后为空时用 fallback', () => {
    expect(sanitizeExportStem('...', '未命名')).toBe('未命名')
    expect(sanitizeExportStem('   ', 'Untitled')).toBe('Untitled')
  })

  it('过长的主体截断到上限内，且不以点结尾', () => {
    const out = sanitizeExportStem(`${'长'.repeat(200)}`)
    expect(out.length).toBe(120)
  })

  it('拼出建议文件名', () => {
    expect(exportFileName('季度总结', 'md')).toBe('季度总结.md')
    expect(exportFileName('a/b', 'pdf')).toBe('a_b.pdf')
    expect(exportFileName('', 'html')).toBe('未命名.html')
    expect(exportFileName('', 'html', 'Untitled')).toBe('Untitled.html')
  })
})
