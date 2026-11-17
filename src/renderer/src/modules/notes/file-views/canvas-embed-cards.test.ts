import { describe, expect, it } from 'vitest'
import {
  EMBED_CONTENT_MAX,
  embedCards,
  pickContentCards,
  sceneRectToCanvas,
  type EmbedCard,
  type EmbedCardElement
} from './canvas-embed-cards'

function embed(
  id: string,
  customData: unknown,
  overrides: Partial<EmbedCardElement> = {}
): EmbedCardElement {
  return {
    id,
    type: 'embeddable',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    customData,
    ...overrides
  }
}

function note(id: string): unknown {
  return { launcher: { kind: 'note', id } }
}

function file(path: string): unknown {
  return { launcher: { kind: 'file', path } }
}

describe('embedCards', () => {
  it('跳过删除、非 embeddable、尺寸非法的元素', () => {
    const cards = embedCards([
      embed('a', note('a'), { isDeleted: true }),
      embed('b', note('b'), { type: 'rectangle' }),
      embed('c', note('c'), { width: 0 }),
      embed('d', note('d'), { height: Number.NaN }),
      embed('e', note('e'))
    ])
    expect(cards.map((card) => card.id)).toEqual(['e'])
  })

  it('笔记 → 正文卡,库内文件按类型分流', () => {
    const cards = embedCards([
      embed('note', note('笔记')),
      embed('md', file('文档/说明.md')),
      embed('code', file('src/main.ts')),
      embed('csv', file('数据.csv')),
      embed('img', file('图/红图.svg')),
      embed('pdf', file('手册.pdf')),
      embed('board', file('子白板.excal')),
      embed('draw', file('流程.drawio')),
      embed('zip', file('包.zip'))
    ])
    expect(cards.map((card) => [card.id, card.kind, card.mode, card.token])).toEqual([
      ['note', 'note', 'text', 'NOTE'],
      ['md', 'markdown', 'text', 'MD'],
      ['code', 'code', 'text', 'TS'],
      ['csv', 'csv', 'text', 'CSV'],
      ['img', 'image', 'image', 'SVG'],
      ['pdf', 'pdf', 'pdf', 'PDF'],
      ['board', 'canvas', 'board', 'BOARD'],
      ['draw', 'drawio', 'type', 'DRAW'],
      ['zip', 'archive', 'type', 'ZIP']
    ])
  })

  it('子白板嵌自己不再递归导出', () => {
    const [card] = embedCards([embed('self', file('本板.excal'))], {
      boardPath: '本板.excal',
      depth: 0
    })
    expect(card.mode).toBe('type')
  })

  it('depth ≥ 1 时更深的子白板退成类型卡', () => {
    const [card] = embedCards([embed('inner', file('子白板.excal'))], {
      boardPath: '本板.excal',
      depth: 1
    })
    expect(card.mode).toBe('type')
    expect(card.kind).toBe('canvas')
  })

  it('库外白板没有可信库内路径,也退成类型卡;其他库外文件照常读内容', () => {
    const cards = embedCards([
      embed('ext-board', {
        embed: { source: '/tmp/board.excal', project: '', host: 'h' }
      }),
      embed('ext-pdf', { embed: { source: '/tmp/手册.pdf', project: '', host: 'h' } })
    ])
    expect(cards.map((card) => [card.id, card.mode])).toEqual([
      ['ext-board', 'type'],
      ['ext-pdf', 'pdf']
    ])
  })

  it('网页只有类型卡,不占内容加载配额', () => {
    const [card] = embedCards([embed('web', null, { link: 'https://example.com/a' })])
    expect(card.kind).toBe('web')
    expect(card.mode).toBe('type')
    expect(card.cacheKey).toBeNull()
    expect(card.label).toBe('example.com')
  })

  it('同一文件嵌两次缓存键相同,笔记/图片文件名进 label', () => {
    const cards = embedCards([
      embed('a', file('图/红图.png')),
      embed('b', file('图/红图.png')),
      embed('c', note('日记'))
    ])
    expect(cards[0].cacheKey).toBe(cards[1].cacheKey)
    expect(cards[0].label).toBe('红图.png')
    expect(cards[2].label).toBe('日记')
  })
})

describe('sceneRectToCanvas', () => {
  const bounds = { minX: 100, minY: 50, maxX: 500, maxY: 350 }
  const exportSize = { width: 400, height: 300 }

  it('把场景矩形线性映射到导出画布', () => {
    expect(
      sceneRectToCanvas({ x: 200, y: 100, width: 100, height: 50, angle: 0 }, bounds, exportSize)
    ).toEqual({ x: 100, y: 50, width: 100, height: 50 })
  })

  it('旋转卡片返回四角 AABB', () => {
    const rect = sceneRectToCanvas(
      { x: 200, y: 100, width: 100, height: 50, angle: Math.PI / 4 },
      bounds,
      exportSize
    )
    // 45° 下 AABB 边长为 (w+h)/√2 ≈ 106.07 场景单位,按 1:1 缩放。
    expect(rect.width).toBeCloseTo((100 + 50) / Math.SQRT2, 4)
    expect(rect.height).toBeCloseTo((100 + 50) / Math.SQRT2, 4)
    expect(rect.x).toBeCloseTo(150 - rect.width / 2, 4)
    expect(rect.y).toBeCloseTo(75 - rect.height / 2, 4)
  })
})

describe('pickContentCards', () => {
  const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
  const exportSize = { width: 1000, height: 1000 }

  function card(id: string, mode: EmbedCard['mode'], area: number): EmbedCard {
    const side = Math.sqrt(area)
    return {
      id,
      kind: mode,
      mode,
      badge: 'vault',
      token: 'T',
      accent: '#000',
      label: id,
      rect: { x: 0, y: 0, width: side, height: side, angle: 0 },
      source: { kind: 'file', path: `${id}.pdf` },
      cacheKey: `file:${id}`
    }
  }

  it('只挑内容卡,按面积取最大的,再按场景顺序返回', () => {
    const cards = [
      card('small', 'text', 10),
      card('web', 'type', 100000),
      card('big', 'image', 10000),
      card('mid', 'pdf', 4000)
    ]
    expect(pickContentCards(cards, exportSize, bounds).map((entry) => entry.id)).toEqual([
      'big',
      'mid'
    ])
  })

  it('数量受上限约束,面积太小的不读', () => {
    const cards = Array.from({ length: EMBED_CONTENT_MAX + 4 }, (_, index) =>
      card(`c${index}`, 'text', 100 + index * 10)
    )
    expect(pickContentCards(cards, exportSize, bounds)).toHaveLength(EMBED_CONTENT_MAX)
    expect(pickContentCards([card('dot', 'image', 4)], exportSize, bounds)).toEqual([])
  })
})
