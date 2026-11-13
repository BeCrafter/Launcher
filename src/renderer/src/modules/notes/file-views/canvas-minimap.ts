// 白板角落的小地图。Excalidraw 0.18 没有小地图,这里用它公开的场景元素和视口自己画。
// 每个元素是一块色块,不还原笔画,也看不到嵌进去的文件内容。
// 点空白把视口中心移过去,拖视口框平移,滚轮缩放且让光标下的那一点留住。
// 缩放步长和上下限跟 Excalidraw 0.18 的按钮一致:0.1,最小 0.1,最大 30。

export const MINIMAP_WIDTH = 180
export const MINIMAP_HEIGHT = 120
export const MINIMAP_PAD = 8

export const CANVAS_ZOOM_STEP = 0.1
export const CANVAS_MIN_ZOOM = 0.1
export const CANVAS_MAX_ZOOM = 30

export interface SceneBox {
  x: number
  y: number
  width: number
  height: number
  color: string
}

export interface SceneViewport {
  scrollX: number
  scrollY: number
  zoom: number
  width: number
  height: number
}

export interface MinimapFrame {
  scale: number
  originX: number
  originY: number
  viewX: number
  viewY: number
  viewWidth: number
  viewHeight: number
}

export interface MinimapScene {
  scrollX: number
  scrollY: number
  zoom: number
}

const FALLBACK_COLOR = '#868e96'

/** 把元素收成色块。没有填充色的用描边色,两个都没有就用一种灰色。 */
export function minimapBlocks(
  elements: readonly {
    isDeleted?: boolean
    x: number
    y: number
    width: number
    height: number
    backgroundColor?: string
    strokeColor?: string
  }[]
): SceneBox[] {
  const blocks: SceneBox[] = []
  for (const element of elements) {
    if (element.isDeleted === true) continue
    if (!Number.isFinite(element.width) || !Number.isFinite(element.height)) continue
    if (element.width <= 0 || element.height <= 0) continue
    blocks.push({
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      color: blockColor(element.backgroundColor, element.strokeColor)
    })
  }
  return blocks
}

function blockColor(background: string | undefined, stroke: string | undefined): string {
  if (isPaint(background)) return background
  if (isPaint(stroke)) return stroke
  return FALLBACK_COLOR
}

function isPaint(color: string | undefined): color is string {
  return color !== undefined && color !== '' && color !== 'transparent'
}

/**
 * 小地图怎么装下全部内容和当前视口。
 * 空白板就只显示当前视口,并让它占满小地图。
 */
export function minimapFrame(
  blocks: readonly SceneBox[],
  viewport: SceneViewport,
  mapWidth: number,
  mapHeight: number
): MinimapFrame {
  let minX = viewportLeft(viewport)
  let minY = viewportTop(viewport)
  let maxX = minX + viewport.width / viewport.zoom
  let maxY = minY + viewport.height / viewport.zoom
  for (const block of blocks) {
    minX = Math.min(minX, block.x)
    minY = Math.min(minY, block.y)
    maxX = Math.max(maxX, block.x + block.width)
    maxY = Math.max(maxY, block.y + block.height)
  }
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const innerWidth = Math.max(mapWidth - MINIMAP_PAD * 2, 1)
  const innerHeight = Math.max(mapHeight - MINIMAP_PAD * 2, 1)
  const scale = Math.min(innerWidth / spanX, innerHeight / spanY)
  const originX = MINIMAP_PAD + (innerWidth - spanX * scale) / 2 - minX * scale
  const originY = MINIMAP_PAD + (innerHeight - spanY * scale) / 2 - minY * scale
  const viewX = originX + viewportLeft(viewport) * scale
  const viewY = originY + viewportTop(viewport) * scale
  return {
    scale,
    originX,
    originY,
    viewX,
    viewY,
    viewWidth: Math.max((viewport.width / viewport.zoom) * scale, 1),
    viewHeight: Math.max((viewport.height / viewport.zoom) * scale, 1)
  }
}

function viewportLeft(viewport: SceneViewport): number {
  return -viewport.scrollX
}

function viewportTop(viewport: SceneViewport): number {
  return -viewport.scrollY
}

/** 点在视口框里。拖动从框内开始,框外的点击把视口中心移过去。 */
export function pointInView(frame: MinimapFrame, x: number, y: number): boolean {
  return (
    x >= frame.viewX &&
    x <= frame.viewX + frame.viewWidth &&
    y >= frame.viewY &&
    y <= frame.viewY + frame.viewHeight
  )
}

/** 把小地图上的一点变成视口中心。滚动和缩放不变。 */
export function centerOnMapPoint(
  viewport: SceneViewport,
  frame: MinimapFrame,
  x: number,
  y: number
): MinimapScene {
  const sceneX = (x - frame.originX) / frame.scale
  const sceneY = (y - frame.originY) / frame.scale
  return {
    scrollX: viewport.width / (2 * viewport.zoom) - sceneX,
    scrollY: viewport.height / (2 * viewport.zoom) - sceneY,
    zoom: viewport.zoom
  }
}

/** 拖视口框。抓住的那一点对着场景里同一个位置。 */
export function dragView(
  viewport: SceneViewport,
  frame: MinimapFrame,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): MinimapScene {
  const dx = (toX - fromX) / frame.scale
  const dy = (toY - fromY) / frame.scale
  return {
    scrollX: viewport.scrollX - dx,
    scrollY: viewport.scrollY - dy,
    zoom: viewport.zoom
  }
}

/**
 * 滚轮缩放,光标下的场景点不动。
 * deltaY 为正是缩小,跟浏览器滚轮一致。步长和上下限跟缩放按钮一致。
 */
export function zoomAtMapPoint(
  viewport: SceneViewport,
  frame: MinimapFrame,
  x: number,
  y: number,
  deltaY: number
): MinimapScene {
  const sceneX = (x - frame.originX) / frame.scale
  const sceneY = (y - frame.originY) / frame.scale
  const nextZoom = clampZoom(viewport.zoom + (deltaY < 0 ? CANVAS_ZOOM_STEP : -CANVAS_ZOOM_STEP))
  return {
    scrollX: (sceneX + viewport.scrollX) * (viewport.zoom / nextZoom) - sceneX,
    scrollY: (sceneY + viewport.scrollY) * (viewport.zoom / nextZoom) - sceneY,
    zoom: nextZoom
  }
}

function clampZoom(zoom: number): number {
  return Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, zoom))
}
