import { describe, expect, it } from 'vitest'
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  MINIMAP_HEIGHT,
  MINIMAP_WIDTH,
  centerOnMapPoint,
  dragView,
  minimapBlocks,
  minimapFrame,
  pointInView,
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

describe('minimapFrame', () => {
  it('空白板只显示当前视口,视口框在小地图里面', () => {
    const frame = minimapFrame([], VIEW, MINIMAP_WIDTH, MINIMAP_HEIGHT)
    expect(frame.viewWidth).toBeGreaterThan(1)
    expect(frame.viewHeight).toBeGreaterThan(1)
    expect(frame.viewX).toBeGreaterThanOrEqual(0)
    expect(frame.viewY).toBeGreaterThanOrEqual(0)
    expect(frame.viewX + frame.viewWidth).toBeLessThanOrEqual(MINIMAP_WIDTH)
    expect(frame.viewY + frame.viewHeight).toBeLessThanOrEqual(MINIMAP_HEIGHT)
  })

  it('视口外的元素也在小地图里,视口框小于整张图', () => {
    const blocks = [{ x: -2000, y: -2000, width: 100, height: 100, color: '#000' }]
    const frame = minimapFrame(blocks, VIEW, MINIMAP_WIDTH, MINIMAP_HEIGHT)
    expect(frame.viewWidth).toBeLessThan(MINIMAP_WIDTH / 2)
    const blockX = frame.originX + blocks[0].x * frame.scale
    expect(blockX).toBeGreaterThanOrEqual(0)
    expect(blockX).toBeLessThan(frame.viewX)
  })
})

describe('导航', () => {
  const blocks = [{ x: 1000, y: 200, width: 80, height: 40, color: '#000' }]
  const frame = minimapFrame(blocks, VIEW, MINIMAP_WIDTH, MINIMAP_HEIGHT)
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
