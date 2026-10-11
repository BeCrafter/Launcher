// 滚动同步的映射。
//
// 这里守的是「编辑器滚到第 N 行 ↔ 预览滚到第几像素」这一对换算。
// 它是纯函数,所以能在没有 DOM 的环境里钉住;真正读 DOM 的 collectAnchors 只在应用里跑。

import { describe, expect, it } from 'vitest'
import { editorLineFor, previewScrollFor, type LineAnchor } from './scroll-sync'

/** 造一组锚点:第 0/5/10/15 行分别落在 0 / 100 / 500 / 520 像素处 */
const ANCHORS: LineAnchor[] = [
  { line: 0, top: 0 },
  { line: 5, top: 100 },
  { line: 10, top: 500 },
  { line: 15, top: 520 }
]

describe('previewScrollFor', () => {
  it('正好落在锚点上时就是那个锚点的位置', () => {
    expect(previewScrollFor(ANCHORS, 0)).toBe(0)
    expect(previewScrollFor(ANCHORS, 5)).toBe(100)
    expect(previewScrollFor(ANCHORS, 10)).toBe(500)
  })

  it('两个锚点之间线性插值', () => {
    expect(previewScrollFor(ANCHORS, 2.5)).toBe(50)
    expect(previewScrollFor(ANCHORS, 12.5)).toBe(510)
  })

  it('第一块之前返回 0(标题上方的空白)', () => {
    expect(previewScrollFor([{ line: 4, top: 40 }], 0)).toBe(0)
  })

  it('最后一个锚点之后按最后一段的斜率外推(否则底部永远差一截)', () => {
    // 10→15 行之间每行 4px,第 17 行 → 520 + 8
    expect(previewScrollFor(ANCHORS, 17)).toBe(528)
  })

  it('没有锚点(空笔记 / 还没量到)时返回 0,不抛', () => {
    expect(previewScrollFor([], 12)).toBe(0)
  })

  it('单调:行号越大,位置不会往回走', () => {
    let prev = -1
    for (let line = 0; line <= 20; line += 0.5) {
      const v = previewScrollFor(ANCHORS, line)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('锚点行号重复时不会除以 0(取后一个,结果有限)', () => {
    // collectAnchors 会按行号去重,所以这在真实数据里不会发生;
    // 这条只是保证「万一发生了也不会算出 NaN/Infinity」。
    const dup: LineAnchor[] = [
      { line: 3, top: 10 },
      { line: 3, top: 90 }
    ]
    expect(previewScrollFor(dup, 3)).toBe(90)
    expect(Number.isFinite(previewScrollFor(dup, 3))).toBe(true)
    expect(Number.isFinite(editorLineFor(dup, 50))).toBe(true)
  })
})

describe('editorLineFor', () => {
  it('正好落在锚点上时就是那一行', () => {
    expect(editorLineFor(ANCHORS, 0)).toBe(0)
    expect(editorLineFor(ANCHORS, 100)).toBe(5)
    expect(editorLineFor(ANCHORS, 500)).toBe(10)
  })

  it('两个锚点之间线性插值(可以是小数)', () => {
    expect(editorLineFor(ANCHORS, 300)).toBe(7.5)
  })

  it('第一块之上返回第一块的行号,而不是负数', () => {
    expect(editorLineFor([{ line: 4, top: 40 }], 0)).toBe(4)
  })

  it('最后一个锚点之后按最后一段外推', () => {
    expect(editorLineFor(ANCHORS, 540)).toBe(20)
  })

  it('没有锚点时返回 0', () => {
    expect(editorLineFor([], 300)).toBe(0)
  })

  it('往返:两个方向互为逆运算', () => {
    for (const line of [0, 2.5, 5, 7.5, 10, 12.5, 15]) {
      expect(editorLineFor(ANCHORS, previewScrollFor(ANCHORS, line))).toBeCloseTo(line, 6)
    }
  })
})
