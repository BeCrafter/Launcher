// 块手柄用的图标。几何数据来自 `lib/icon-paths.ts`（由 scripts/gen-icons.mjs 从 Lucide 生成），
// 与底部工具条、块菜单**同一份来源** —— 三处图标因此天然一致。
//
// 唯一的例外是**折叠三角**：飞书那颗是**实心**带圆角的三角，而 Lucide 只有描边版本，
// 照搬反而更不像，所以它仍然是这里自绘的一个 path。

import { iconNode } from './icon-dom'
import type { IconName } from './icon-paths'
import type { CalloutKind } from './markdown'

/** 块类型 → 图标名。标题不走这里 —— 它显示 H1/H2/H3 文本（豆包与飞书都是）。 */
const BLOCK_ICON: Record<string, IconName> = {
  paragraph: 'pilcrow',
  listItem: 'list',
  quote: 'text-quote',
  callout: 'info',
  fence: 'square-code',
  table: 'table',
  details: 'square-chevron-down',
  thematicBreak: 'minus'
}

/** 六点抓手。整颗胶囊都是拖拽源，这个图标只是「可以拖」的暗示。 */
export function dragIcon(): SVGSVGElement {
  return iconNode('grip-vertical', 14)
}

export function blockIconName(kind: string): IconName {
  return BLOCK_ICON[kind] ?? 'pilcrow'
}

export function blockIcon(kind: string): SVGSVGElement {
  return iconNode(blockIconName(kind), 14)
}

/**
 * 提示块五种类型在**编辑器 UI**（块菜单）里的图标。
 * ⚠ 预览区那一套仍是 FontAwesome（`lib/markdown.tsx` 的 `CALLOUT_ICON`）—— 两边故意分开：
 * 预览不在本轮范围内，动它要同步改一个测试断言。
 */
export const CALLOUT_ICON_NAMES: Record<CalloutKind, IconName> = {
  note: 'info',
  tip: 'lightbulb',
  important: 'circle-alert',
  warning: 'triangle-alert',
  caution: 'flame'
}

/** 空行上的「插入」按钮用。 */
export function plusIcon(): SVGSVGElement {
  return iconNode('plus', 12)
}

/** 折叠三角：展开时朝下、收起时朝右。实心带圆角，贴着正文，与飞书那颗同形。 */
export function caretIcon(collapsed: boolean): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('fill', 'currentColor')
  svg.setAttribute('aria-hidden', 'true')
  if (collapsed) svg.setAttribute('transform', 'rotate(-90 8 8)')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute(
    'd',
    'M4.2 5.6h7.6c.86 0 1.36.97.86 1.67l-3.8 5.03a1.02 1.02 0 0 1-1.72 0L3.34 7.27c-.5-.7 0-1.67.86-1.67z'
  )
  svg.append(path)
  return svg
}

/** 标题的类型标识用文本（豆包与飞书都是这样），不画图标。 */
export function headingText(level: number): string {
  return `H${Math.min(Math.max(level, 1), 6)}`
}
