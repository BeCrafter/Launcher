import { describe, expect, it } from 'vitest'
import {
  autoScrollVelocity,
  autoScrollVelocityForViewport,
  dragCardPreview,
  permutedDropTop,
  suppressBlockWash
} from './editor-blocks'
import { parseMarkdownBlocks, type BlockSlot } from './markdown-blocks'

describe('hover wash during typing', () => {
  const blocks = parseMarkdownBlocks('# A\n\npara\n\n# B\n\ntail\n')
  const a = blocks.find((b) => b.kind === 'heading' && b.from === 0)!
  const b = blocks.find((b) => b.kind === 'heading' && b.from === 4)!

  it('suppresses the whole-block wash only when focused inside that block', () => {
    expect(suppressBlockWash(true, 0, a)).toBe(true)
    expect(suppressBlockWash(true, 2, a)).toBe(true)
    expect(suppressBlockWash(false, 0, a)).toBe(false)
    expect(suppressBlockWash(true, 0, b)).toBe(false)
    expect(suppressBlockWash(true, 6, a)).toBe(false)
  })
})

describe('dragCardPreview', () => {
  it('短段落原样显示,不加省略', () => {
    const text = '甲\n乙\n'
    const block = parseMarkdownBlocks(text)[0]
    expect(dragCardPreview(text.split('\n'), block)).toEqual({ lines: ['甲', '乙'], truncated: false })
  })

  it('超过 6 行的围栏只取前 6 行', () => {
    const text = ['```', ...Array.from({ length: 8 }, (_, i) => `line ${i + 1}`), '```', ''].join('\n')
    const block = parseMarkdownBlocks(text).find((candidate) => candidate.kind === 'fence')!
    const preview = dragCardPreview(text.split('\n'), block)
    expect(preview.lines).toHaveLength(6)
    expect(preview.lines[0]).toBe('```')
    expect(preview.lines[5]).toBe('line 5')
    expect(preview.truncated).toBe(true)
  })

  it('恰好 6 行不标记截断', () => {
    const text = ['```', 'a', 'b', 'c', 'd', '```', ''].join('\n')
    const block = parseMarkdownBlocks(text).find((candidate) => candidate.kind === 'fence')!
    expect(dragCardPreview(text.split('\n'), block)).toEqual({
      lines: ['```', 'a', 'b', 'c', 'd', '```'],
      truncated: false
    })
  })

  it('标题块连同子树一起移动,预览取子树开头几行', () => {
    const text = '# 标题\n\n正文\n'
    const block = parseMarkdownBlocks(text).find((candidate) => candidate.kind === 'heading')!
    expect(dragCardPreview(text.split('\n'), block)).toEqual({
      lines: ['# 标题', '', '正文'],
      truncated: false
    })
  })

  it('超长单行按字符数截断并以省略号结尾', () => {
    const text = 'x'.repeat(200) + '\n'
    const block = parseMarkdownBlocks(text)[0]
    const preview = dragCardPreview(text.split('\n'), block)
    expect(preview.lines).toHaveLength(1)
    expect(preview.lines[0]).toHaveLength(120)
    expect(preview.lines[0].endsWith('…')).toBe(true)
    expect(preview.truncated).toBe(true)
  })

  it('空范围兜底为一行,不抛异常', () => {
    const text = '甲\n'
    const block = parseMarkdownBlocks(text)[0]
    expect(dragCardPreview([], { ...block, contentTo: 0 })).toEqual({ lines: [''], truncated: false })
  })
})

describe('permutedDropTop', () => {
  const slots: BlockSlot[] = [
    { id: 1, from: 0, to: 2, top: 0, height: 40 },
    { id: 2, from: 2, to: 4, top: 40, height: 20 }
  ]

  it('源块顶部 + 自己的置换位移', () => {
    expect(permutedDropTop(slots, new Map([[2, -40]]), 2)).toBe(0)
    expect(permutedDropTop(slots, new Map([[1, 20]]), 1)).toBe(20)
  })

  it('没有位移时就是原位', () => {
    expect(permutedDropTop(slots, new Map(), 2)).toBe(40)
  })

  it('源块不在槽位里返回 null', () => {
    expect(permutedDropTop(slots, new Map(), 9)).toBeNull()
  })
})

describe('autoScrollVelocity', () => {
  it('中间不滚,上下边缘按距离加速', () => {
    expect(autoScrollVelocity(300, 100, 500)).toBe(0)
    expect(autoScrollVelocity(140, 100, 500)).toBe(-3)
    expect(autoScrollVelocity(100, 100, 500)).toBe(-16)
    expect(autoScrollVelocity(460, 100, 500)).toBe(3)
    expect(autoScrollVelocity(500, 100, 500)).toBe(16)
    expect(autoScrollVelocity(0, 100, 500)).toBe(-16)
  })

  it('边缘带与最大速度可调', () => {
    expect(autoScrollVelocity(125, 100, 500, 20, 8)).toBe(0)
    expect(autoScrollVelocity(115, 100, 500, 20, 8)).toBe(-2)
    expect(autoScrollVelocity(100, 100, 500, 20, 8)).toBe(-8)
  })
})

describe('autoScrollVelocityForViewport', () => {
  it('中间不滚;边缘带与速度按视口高度推算', () => {
    // 高 400 → 边缘带 72,最大速度 16(与旧默认值同一档)
    expect(autoScrollVelocityForViewport(300, 100, 500)).toBe(0)
    expect(autoScrollVelocityForViewport(140, 100, 500)).toBe(-8)
    expect(autoScrollVelocityForViewport(100, 100, 500)).toBe(-16)
    expect(autoScrollVelocityForViewport(500, 100, 500)).toBe(16)
  })

  it('贴边停留越久越快,1 秒封顶 2×', () => {
    expect(autoScrollVelocityForViewport(100, 100, 500, 500)).toBe(-24)
    expect(autoScrollVelocityForViewport(100, 100, 500, 1000)).toBe(-32)
    expect(autoScrollVelocityForViewport(100, 100, 500, 5000)).toBe(-32)
  })

  it('速度上限随视口变化,但有上下限', () => {
    // 高 100 → 上限 16;高 2000 → 上限 40
    expect(autoScrollVelocityForViewport(100, 100, 200)).toBe(-16)
    expect(autoScrollVelocityForViewport(100, 100, 2100)).toBe(-40)
  })
})
