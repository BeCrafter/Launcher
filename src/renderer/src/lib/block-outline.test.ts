import { describe, expect, it } from 'vitest'
import { makeT } from '../i18n'
import { parseMarkdownBlocks, type BlockSlot } from './markdown-blocks'
import {
  buildMovePickerTargets,
  buildOutlineEntries,
  destinationForSlot,
  filterMovePickerTargets,
  headingTitleOf
} from './block-outline'

const DOC = [
  '# 一',
  '',
  '第一段',
  '',
  '第二段',
  '',
  '## 一甲',
  '',
  '甲段落',
  '',
  '# 二',
  '',
  '二段',
  ''
].join('\n')

function fixture(text = DOC) {
  const lines = text.split('\n')
  const blocks = parseMarkdownBlocks(text)
  const at = (line: number) => blocks.find((block) => block.from === line)!
  const anchors: BlockSlot[] = blocks.map((block, index) => ({
    id: block.id,
    from: block.from,
    to: block.to,
    top: index * 20,
    height: 20
  }))
  return { text, lines, blocks, at, anchors }
}

describe('headingTitleOf', () => {
  it('strips prefixes and closing hashes', () => {
    expect(headingTitleOf('## 乙')).toBe('乙')
    expect(headingTitleOf('### 带 # 的标题 ###')).toBe('带 # 的标题')
    expect(headingTitleOf('#')).toBe('')
    expect(headingTitleOf('##   ')).toBe('')
  })
})

describe('drag outline entries', () => {
  it('lists the edges and every actionable heading in document order', () => {
    const { blocks, lines, anchors, at } = fixture()
    const entries = buildOutlineEntries(blocks, lines, anchors, at(2))
    expect(entries.map((entry) => entry.key)).toEqual([
      'start',
      `h:${at(0).id}`,
      `h:${at(6).id}`,
      `h:${at(10).id}`,
      'end'
    ])
    expect(entries[1].title).toBe('一')
    expect(entries[2].title).toBe('一甲')
    expect(entries[1].level).toBe(1)
    expect(entries[2].level).toBe(2)
    expect(entries[0].target).toEqual({ targetId: at(0).id, before: true })
    expect(entries[4].target).toEqual({ targetId: at(12).id, before: false })
  })

  it('hides headings that are not legal anchors', () => {
    const { blocks, lines, anchors, at } = fixture()
    const withoutH2 = anchors.filter((slot) => slot.id !== at(6).id)
    const entries = buildOutlineEntries(blocks, lines, withoutH2, at(2))
    expect(entries.some((entry) => entry.key === `h:${at(6).id}`)).toBe(false)
  })
})

describe('move picker targets', () => {
  it('offers start, headings, and end', () => {
    const { blocks, lines, at } = fixture()
    const targets = buildMovePickerTargets(blocks, lines, at(2))
    expect(targets[0].group).toBe('start')
    expect(targets.at(-1)?.group).toBe('end')
    expect(targets.filter((target) => target.group === 'heading').map((target) => target.title)).toEqual([
      '一',
      '一甲',
      '二'
    ])
    expect(targets[1].target).toEqual({
      type: 'block',
      locator: { from: 0, kind: 'heading' },
      before: true
    })
  })

  it('falls back to top-level blocks when the document has no headings', () => {
    const text = ['甲', '', '乙', ''].join('\n')
    const lines = text.split('\n')
    const blocks = parseMarkdownBlocks(text)
    const targets = buildMovePickerTargets(blocks, lines, blocks[0])
    expect(targets.filter((target) => target.group === 'block')).toHaveLength(1)
    expect(targets.find((target) => target.group === 'block')?.title).toBe('乙')
  })

  it('offers nothing for nested blocks', () => {
    const text = ['- 甲', '  - 甲一', '  - 甲二', ''].join('\n')
    const lines = text.split('\n')
    const blocks = parseMarkdownBlocks(text)
    const nested = blocks.find((block) => block.from === 1)!
    expect(buildMovePickerTargets(blocks, lines, nested)).toEqual([])
  })

  it('filters by title, type, and edge labels', () => {
    const { blocks, lines, at } = fixture()
    const t = makeT('zh-CN')
    const targets = buildMovePickerTargets(blocks, lines, at(2))
    expect(filterMovePickerTargets(targets, '甲', t).map((target) => target.title)).toEqual(['一甲'])
    expect(filterMovePickerTargets(targets, '文末', t).map((target) => target.group)).toEqual(['end'])
    expect(filterMovePickerTargets(targets, '   ', t)).toHaveLength(targets.length)
  })
})

describe('destination labels', () => {
  it('describes heading and block targets', () => {
    const { blocks, lines, at } = fixture()
    expect(destinationForSlot(blocks, lines, { targetId: at(6).id, before: true })).toMatchObject({
      kind: 'heading',
      level: 2,
      title: '一甲',
      before: true
    })
    expect(destinationForSlot(blocks, lines, { targetId: at(2).id, before: false })).toMatchObject({
      kind: 'block',
      typeLabelKey: 'notes.blockMenu.type.paragraph',
      before: false
    })
    expect(destinationForSlot(blocks, lines, { targetId: 999, before: true })).toBeNull()
  })
})
