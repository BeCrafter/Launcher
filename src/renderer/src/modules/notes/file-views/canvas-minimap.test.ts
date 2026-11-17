import { describe, expect, it } from 'vitest'
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  MINIMAP_HEIGHT,
  MINIMAP_WIDTH,
  boundsOfBlocks,
  centerOnMapPoint,
  dragView,
  minimapBlocks,
  minimapFrame,
  minimapOpenFrom,
  pointInView,
  sceneRectToMap,
  thumbnailRect,
  zoomAtMapPoint,
  type SceneViewport
} from './canvas-minimap'

const VIEW: SceneViewport = {
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
  width: 800,
  height: 600
}

function scenePointOf(viewport: SceneViewport, clientX: number, clientY: number): {
  x: number
  y: number
} {
  return {
    x: clientX / viewport.zoom - viewport.scrollX,
    y: clientY / viewport.zoom - viewport.scrollY
  }
}

describe('minimapOpenFrom', () => {
  it('默认收起,只有手动打开过(记成 true)才展开', () => {
    expect(minimapOpenFrom(null)).toBe(false)
    expect(minimapOpenFrom('false')).toBe(false)
    expect(minimapOpenFrom('')).toBe(false)
    expect(minimapOpenFrom('随便什么')).toBe(false)
    expect(minimapOpenFrom('true')).toBe(true)
  })
})

describe('minimapBlocks', () => {
  it('只留还在的元素,透明填充改用描边色', () => {
    expect(
      minimapBlocks([
        { x: 0, y: 0, width: 10, height: 10, backgroundColor: '#ff0000', isDeleted: true },
        { x: 1, y: 2, width: 30, height: 40, backgroundColor: 'transparent', strokeColor: '#228be6' },
        { x: 5, y: 6, width: 0, height: 10, backgroundColor: '#000' }
      ])
    ).toEqual([{ x: 1, y: 2, width: 30, height: 40, color: '#228be6' }])
  })
})

describe('boundsOfBlocks', () => {
  it('空板返回 null,否则取所有色块的外接框', () => {
    expect(boundsOfBlocks([])).toBeNull()
    expect(
      boundsOfBlocks([
        { x: -10, y: 5, width: 20, height: 30, color: '#000' },
        { x: 40, y: -20, width: 10, height: 10, color: '#000' }
      ])
    ).toEqual({ minX: -10, minY: -20, maxX: 50, maxY: 35 })
  })
})

describe('thumbnailRect', () => {
  it('内容框按 frame 的 scale/origin 落在小地图上', () => {
    const bounds = { minX: 100, minY: 50, maxX: 300, maxY: 210 }
    const frame = minimapFrame(bounds, VIEW, MINIMAP_WIDTH, MINIMAP_HEIGHT)
    const rect = thumbnailRect(bounds, frame)
    expect(rect.x).toBeCloseTo(frame.originX + 100 * frame.scale, 6)
    expect(rect.y).toBeCloseTo(frame.originY + 50 * frame.scale, 6)
    expect(rect.width).toBeCloseTo(200 * frame.scale, 6)
    expect(rect.height).toBeCloseTo(160 * frame.scale, 6)
  })

  it('内容在视口外也按同一套坐标落位,不会跑出外接框', () => {
    const bounds = { minX: 5000, minY: 4000, maxX: 5100, maxY: 4080 }
    const frame = minimapFrame(bounds, VIEW, MINIMAP_WIDTH, MINIMAP_HEIGHT)
    const rect = thumbnailRect(bounds, frame)
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.width).toBeLessThanOrEqual(MINIMAP_WIDTH)
    expect(rect.y).toBeGreaterThanOrEqual(0)
    expect(rect.y + rect.height).toBeLessThanOrEqual(MINIMAP_HEIGHT)
  })
})

