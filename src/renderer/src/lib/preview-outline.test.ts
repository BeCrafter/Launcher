import { describe, expect, it } from 'vitest'
import {
  buildPreviewOutline,
  outlineEdgeEnds,
  outlineTickScrollTarget,
  pickActiveHeadingKey,
  pinnedActiveKey,
  plainHeadingTitle,
  stepOutlineEdgeScroll,
  stepOutlineFollow,
  visibleHeadingKeys
} from './preview-outline'

const TREE = [
  '# 甲',
  '',
  '甲正文。',
  '',
  '## 乙',
  '',
  '乙正文。',
  '',
  '### 丙',
  '',
  '丙正文。',
  '',
  '## 丁',
  '',
  '丁正文。',
  '',
  '# 戊',
  '',
  '戊正文。'
].join('\n')

describe('buildPreviewOutline', () => {
  it('按层级建树:标题、行号、父子、深度、可折叠', () => {
    const outline = buildPreviewOutline(TREE)
    expect(outline.headings.map((h) => [h.title, h.level, h.line, h.depth, h.parentKey])).toEqual([
      ['甲', 1, 0, 0, null],
      ['乙', 2, 4, 1, '甲'],
      ['丙', 3, 8, 2, '乙'],
      ['丁', 2, 12, 1, '甲'],
      ['戊', 1, 16, 0, null]
    ])
    expect(outline.minLevel).toBe(1)
    expect(outline.headings[0].childKeys).toEqual(['乙', '丁'])
    expect(outline.headings.every((h) => h.foldable)).toBe(true)
  })

  it('跳过代码围栏、引用、折叠块、缩进与裸 #', () => {
    const src = [
      '# 真一',
      '',
      '正文。',
      '',
      '```md',
      '# 代码里的标题',
      '```',
      '',
      '> ## 引用里的标题',
      '',
      '<details>',
      '<summary>点开</summary>',
      '',
      '## 折叠块里的标题',
      '',
      '</details>',
      '',
      '  ## 缩进的标题',
      '',
      '##',
      '',
      '#标签不是标题',
      '',
      '## 真二',
      '',
      '正文二。'
    ].join('\n')
    expect(buildPreviewOutline(src).headings.map((h) => h.title)).toEqual(['真一', '真二'])
  })

  it('同名标题键不重复,且插一段正文不会改变键', () => {
    const src = ['# 重复', '', '正文。', '', '## 重复', '', '正文二。', '', '### 重复', '', '正文三。'].join('\n')
    expect(buildPreviewOutline(src).headings.map((h) => h.key)).toEqual([
      '重复',
      '重复#2',
      '重复#3'
    ])
    const shifted = ['开头新段落。', '', src].join('\n')
    expect(buildPreviewOutline(shifted).headings.map((h) => h.key)).toEqual([
      '重复',
      '重复#2',
      '重复#3'
    ])
  })

  it('后面紧接同级/更高级标题、或只有空行时不可折叠', () => {
    const src = ['# 甲', '', '# 乙', '', '## 丙', '', '# 丁'].join('\n')
    const outline = buildPreviewOutline(src)
    expect(outline.headings.map((h) => [h.title, h.foldable])).toEqual([
      ['甲', false],
      ['乙', true],
      ['丙', false],
      ['丁', false]
    ])
  })
})

describe('visibleHeadingKeys', () => {
  const outline = buildPreviewOutline(TREE)

  it('折叠一节只藏它的后代,自己与兄弟仍在', () => {
    const visible = visibleHeadingKeys(outline.headings, new Set(['甲']))
    expect([...visible]).toEqual(['甲', '戊'])
  })

  it('嵌套折叠不会漏出孙级', () => {
    const visible = visibleHeadingKeys(outline.headings, new Set(['乙', '甲']))
    expect([...visible]).toEqual(['甲', '戊'])
  })

  it('只折子级时父级照常显示', () => {
    const visible = visibleHeadingKeys(outline.headings, new Set(['乙']))
    expect([...visible]).toEqual(['甲', '乙', '丁', '戊'])
  })
})

describe('pickActiveHeadingKey', () => {
  const positions = [
    { key: 'a', top: 0 },
    { key: 'b', top: 100 },
    { key: 'c', top: 200 }
  ]

  it('文首取第一个,越过偏移量后取最后一个越过的', () => {
    expect(pickActiveHeadingKey(positions, 0)).toBe('a')
    expect(pickActiveHeadingKey(positions, 60)).toBe('a') // 60 + 28 < 100
    expect(pickActiveHeadingKey(positions, 80)).toBe('b')
    expect(pickActiveHeadingKey(positions, 900)).toBe('c')
  })

  it('空列表返回 null,跳过非有限值', () => {
    expect(pickActiveHeadingKey([], 0)).toBeNull()
    expect(pickActiveHeadingKey([{ key: 'x', top: Number.NaN }], 0)).toBe('x')
  })
})

describe('pinnedActiveKey', () => {
  const pin = { key: 'c', scrollTop: 400 }

  it('滚动还停在落点时用被点的标题,不用侦察结果', () => {
    expect(pinnedActiveKey('a', pin, 400)).toBe('c')
    expect(pinnedActiveKey('a', pin, 400.4)).toBe('c')
  })

  it('滚动位置一变就放弃钉,改跟侦察', () => {
    expect(pinnedActiveKey('b', pin, 320)).toBe('b')
    expect(pinnedActiveKey(null, pin, 0)).toBeNull()
  })

  it('没有钉时跟侦察', () => {
    expect(pinnedActiveKey('a', null, 400)).toBe('a')
  })
})

