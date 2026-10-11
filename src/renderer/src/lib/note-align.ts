// 段落对齐的读写(纯函数)。
//
// Markdown **没有**段落对齐的标准语法。实践中可移植的只有 HTML 的 align 属性 ——
// GitHub 认、Obsidian 也认,拿到别处不会变成一堵字面文本。
//
// 这是本项目第二处、也是最后一处「认一小段 HTML」:和表格单元格里的 `<br>` 一样,
// 它是**字面量匹配 + 产 React 节点**,不是解析 HTML —— 块里的其它任何标签照样按纯文本转义。
//
// 包出来的形态:
//
//   <div align="center">
//
//   这一段会居中
//
//   </div>

export type TextAlign = 'left' | 'center' | 'right'

/** 只认自己写出去的那一种形态:独占一行、align 值受限、可带单双引号 */
const OPEN_RE = /^\s*<(?:div|p)\s+align=["']?(left|center|right)["']?\s*>\s*$/i
const CLOSE_RE = /^\s*<\/(?:div|p)>\s*$/i

/** 这一行是不是对齐包裹的开启行 */
export function isAlignOpen(line: string): boolean {
  return OPEN_RE.test(line)
}

/** 这一行是不是对齐包裹的闭合行 */
export function isAlignClose(line: string): boolean {
  return CLOSE_RE.test(line)
}

/** 读出某一行的对齐方向;不是开启行返回 null */
export function alignOf(line: string): TextAlign | null {
  const m = OPEN_RE.exec(line)
  return m === null ? null : (m[1].toLowerCase() as TextAlign)
}

export function openLine(dir: TextAlign): string {
  return `<div align="${dir}">`
}

export const CLOSE_LINE = '</div>'

/**
 * 把 `[from, to]` 这段行设成 `dir` 对齐,返回**新的整篇正文**;区间非法返回 null。
 *
 * 几个刻意的行为:
 *   · 这段**已经被包着**时,先把旧的包裹行摘掉再重新包 —— 所以反复点不同对齐
 *     不会套娃成三层 div;
 *   · `dir === 'left'` 等于**只摘不包**(左对齐就是 Markdown 的默认);
 *   · 前后各留一个空行,否则 HTML 块会和相邻段落粘在一起(GFM 要求 HTML 块前后空行)。
 */
export function setBlockAlign(body: string, from: number, to: number, dir: TextAlign): string | null {
  const lines = body.split('\n')
  if (from < 0 || to >= lines.length || to < from) return null

  // 往外**跳过空行**去找包裹行 —— 我们自己就会在包裹行与内容之间插空行,
  // 只看紧邻的那一行会找不到,于是反复点对齐就套娃了。
  let s0 = from
  let e0 = to
  let up = s0 - 1
  while (up >= 0 && lines[up].trim() === '') up--
  if (up >= 0 && isAlignOpen(lines[up])) s0 = up
  let down = e0 + 1
  while (down < lines.length && lines[down].trim() === '') down++
  if (down < lines.length && isAlignClose(lines[down])) e0 = down

  const before = lines.slice(0, s0)
  const after = lines.slice(e0 + 1)
  // 去掉旧包裹行与首尾空行 —— 于是「同一段同一方向连做两次」结果完全相同
  const inner = lines.slice(s0, e0 + 1).filter((l, i, arr) => {
    const isEdge = i === 0 || i === arr.length - 1
    return !(isEdge && (isAlignOpen(l) || isAlignClose(l)))
  })
  while (inner.length > 0 && inner[0].trim() === '') inner.shift()
  while (inner.length > 0 && inner[inner.length - 1].trim() === '') inner.pop()
  if (inner.length === 0) return null

  // 'left' 就是 Markdown 的默认,只摘不包
  const out =
    dir === 'left' ? [...before, ...inner, ...after] : [...before, openLine(dir), '', ...inner, '', CLOSE_LINE, ...after]
  return out.join('\n')
}
