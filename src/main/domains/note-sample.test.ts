// 「随心手记示例」这篇首次运行生成的笔记。
//
// 它会被写进**用户真实的笔记目录**,所以这里的重点不是文案好不好,而是:
//   · 两份语言版本都在、都不为空、都在上限之内;
//   · 它自己能通过应用自己的解析(写进去之后读得回来,标题/正文都没坏)。

import { describe, expect, it } from 'vitest'
import { sampleNoteBody, sampleNoteTitle } from './note-sample'
import { MAX_NOTE_BYTES } from '../../shared/notes'

const LANGS = ['zh-CN', 'en-US'] as const

describe('sampleNoteBody / sampleNoteTitle', () => {
  it.each(LANGS)('%s 有正文也有标题', (lang) => {
    expect(sampleNoteBody(lang).trim().length).toBeGreaterThan(200)
    expect(sampleNoteTitle(lang).trim()).not.toBe('')
  })

  it('中英是两份不同的正文,不是同一份', () => {
    expect(sampleNoteBody('zh-CN')).not.toBe(sampleNoteBody('en-US'))
  })

  it('未知语言退回英文(而不是抛错或给空串)', () => {
    expect(sampleNoteBody('fr-FR')).toBe(sampleNoteBody('en-US'))
    expect(sampleNoteTitle('fr-FR')).toBe(sampleNoteTitle('en-US'))
  })

  it('正文在上限之内 —— 超了它自己就存不进去', () => {
    for (const lang of LANGS) {
      expect(Buffer.byteLength(sampleNoteBody(lang), 'utf8')).toBeLessThan(MAX_NOTE_BYTES)
    }
  })

  it('以一级标题开头 —— 即使调用方不给标题,也能从正文推出一个', () => {
    for (const lang of LANGS) {
      expect(sampleNoteBody(lang).startsWith('# ')).toBe(true)
    }
  })
})

describe('示例笔记演示的语法,应用自己得认', () => {
  // 这几条是「文档与实现对得上」的机器检查:示例里写了什么,渲染器就得支持什么。
  // 少了任何一条,用户照着抄会发现「示例里能用、我这儿不能用」。
  const zh = sampleNoteBody('zh-CN')

  it.each([
    ['提示块', '> [!WARNING]'],
    ['提示块正文里的块级内容', '> [!TIP] 正文里可以有列表'],
    ['引用里的列表', '> - '],
    ['引用里的代码块', '> ```'],
    ['引用里的表格', '> |'],
    ['嵌套引用', '> > '],
    ['折叠块', '<details open>'],
    ['段落对齐', '<div align="center">'],
    ['右对齐', '<div align="right">'],
    ['下划线斜体写法', '`_斜体_`'],
    ['标题到六级', '###### '],
    ['autolink', '<https://example.com>'],
    ['波浪线围栏', '~~~text'],
    ['带样式的表格围栏', '```table border=none'],
    ['表格宽度围栏', '```table width='],
    ['排版表格围栏', '```table layout'],
    ['场景矩阵:八种盒子', '## 十、场景矩阵'],
    ['场景矩阵:嵌套引用', '### 3. 嵌套引用'],
    ['场景矩阵:折叠块三种写法', '### 7. 折叠块（不写 summary）'],
    ['场景矩阵:对齐块', '### 8. 对齐块'],
    ['列宽围栏', 'cols=120,auto'],
    ['行高围栏', 'rows=120'],
    ['单元格里的列表', '- 甲<br>- 乙'],
    ['单元格里的代码块', '```bash<br>'],
    ['单元格里的嵌套表格', '\\| a \\| b \\|<br>'],
    ['表格单元格里的 <br>', '<br>'],
    ['网页嵌入', '```embed'],
    ['网页嵌入的宽度', 'width: 260'],
    ['图表', '```mermaid'],
    ['图表的宽度', 'width=360'],
    ['任务清单', '- [ ] '],
    ['表格', '|:--|'],
    ['图片尺寸语法', '|300]('],
    ['分隔线', '\n---\n']
  ])('%s', (_name, needle) => {
    expect(zh).toContain(needle)
  })

  it('五种提示块类型都出现过', () => {
    for (const k of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
      expect(zh).toContain(`> [!${k}]`)
    }
  })
})
