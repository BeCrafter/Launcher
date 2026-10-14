// 图标节点工厂：给**原生 DOM** 用（CodeMirror 的手柄浮层不是 React 树）。
// React 那边见 components/ui/Icon.tsx —— 两份适配器读的是同一份几何数据，
// 「手柄 / 工具条 / 弹框三处图标一致」因此是结构保证，不靠自觉。

import { ICON_SHAPES, ICON_VIEWBOX, type IconName } from './icon-paths'

const NS = 'http://www.w3.org/2000/svg'

/** 与 Lucide 原设计一致的描边粗细（24 的网格上取 2）。 */
export const ICON_STROKE = 2

export function iconNode(name: IconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`)
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', String(ICON_STROKE))
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  for (const shape of ICON_SHAPES[name] ?? []) {
    const node = document.createElementNS(NS, shape.tag)
    for (const [key, value] of Object.entries(shape.attrs)) node.setAttribute(key, value)
    svg.append(node)
  }
  return svg
}