describe('sceneRectToMap', () => {
  it('场景矩形按内容外接框缩到小地图的内容区域里', () => {
    const bounds = { minX: 100, minY: 50, maxX: 500, maxY: 350 }
    const content = { x: 10, y: 20, width: 160, height: 90 }
    expect(
      sceneRectToMap({ x: 300, y: 150, width: 100, height: 50 }, bounds, content)
    ).toEqual({ x: 90, y: 50, width: 40, height: 15 })
  })

  it('外接框退化成一点时也不除零', () => {
    const rect = sceneRectToMap(
      { x: 0, y: 0, width: 10, height: 10 },
      { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      { x: 0, y: 0, width: 100, height: 100 }
    )
    expect(Number.isFinite(rect.x)).toBe(true)
    expect(Number.isFinite(rect.width)).toBe(true)
  })
})

describe('minimapFrame', () => {
  it('空白板只显示当前视口,视口框在小地图里面', () => {
    const frame = minimapFrame(null, VIEW, MINIMAP_WIDTH, MINIMAP_HEIGHT)
    expect(frame.viewWidth).toBeGreaterThan(1)
    expect(frame.viewHeight).toBeGreaterThan(1)
    expect(frame.viewX).toBeGreaterThanOrEqual(0)
    expect(frame.viewY).toBeGreaterThanOrEqual(0)
    expect(frame.viewX + frame.viewWidth).toBeLessThanOrEqual(MINIMAP_WIDTH)
    expect(frame.viewY + frame.viewHeight).toBeLessThanOrEqual(MINIMAP_HEIGHT)
  })

  it('视口外的元素也在小地图里,视口框小于整张图', () => {
    const blocks = [{ x: -2000, y: -2000, width: 100, height: 100, color: '#000' }]
    const frame = minimapFrame(boundsOfBlocks(blocks), VIEW, MINIMAP_WIDTH, MINIMAP_HEIGHT)
    expect(frame.viewWidth).toBeLessThan(MINIMAP_WIDTH / 2)
    const blockX = frame.originX + blocks[0].x * frame.scale
    expect(blockX).toBeGreaterThanOrEqual(0)
    expect(blockX).toBeLessThan(frame.viewX)
  })
})

describe('导航', () => {
  const blocks = [{ x: 1000, y: 200, width: 80, height: 40, color: '#000' }]
  const frame = minimapFrame(boundsOfBlocks(blocks), VIEW, MINIMAP_WIDTH, MINIMAP_HEIGHT)
  const blockX = frame.originX + 1040 * frame.scale
  const blockY = frame.originY + 220 * frame.scale

  it('点空白处,视口中心移到那一点,缩放不变', () => {
    const next = centerOnMapPoint(VIEW, frame, blockX, blockY)
    expect(next.zoom).toBe(1)
    const center = scenePointOf(
      { ...VIEW, scrollX: next.scrollX, scrollY: next.scrollY },
      VIEW.width / 2,
      VIEW.height / 2
    )
    expect(center.x).toBeCloseTo(1040, 4)
    expect(center.y).toBeCloseTo(220, 4)
  })

  it('拖视口框,视口跟着移动同样的场景距离', () => {
    const next = dragView(VIEW, frame, frame.viewX, frame.viewY, frame.viewX + 12, frame.viewY + 8)
    expect(next.scrollX).toBeCloseTo(-12 / frame.scale, 4)
    expect(next.scrollY).toBeCloseTo(-8 / frame.scale, 4)
    expect(next.zoom).toBe(1)
  })

  it('框内是拖,框外是点', () => {
    expect(pointInView(frame, frame.viewX + 1, frame.viewY + 1)).toBe(true)
    expect(pointInView(frame, frame.viewX - 4, frame.viewY - 4)).toBe(false)
  })

  it('滚轮放大时,光标下的场景点不动,并且不超过上限', () => {
    const next = zoomAtMapPoint(VIEW, frame, blockX, blockY, -100)
    expect(next.zoom).toBe(1.1)
    const after = scenePointOf(
      { ...VIEW, scrollX: next.scrollX, scrollY: next.scrollY, zoom: next.zoom },
      scenePointClient(VIEW, 1040, 220).x,
      scenePointClient(VIEW, 1040, 220).y
    )
    expect(after.x).toBeCloseTo(1040, 4)
    expect(after.y).toBeCloseTo(220, 4)

    const capped = zoomAtMapPoint({ ...VIEW, zoom: CANVAS_MAX_ZOOM }, frame, blockX, blockY, -1)
    expect(capped.zoom).toBe(CANVAS_MAX_ZOOM)
    const floored = zoomAtMapPoint({ ...VIEW, zoom: CANVAS_MIN_ZOOM }, frame, blockX, blockY, 1)
    expect(floored.zoom).toBe(CANVAS_MIN_ZOOM)
  })
})

function scenePointClient(
  viewport: SceneViewport,
  sceneX: number,
  sceneY: number
): { x: number; y: number } {
  return {
    x: (sceneX + viewport.scrollX) * viewport.zoom,
    y: (sceneY + viewport.scrollY) * viewport.zoom
  }
}
