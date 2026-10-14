// ⚠ 本文件由 scripts/gen-icons.mjs 生成，不要手改 —— 改脚本里的名单后重跑。
// 生成时间：2026-10-14，来源 lucide-static@1.57.0
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
  'bold': [
    { tag: 'path', attrs: {"d":"M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"} }
  ],
  'italic': [
    { tag: 'line', attrs: {"x1":"19","x2":"10","y1":"4","y2":"4"} },
    { tag: 'line', attrs: {"x1":"14","x2":"5","y1":"20","y2":"20"} },
    { tag: 'line', attrs: {"x1":"15","x2":"9","y1":"4","y2":"20"} }
  ],
  'strikethrough': [
    { tag: 'path', attrs: {"d":"M16 4H9a3 3 0 0 0-2.83 4"} },
    { tag: 'path', attrs: {"d":"M14 12a4 4 0 0 1 0 8H6"} },
    { tag: 'line', attrs: {"x1":"4","x2":"20","y1":"12","y2":"12"} }
  ],
  'code': [
    { tag: 'path', attrs: {"d":"m16 18 6-6-6-6"} },
    { tag: 'path', attrs: {"d":"m8 6-6 6 6 6"} }
  ],
  'link': [
    { tag: 'path', attrs: {"d":"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"} },
    { tag: 'path', attrs: {"d":"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"} }
  ],
  'remove-formatting': [
    { tag: 'path', attrs: {"d":"M4 7V4h16v3"} },
    { tag: 'path', attrs: {"d":"M5 20h6"} },
    { tag: 'path', attrs: {"d":"M13 4 8 20"} },
    { tag: 'path', attrs: {"d":"m15 15 5 5"} },
    { tag: 'path', attrs: {"d":"m20 15-5 5"} }
  ],
  'subscript': [
    { tag: 'path', attrs: {"d":"m4 5 8 8"} },
    { tag: 'path', attrs: {"d":"m12 5-8 8"} },
    { tag: 'path', attrs: {"d":"M20 19h-4c0-1.5.44-2 1.5-2.5S20 15.33 20 14c0-.47-.17-.93-.48-1.29a2.11 2.11 0 0 0-2.62-.44c-.42.24-.74.62-.9 1.07"} }
  ],
  'superscript': [
    { tag: 'path', attrs: {"d":"m4 19 8-8"} },
    { tag: 'path', attrs: {"d":"m12 19-8-8"} },
    { tag: 'path', attrs: {"d":"M20 12h-4c0-1.5.442-2 1.5-2.5S20 8.334 20 7.002c0-.472-.17-.93-.484-1.29a2.105 2.105 0 0 0-2.617-.436c-.42.239-.738.614-.899 1.06"} }
  ],
  'heading': [
    { tag: 'path', attrs: {"d":"M6 12h12"} },
    { tag: 'path', attrs: {"d":"M6 20V4"} },
    { tag: 'path', attrs: {"d":"M18 20V4"} }
  ],
  'list': [
    { tag: 'path', attrs: {"d":"M3 5h.01"} },
    { tag: 'path', attrs: {"d":"M3 12h.01"} },
    { tag: 'path', attrs: {"d":"M3 19h.01"} },
    { tag: 'path', attrs: {"d":"M8 5h13"} },
    { tag: 'path', attrs: {"d":"M8 12h13"} },
    { tag: 'path', attrs: {"d":"M8 19h13"} }
  ],
  'list-ordered': [
    { tag: 'path', attrs: {"d":"M11 5h10"} },
    { tag: 'path', attrs: {"d":"M11 12h10"} },
    { tag: 'path', attrs: {"d":"M11 19h10"} },
    { tag: 'path', attrs: {"d":"M4 4h1v5"} },
    { tag: 'path', attrs: {"d":"M4 9h2"} },
    { tag: 'path', attrs: {"d":"M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02"} }
  ],
  'square-check-big': [
    { tag: 'path', attrs: {"d":"M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344"} },
    { tag: 'path', attrs: {"d":"m9 11 3 3L22 4"} }
  ],
  'text-quote': [
    { tag: 'path', attrs: {"d":"M17 5H3"} },
    { tag: 'path', attrs: {"d":"M21 12H8"} },
    { tag: 'path', attrs: {"d":"M21 19H8"} },
    { tag: 'path', attrs: {"d":"M3 12v7"} }
  ],
  'square-code': [
    { tag: 'path', attrs: {"d":"m10 9-3 3 3 3"} },
    { tag: 'path', attrs: {"d":"m14 15 3-3-3-3"} },
    { tag: 'rect', attrs: {"x":"3","y":"3","width":"18","height":"18","rx":"2"} }
  ],
  'image': [
    { tag: 'rect', attrs: {"width":"18","height":"18","x":"3","y":"3","rx":"2","ry":"2"} },
    { tag: 'circle', attrs: {"cx":"9","cy":"9","r":"2"} },
    { tag: 'path', attrs: {"d":"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"} }
  ],
  'square-chevron-down': [
    { tag: 'rect', attrs: {"width":"18","height":"18","x":"3","y":"3","rx":"2"} },
    { tag: 'path', attrs: {"d":"m16 10-4 4-4-4"} }
  ],
  'align-left': [
    { tag: 'path', attrs: {"d":"M21 5H3"} },
    { tag: 'path', attrs: {"d":"M15 12H3"} },
    { tag: 'path', attrs: {"d":"M17 19H3"} }
  ],
  'align-center': [
    { tag: 'path', attrs: {"d":"M21 5H3"} },
    { tag: 'path', attrs: {"d":"M17 12H7"} },
    { tag: 'path', attrs: {"d":"M19 19H5"} }
  ],
  'align-right': [
    { tag: 'path', attrs: {"d":"M21 5H3"} },
    { tag: 'path', attrs: {"d":"M21 12H9"} },
    { tag: 'path', attrs: {"d":"M21 19H7"} }
  ],
  'table': [
    { tag: 'path', attrs: {"d":"M12 3v18"} },
    { tag: 'rect', attrs: {"width":"18","height":"18","x":"3","y":"3","rx":"2"} },
    { tag: 'path', attrs: {"d":"M3 9h18"} },
    { tag: 'path', attrs: {"d":"M3 15h18"} }
  ],
  'workflow': [
    { tag: 'rect', attrs: {"width":"8","height":"8","x":"3","y":"3","rx":"2"} },
    { tag: 'path', attrs: {"d":"M7 11v4a2 2 0 0 0 2 2h4"} },
    { tag: 'rect', attrs: {"width":"8","height":"8","x":"13","y":"13","rx":"2"} }
  ],
  'globe': [
    { tag: 'circle', attrs: {"cx":"12","cy":"12","r":"10"} },
    { tag: 'path', attrs: {"d":"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"} },
    { tag: 'path', attrs: {"d":"M2 12h20"} }
  ],
  'pilcrow': [
    { tag: 'path', attrs: {"d":"M13 4v16"} },
    { tag: 'path', attrs: {"d":"M17 4v16"} },
    { tag: 'path', attrs: {"d":"M19 4H9.5a4.5 4.5 0 0 0 0 9H13"} }
  ],
  'info': [
    { tag: 'circle', attrs: {"cx":"12","cy":"12","r":"10"} },
    { tag: 'path', attrs: {"d":"M12 16v-4"} },
    { tag: 'path', attrs: {"d":"M12 8h.01"} }
  ],
  'minus': [
    { tag: 'path', attrs: {"d":"M5 12h14"} }
  ],
  'lightbulb': [
    { tag: 'path', attrs: {"d":"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"} },
    { tag: 'path', attrs: {"d":"M9 18h6"} },
    { tag: 'path', attrs: {"d":"M10 22h4"} }
  ],
  'circle-alert': [
    { tag: 'circle', attrs: {"cx":"12","cy":"12","r":"10"} },
    { tag: 'line', attrs: {"x1":"12","x2":"12","y1":"8","y2":"12"} },
    { tag: 'line', attrs: {"x1":"12","x2":"12.01","y1":"16","y2":"16"} }
  ],
  'triangle-alert': [
    { tag: 'path', attrs: {"d":"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"} },
    { tag: 'path', attrs: {"d":"M12 9v4"} },
    { tag: 'path', attrs: {"d":"M12 17h.01"} }
  ],
  'flame': [
    { tag: 'path', attrs: {"d":"M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"} }
  ],
  'plus': [
    { tag: 'path', attrs: {"d":"M5 12h14"} },
    { tag: 'path', attrs: {"d":"M12 5v14"} }
  ],
  'copy': [
    { tag: 'rect', attrs: {"width":"14","height":"14","x":"8","y":"8","rx":"2","ry":"2"} },
    { tag: 'path', attrs: {"d":"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"} }
  ],
  'copy-plus': [
    { tag: 'line', attrs: {"x1":"15","x2":"15","y1":"12","y2":"18"} },
    { tag: 'line', attrs: {"x1":"12","x2":"18","y1":"15","y2":"15"} },
    { tag: 'rect', attrs: {"width":"14","height":"14","x":"8","y":"8","rx":"2","ry":"2"} },
    { tag: 'path', attrs: {"d":"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"} }
  ],
  'trash-2': [
    { tag: 'path', attrs: {"d":"M10 11v6"} },
    { tag: 'path', attrs: {"d":"M14 11v6"} },
    { tag: 'path', attrs: {"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"} },
    { tag: 'path', attrs: {"d":"M3 6h18"} },
    { tag: 'path', attrs: {"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"} }
  ],
  'indent-increase': [
    { tag: 'path', attrs: {"d":"M21 5H11"} },
    { tag: 'path', attrs: {"d":"M21 12H11"} },
    { tag: 'path', attrs: {"d":"M21 19H11"} },
    { tag: 'path', attrs: {"d":"m3 8 4 4-4 4"} }
  ],
  'indent-decrease': [
    { tag: 'path', attrs: {"d":"M21 5H11"} },
    { tag: 'path', attrs: {"d":"M21 12H11"} },
    { tag: 'path', attrs: {"d":"M21 19H11"} },
    { tag: 'path', attrs: {"d":"m7 8-4 4 4 4"} }
  ],
  'grip-vertical': [
    { tag: 'circle', attrs: {"cx":"9","cy":"12","r":"1"} },
    { tag: 'circle', attrs: {"cx":"9","cy":"5","r":"1"} },
    { tag: 'circle', attrs: {"cx":"9","cy":"19","r":"1"} },
    { tag: 'circle', attrs: {"cx":"15","cy":"12","r":"1"} },
    { tag: 'circle', attrs: {"cx":"15","cy":"5","r":"1"} },
    { tag: 'circle', attrs: {"cx":"15","cy":"19","r":"1"} }
  ]
}

export type IconName = keyof typeof ICON_SHAPES

/** 24×24 网格 —— 适配器按这个缩放，别改成别的值。 */
export const ICON_VIEWBOX = 24
