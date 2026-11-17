// 白板角落的小地图。Excalidraw 0.18 没有小地图,这里用它公开的场景元素和视口自己画。
// 地图主体是整张白板的栅格缩略图(由 exportToCanvas 生成,形状/文字/图片都在);
// 缩略图生成前或失败时退回按元素外接框画的色块,保证地图始终可用。
// 点空白把视口中心移过去,拖视口框平移,滚轮缩放且让光标下的那一点留住。
// 缩放步长和上下限跟 Excalidraw 0.18 的按钮一致:0.1,最小 0.1,最大 30。

export const MINIMAP_WIDTH = 180
export const MINIMAP_HEIGHT = 120
export const MINIMAP_PAD = 8

/** 缩略图长边的栅格上限:180 的地图用 2x,缩小后仍然清晰。 */
export const MINIMAP_THUMB_MAX = 360

export const CANVAS_ZOOM_STEP = 0.1
export const CANVAS_MIN_ZOOM = 0.1
export const CANVAS_MAX_ZOOM = 30

/** 小地图默认收起;只有手动打开过(本地记成 'true')才展开。 */
export function minimapOpenFrom(stored: string | null): boolean {
  return stored === 'true'
}

export interface SceneBox {
  x: number
  y: number
  width: number
  height: number
  color: string
}

/** 内容在场景坐标里的外接框。不用 Excalidraw 导出的同名 tuple,调用方按名字区分。 */
export interface ContentBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface MapRect {
  x: number
  y: number
  width: number
  height: number
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

/** 回退色块的外接框。空板返回 null。 */
export function boundsOfBlocks(blocks: readonly SceneBox[]): ContentBounds | null {
  if (blocks.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const block of blocks) {
    minX = Math.min(minX, block.x)
    minY = Math.min(minY, block.y)
    maxX = Math.max(maxX, block.x + block.width)
    maxY = Math.max(maxY, block.y + block.height)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return { minX, minY, maxX, maxY }
}

/**
 * 小地图怎么装下全部内容和当前视口。
 * 空白板就只显示当前视口,并让它占满小地图。
 */
export function minimapFrame(
  bounds: ContentBounds | null,
  viewport: SceneViewport,
  mapWidth: number,
  mapHeight: number
): MinimapFrame {
  let minX = viewportLeft(viewport)
  let minY = viewportTop(viewport)
  let maxX = minX + viewport.width / viewport.zoom
  let maxY = minY + viewport.height / viewport.zoom
  if (bounds !== null) {
    minX = Math.min(minX, bounds.minX)
    minY = Math.min(minY, bounds.minY)
    maxX = Math.max(maxX, bounds.maxX)
    maxY = Math.max(maxY, bounds.maxY)
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

/** 缩略图在小地图上的落点:和 frame 用同一套场景坐标,旋转元素也不会错位。 */
export function thumbnailRect(bounds: ContentBounds, frame: MinimapFrame): MapRect {
  return {
    x: frame.originX + bounds.minX * frame.scale,
    y: frame.originY + bounds.minY * frame.scale,
    width: Math.max((bounds.maxX - bounds.minX) * frame.scale, 1),
    height: Math.max((bounds.maxY - bounds.minY) * frame.scale, 1)
  }
}

/**
 * 场景矩形 → 小地图逻辑坐标。缩略图区域就是内容外接框的落点,两者线性对应。
 * 给测试读取某块嵌入卡片的位置,不参与绘制。
 */
export function sceneRectToMap(
  rect: { x: number; y: number; width: number; height: number },
  bounds: ContentBounds,
  contentRect: MapRect
): MapRect {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6)
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-6)
  return {
    x: contentRect.x + ((rect.x - bounds.minX) / spanX) * contentRect.width,
    y: contentRect.y + ((rect.y - bounds.minY) / spanY) * contentRect.height,
    width: (rect.width / spanX) * contentRect.width,
    height: (rect.height / spanY) * contentRect.height
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
