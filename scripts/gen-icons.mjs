// 从 Lucide 生成图标数据文件。**这是图标唯一的来源** ——
// 加/换图标只改下面的 ICONS 名单，然后重跑：
//   node scripts/gen-icons.mjs
//
// 生成物是 `src/renderer/src/lib/icon-paths.ts`：只保留形状数据（path/circle/…），
// 描边、颜色、尺寸一律由适配器统一给（icon-dom.ts 给 CodeMirror，components/ui/Icon.tsx 给 React）。
//
// 为什么 vendor 而不是装依赖：Lucide 是 ISC 许可，形状数据落进仓库即可，
// 既不加构建依赖，也让「手柄 / 工具条 / 弹框三处图标一致」成为结构保证。

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const VERSION = '1.57.0'
const BASE = `https://unpkg.com/lucide-static@${VERSION}/icons`

/** 需要的图标：Lucide 的名字即生成文件里的键名 */
const ICONS = [
  // 行内格式
  'bold',
  'italic',
  'strikethrough',
  'code',
  'link',
  'eraser',
  'subscript',
  'superscript',
  // 块级格式
  'heading',
  'list',
  'list-ordered',
  'square-check-big',
  'text-quote',
  'square-code',
  'image',
  'square-chevron-down',
  // 块折叠三角:细描边折角,与其余图标同一套笔画语言(收起 → 右,展开 → 下)
  'chevron-right',
  'chevron-down',
  'align-left',
  'align-center',
  'align-right',
  'table',
  'workflow',
  'globe',
  // 块类型徽标
  'pilcrow',
  'info',
  'minus',
  // 媒体（按类型分开：图 / 视频 / 音频 / PDF）
  'file-video',
  'file-audio',
  'file-text',
  // 提示块类型
  'lightbulb',
  'circle-alert',
  'triangle-alert',
  'flame',
  // 菜单动作
  'plus',
  'copy',
  'copy-plus',
  'trash-2',
  'indent-increase',
  'indent-decrease',
  // 手柄
  'grip-vertical'
]

const SHAPE_TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'ellipse', 'polygon'])
// 只留几何属性：class/fill/stroke 由适配器统一给，写进数据只会各写各的
const SHAPE_ATTRS = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'rx',
  'ry',
  'points'
])

function parseShapes(svg) {
  const shapes = []
  const tagRe = /<([a-zA-Z]+)\b([^>]*?)\/?>/g
  let match
  while ((match = tagRe.exec(svg)) !== null) {
    if (!SHAPE_TAGS.has(match[1])) continue
    const attrs = {}
    const attrRe = /([\w-]+)="([^"]*)"/g
    let attr
    while ((attr = attrRe.exec(match[2])) !== null) {
      if (SHAPE_ATTRS.has(attr[1])) attrs[attr[1]] = attr[2]
    }
    shapes.push({ tag: match[1], attrs })
  }
  return shapes
}

const entries = []
for (const name of ICONS) {
  const res = await fetch(`${BASE}/${name}.svg`)
  if (!res.ok) throw new Error(`拉取失败 ${name}: HTTP ${res.status}`)
  const svg = await res.text()
  const shapes = parseShapes(svg)
  if (shapes.length === 0) throw new Error(`${name} 没解析出任何形状`)
  if (!/viewBox="0 0 24 24"/.test(svg)) throw new Error(`${name} 不是 24×24 网格`)
  entries.push([name, shapes])
  console.log(`✓ ${name} (${shapes.length})`)
}

const body = entries
  .map(([name, shapes]) => {
    const list = shapes
      .map((s) => `    { tag: '${s.tag}', attrs: ${JSON.stringify(s.attrs)} }`)
      .join(',\n')
    return `  '${name}': [\n${list}\n  ]`
  })
  .join(',\n')

const out = `// ⚠ 本文件由 scripts/gen-icons.mjs 生成，不要手改 —— 改脚本里的名单后重跑。
// 生成时间：${new Date().toISOString().slice(0, 10)}，来源 lucide-static@${VERSION}
//
// 图标来自 Lucide（https://lucide.dev），ISC 许可：
//   Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of
//   Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
//   Permission to use, copy, modify, and/or distribute this software for any purpose with
//   or without fee is hereby granted, provided that the above copyright notice and this
//   permission notice appear in all copies.
//   THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD
//   TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS.

export interface IconShape {
  tag: string
  attrs: Record<string, string>
}

/** 几何数据。颜色/描边/尺寸由适配器统一给，不在这里各写各的。 */
export const ICON_SHAPES: Record<string, readonly IconShape[]> = {
${body}
}

export type IconName = keyof typeof ICON_SHAPES

/** 24×24 网格 —— 适配器按这个缩放，别改成别的值。 */
export const ICON_VIEWBOX = 24
`

const here = dirname(fileURLToPath(import.meta.url))
const target = join(here, '..', 'src', 'renderer', 'src', 'lib', 'icon-paths.ts')
writeFileSync(target, out)
console.log(`\n写入 ${target}（${entries.length} 个图标）`)
