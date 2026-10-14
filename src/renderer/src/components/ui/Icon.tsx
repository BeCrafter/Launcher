import { createElement } from 'react'
import { ICON_SHAPES, ICON_VIEWBOX, type IconName } from '../../lib/icon-paths'
import { ICON_STROKE } from '../../lib/icon-dom'

/**
 * 图标（React 版）。
 *
 * 与 `lib/icon-dom.ts` 读**同一份几何数据** —— 手柄浮层（原生 DOM）、底部工具条、
 * 块菜单三处的图标因此不可能长得不一样。加/换图标改 `scripts/gen-icons.mjs` 的名单。
 *
 * 用 `createElement` 而不是 JSX 动态标签：形状标签来自数据的字符串，动态 JSX 标签
 * 在 TS 里要一堆断言。
 */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }): React.JSX.Element {
  return createElement(
    'svg',
    {
      viewBox: `0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`,
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: ICON_STROKE,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true'
    },
    (ICON_SHAPES[name] ?? []).map((shape, index) => createElement(shape.tag, { key: index, ...shape.attrs }))
  )
}
