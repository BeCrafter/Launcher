import { describe, expect, it } from 'vitest'
import { bubbleActionIds } from './editor-bubble'

const PLAIN = { codeBlock: false, inlineCode: false }

describe('bubbleActionIds', () => {
  it('普通单行文字:九个动作全显示', () => {
    expect(bubbleActionIds('高亮', PLAIN)).toEqual([
      'bold',
      'italic',
      'strike',
      'highlight',
      'code',
      'link',
      'sub',
      'sup',
      'clear'
    ])
  })

  it('只选中空白 / 在代码块里:整条浮条都不出现', () => {
    expect(bubbleActionIds('   \n ', PLAIN)).toBeNull()
    expect(bubbleActionIds('普通文字', { codeBlock: true, inlineCode: false })).toBeNull()
  })

  it('行内代码里只剩「清除格式」', () => {
    expect(bubbleActionIds('码', { codeBlock: false, inlineCode: true })).toEqual(['clear'])
    // 代码里也清不出东西时,浮条整体不出现
    expect(bubbleActionIds('码', { codeBlock: false, inlineCode: true, clearable: false })).toEqual([])
  })

  it('跨行选区:去掉预览里不能跨行的斜体 / 下标 / 上标', () => {
    expect(bubbleActionIds('甲\n乙', PLAIN)).toEqual(['bold', 'strike', 'highlight', 'code', 'link', 'clear'])
  })

  it('选区里已有该动作的标记:不再显示,避免把配对拆坏', () => {
    expect(bubbleActionIds('甲*乙', PLAIN)).not.toContain('italic')
    expect(bubbleActionIds('**粗**', PLAIN)).not.toContain('bold')
    expect(bubbleActionIds('~~删~~', PLAIN)).not.toContain('strike')
    expect(bubbleActionIds('==亮==', PLAIN)).not.toContain('highlight')
    expect(bubbleActionIds('`码`', PLAIN)).not.toContain('code')
    expect(bubbleActionIds('[链接](url)', PLAIN)).not.toContain('link')
    expect(bubbleActionIds('~下~', PLAIN)).not.toContain('sub')
    expect(bubbleActionIds('^上^', PLAIN)).not.toContain('sup')
  })

  it('单字符标记只影响自己那个动作', () => {
    // 单个 `*` 不影响粗体;单个 `~` 不影响删除线
    expect(bubbleActionIds('甲*乙', PLAIN)).toContain('bold')
    expect(bubbleActionIds('甲~乙', PLAIN)).toContain('strike')
    expect(bubbleActionIds('甲~乙', PLAIN)).not.toContain('sub')
    expect(bubbleActionIds('甲^乙', PLAIN)).not.toContain('sup')
    expect(bubbleActionIds('甲^乙', PLAIN)).toContain('sub')
  })

  it('清除格式始终保留(有东西可清时)', () => {
    for (const text of ['普通', '甲*乙', '**粗**', '`码`', '甲\n乙']) {
      expect(bubbleActionIds(text, { ...PLAIN, clearable: true })).toContain('clear')
    }
  })

  it('选区里没有样式时,「清除格式」不出现', () => {
    expect(bubbleActionIds('普通文字', { ...PLAIN, clearable: false })).not.toContain('clear')
    // 其余按钮不受影响
    expect(bubbleActionIds('普通文字', { ...PLAIN, clearable: false })).toEqual([
      'bold',
      'italic',
      'strike',
      'highlight',
      'code',
      'link',
      'sub',
      'sup'
    ])
  })
})
