// 把嵌入卡片画进小地图的缩略图画布。
//
// 输入是基础导出的画布(已经按主题导出过)+ 卡片描述 + 已加载的内容。
// 输出一张新的画布:先抄一份基础导出,再按场景顺序把卡片盖上去。不能就地改
// 基础画布 —— 精修遍要从同一份基础重新合成,快照遍的结果不能污染它。
//
// 已知边界:
// - 卡片层整体盖在原生元素之上,还原不了元素之间的精确 z-order;
// - 子白板只渲染一层,更深的嵌入在子画布上画成类型卡;
// - 地图只有 180×120,这里画的是「看得出是什么」的纹理,不追求逐字可读。

import type { EmbedCard } from './canvas-embed-cards'
import type { CardContent } from './canvas-embed-content'
import type { ContentBounds } from './canvas-minimap'

interface Palette {
  surface: string
  border: string
  text: string
  muted: string
  paper: string
}

const LIGHT: Palette = {
  surface: '#ffffff',
  border: '#c9c9d1',
  text: '#1b1b1f',
  muted: '#70707c',
  paper: '#ffffff'
}

const DARK: Palette = {
  surface: '#151522',
  border: '#3a3a52',
  text: '#e6e6ef',
  muted: '#9a9aae',
  paper: '#ffffff'
}

const SANS = '-apple-system, "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

export interface EmbedPaintInput {
  cards: readonly EmbedCard[]
  contents: ReadonlyMap<string, CardContent>
  bounds: ContentBounds
  theme: 'light' | 'dark'
}

/** 在基础导出上合成卡片,返回一张新画布。 */
export function compositeEmbedCards(
  base: HTMLCanvasElement,
  input: EmbedPaintInput
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = base.width
  canvas.height = base.height
  const context = canvas.getContext('2d')
  if (context === null) return base
  context.drawImage(base, 0, 0)
  paintEmbedCards(context, canvas.width, canvas.height, input)
  return canvas
}

/** 直接画进现有上下文;尺寸用画布实际像素。 */
export function paintEmbedCards(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: EmbedPaintInput
): void {
  const spanX = Math.max(input.bounds.maxX - input.bounds.minX, 1e-6)
  const spanY = Math.max(input.bounds.maxY - input.bounds.minY, 1e-6)
  const sx = width / spanX
  const sy = height / spanY
  const palette = input.theme === 'dark' ? DARK : LIGHT
  const exportSize = { width, height }

  for (const card of input.cards) {
    const w = Math.max(card.rect.width * sx, 0.5)
    const h = Math.max(card.rect.height * sy, 0.5)
    if (w < 1.5 || h < 1.5) continue
    const cx = (card.rect.x + card.rect.width / 2 - input.bounds.minX) * sx
    const cy = (card.rect.y + card.rect.height / 2 - input.bounds.minY) * sy
    const content = input.contents.get(card.id) ?? { mode: 'type' as const }

    ctx.save()
    ctx.translate(cx, cy)
    if (card.rect.angle !== 0) ctx.rotate(card.rect.angle)
    const left = -w / 2
    const top = -h / 2
    // 圆角在极小尺寸下会吃掉整块卡片,按短边收一个上限。
    const radius = Math.min(3, Math.min(w, h) * 0.12)
    roundedRect(ctx, left, top, w, h, radius)
    ctx.clip()
    ctx.fillStyle = palette.surface
    ctx.fillRect(left, top, w, h)

    switch (content.mode) {
      case 'text':
        drawTextCard(ctx, content, { left, top, w, h }, palette)
        break
      case 'image':
        drawContained(ctx, content.image, { left, top, w, h }, 0.02)
        break
      case 'pdf':
        drawPdfCard(ctx, content.canvas, { left, top, w, h }, palette)
        break
      case 'board':
        drawContained(ctx, content.canvas, { left, top, w, h }, 0)
        break
      case 'failed':
        drawTypeCard(ctx, card, { left, top, w, h }, palette)
        break
      default:
        drawTypeCard(ctx, card, { left, top, w, h }, palette)
    }

    if (content.mode === 'failed') drawFailureDot(ctx, left, top, w, h)
    ctx.restore()

    // 描边画在裁剪之外会被卡片的旋转裁掉;重新 clip 一次画在边缘内侧。
    ctx.save()
    ctx.translate(cx, cy)
    if (card.rect.angle !== 0) ctx.rotate(card.rect.angle)
    roundedRect(ctx, left + 0.5, top + 0.5, Math.max(w - 1, 0.5), Math.max(h - 1, 0.5), radius)
    ctx.strokeStyle = palette.border
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
  }
}