describe('plainHeadingTitle', () => {
  it('去掉收尾 # 与行内标记', () => {
    expect(plainHeadingTitle('**加粗** 标题 ##')).toBe('加粗 标题')
    expect(plainHeadingTitle('`代码` ~~旧~~ ==新==')).toBe('代码 旧 新')
    expect(plainHeadingTitle('<span>甲</span>')).toBe('甲')
  })

  it('链接与 wikilink 只留可读文字', () => {
    expect(plainHeadingTitle('[链接文字](https://x.test)')).toBe('链接文字')
    expect(plainHeadingTitle('[[目标|别名]]')).toBe('别名')
    expect(plainHeadingTitle('![[图.png]]')).toBe('图.png')
  })

  it('全是标记时退回原文,不产出空标题', () => {
    expect(plainHeadingTitle('**')).toBe('**')
  })
})

describe('stepOutlineEdgeScroll', () => {
  const rail = { height: 160, edge: 22, speed: 100, maxScroll: 200 }

  it('没得滚时停在 0', () => {
    expect(
      stepOutlineEdgeScroll({ ...rail, scrollTop: 40, maxScroll: 0, pointerY: 0, dt: 1 })
    ).toBe(0)
    expect(
      stepOutlineEdgeScroll({ ...rail, scrollTop: 0, maxScroll: 0, pointerY: 150, dt: 1 })
    ).toBe(0)
  })

  it('上缘向上、下缘向下,中间不动', () => {
    // 0.25 秒 × 100px/s = 25px;上缘 y=0,下缘 y=150(160-22=138),中间 y=80
    expect(stepOutlineEdgeScroll({ ...rail, scrollTop: 40, pointerY: 0, dt: 0.25 })).toBe(15)
    expect(stepOutlineEdgeScroll({ ...rail, scrollTop: 40, pointerY: 150, dt: 0.25 })).toBe(65)
    expect(stepOutlineEdgeScroll({ ...rail, scrollTop: 40, pointerY: 80, dt: 1 })).toBe(40)
  })

  it('到头夹住', () => {
    expect(stepOutlineEdgeScroll({ ...rail, scrollTop: 5, pointerY: 0, dt: 1 })).toBe(0)
    expect(stepOutlineEdgeScroll({ ...rail, scrollTop: 190, pointerY: 150, dt: 1 })).toBe(200)
  })
})

describe('outlineEdgeEnds', () => {
  it('装得下时两边都没有', () => {
    expect(outlineEdgeEnds(0, 0)).toEqual({ above: false, below: false })
  })

  it('到头的一侧不报还有,1px 以内算同一头', () => {
    expect(outlineEdgeEnds(0, 100)).toEqual({ above: false, below: true })
    expect(outlineEdgeEnds(0.4, 100)).toEqual({ above: false, below: true })
    expect(outlineEdgeEnds(100, 100)).toEqual({ above: true, below: false })
    expect(outlineEdgeEnds(99.5, 100)).toEqual({ above: true, below: false })
    expect(outlineEdgeEnds(40, 100)).toEqual({ above: true, below: true })
  })
})

describe('outlineTickScrollTarget', () => {
  const rail = { maxScroll: 400, tickHeight: 2, viewHeight: 160, padding: 22 }

  it('居中越过两头时才夹到 0 或上限', () => {
    expect(outlineTickScrollTarget({ ...rail, scrollTop: 40, tickTop: 8 })).toBe(0)
    expect(outlineTickScrollTarget({ ...rail, scrollTop: 80, maxScroll: 200, tickTop: 358 })).toBe(200)
  })

  it('已经在渐隐以内就不动栏', () => {
    // 安全段是 [122, 238],刻度在 [200, 202]
    expect(outlineTickScrollTarget({ ...rail, scrollTop: 100, tickTop: 200 })).toBe(100)
  })

  it('踩出渐隐时放到视口中央,不贴到渐隐边上', () => {
    // 安全段是 [152, 268],刻度在 [140, 142],滚到顶又会探进下缘渐隐
    expect(outlineTickScrollTarget({ ...rail, scrollTop: 130, tickTop: 140 })).toBe(61)
    expect(outlineTickScrollTarget({ ...rail, scrollTop: 0, tickTop: 150 })).toBe(71)
  })

  it('贴着渐隐内沿不动,探出去才回到中央', () => {
    // 槽停在 100 时,没被盖住的是 [122, 238]
    expect(outlineTickScrollTarget({ ...rail, scrollTop: 100, tickTop: 122 })).toBe(100)
    expect(outlineTickScrollTarget({ ...rail, scrollTop: 100, tickTop: 121 })).toBe(42)
  })

  it('头尾放得进窗口也不提前贴边,只在居中越过时才夹住', () => {
    // 顶上剩下的刻度放得进 160px,旧规则会直接回 0;中心还在 21,就停在 21。
    expect(outlineTickScrollTarget({ ...rail, scrollTop: 80, tickTop: 100 })).toBe(21)
    // 滚到底就能露出这根,旧规则会贴到上限 400;中心在 351,不能为了露尾贴底。
    expect(outlineTickScrollTarget({ ...rail, scrollTop: 100, tickTop: 430 })).toBe(351)
  })
})

describe('stepOutlineFollow', () => {
  it('走一步朝目标靠,不越过,快到了就落定', () => {
    const mid = stepOutlineFollow(0, 100, 90)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(100)
    expect(stepOutlineFollow(0, 100, 180)).toBe(100)
    expect(stepOutlineFollow(0, 0.4, 0)).toBe(0.4)
  })

  it('还没开始停在原地,往回走也不越过,时长为 0 直接落定', () => {
    expect(stepOutlineFollow(40, 100, 0)).toBe(40)
    const back = stepOutlineFollow(100, 0, 90)
    expect(back).toBeGreaterThan(0)
    expect(back).toBeLessThan(100)
    expect(stepOutlineFollow(40, 100, 0, 0)).toBe(100)
  })
})