interface Box {
  left: number
  top: number
  w: number
  h: number
}

function drawTypeCard(
  ctx: CanvasRenderingContext2D,
  card: EmbedCard,
  box: Box,
  palette: Palette
): void {
  const barWidth = Math.max(1.5, Math.min(5, box.w * 0.045))
  ctx.fillStyle = card.accent
  ctx.fillRect(box.left, box.top, barWidth, box.h)

  const innerLeft = box.left + barWidth
  const innerWidth = box.w - barWidth
  const tokenSize = clamp(box.h * 0.2, 3.5, 11)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = card.accent
  ctx.font = `700 ${tokenSize}px ${SANS}`
  const cx = innerLeft + innerWidth / 2
  const compact = box.w < 26 || box.h < 14
  const cy = compact ? box.top + box.h / 2 : box.top + box.h * 0.44
  ctx.fillText(card.token, cx, cy, Math.max(innerWidth - 2, 1))

  if (!compact && card.label !== '') {
    const labelSize = clamp(box.h * 0.09, 3, 6.5)
    ctx.fillStyle = palette.muted
    ctx.font = `${labelSize}px ${SANS}`
    ctx.fillText(card.label, cx, box.top + box.h * 0.68, Math.max(innerWidth - 4, 1))
  }
}

function drawTextCard(
  ctx: CanvasRenderingContext2D,
  content: { heading: string | null; lines: string[]; mono: boolean },
  box: Box,
  palette: Palette
): void {
  const pad = Math.max(2, Math.min(box.w, box.h) * 0.06)
  const font = content.mono ? MONO : SANS
  let y = box.top + pad
  let budget = box.h - pad * 2
  if (budget <= 2) return

  if (content.heading !== null && content.heading !== '') {
    const size = clamp(box.h * 0.11, 3.5, 9)
    ctx.font = `700 ${size}px ${SANS}`
    ctx.fillStyle = palette.text
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(content.heading, box.left + pad, y, box.w - pad * 2)
    y += size * 1.35
    budget -= size * 1.35
  }

  const size = clamp(box.h * 0.075, 3, 7)
  const lineHeight = size * 1.3
  if (budget < lineHeight) return
  const maxLines = Math.max(1, Math.floor(budget / lineHeight))
  ctx.font = `${size}px ${font}`
  ctx.fillStyle = palette.muted
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  for (const line of content.lines.slice(0, maxLines)) {
    ctx.fillText(line, box.left + pad, y, box.w - pad * 2)
    y += lineHeight
  }
}

function drawPdfCard(
  ctx: CanvasRenderingContext2D,
  page: HTMLCanvasElement,
  box: Box,
  palette: Palette
): void {
  const inset = Math.max(1, Math.min(box.w, box.h) * 0.04)
  ctx.fillStyle = palette.paper
  ctx.fillRect(box.left + inset, box.top + inset, box.w - inset * 2, box.h - inset * 2)
  drawContained(ctx, page, box, inset / Math.max(Math.min(box.w, box.h), 1))
}

function drawContained(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  box: Box,
  insetRatio: number
): void {
  const sourceWidth = imageWidth(source)
  const sourceHeight = imageHeight(source)
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return
  const inset = Math.min(box.w, box.h) * insetRatio
  const availW = Math.max(box.w - inset * 2, 1)
  const availH = Math.max(box.h - inset * 2, 1)
  const scale = Math.min(availW / sourceWidth, availH / sourceHeight)
  const drawW = sourceWidth * scale
  const drawH = sourceHeight * scale
  ctx.drawImage(
    source,
    box.left + (box.w - drawW) / 2,
    box.top + (box.h - drawH) / 2,
    drawW,
    drawH
  )
}

function drawFailureDot(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  w: number,
  h: number
): void {
  const radius = Math.max(1.2, Math.min(w, h) * 0.06)
  const cx = left + w - radius * 1.6
  const cy = top + radius * 1.6
  if (cx - radius < left || cy - radius < top) return
  ctx.fillStyle = '#e03131'
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fill()
}

function imageWidth(source: CanvasImageSource): number {
  const anySource = source as { naturalWidth?: number; width?: number }
  return anySource.naturalWidth ?? anySource.width ?? 0
}

function imageHeight(source: CanvasImageSource): number {
  const anySource = source as { naturalHeight?: number; height?: number }
  return anySource.naturalHeight ?? anySource.height ?? 0
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
