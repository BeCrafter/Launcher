// 任务清单勾选 → 源文件回写(纯函数)。
//
// 预览里的复选框不是装饰:勾一下要真的把 `- [ ]` 改成 `- [x]`。但预览渲染与源文件之间
// 只靠**行号**关联,而用户可能刚改过那一行 —— 所以这里先校验该行仍是任务项,不是就返回 null
// 让调用方放弃(而不是把别的内容改坏)。

/**
 * 任务项行:**引用前缀**(`> ` / `> > `)+ 缩进 + 列表标记 + `[ ]` / `[x]`。行尾有没有内容都算。
 *
 * ⚠ 前缀这一截是必须的:引用 / 提示块里的任务行长这样 ——
 * `> - [ ] 待办`。少了它,`^` 后面直接要列表标记,`>` 就把它顶掉了 → **匹配失败 →
 * 静默什么都不做**(勾了没反应,也不报错)。踩过:场景矩阵里引用/嵌套引用/提示块三格的任务
 * 勾不动,正文和折叠块却是好的 —— 差别就在这一截前缀。
 */
const TASK_LINE_RE = /^(\s*(?:>\s?)*\s*[-*+]\s+\[)([ xX])(\])/

/**
 * 翻转第 `line` 行的勾选状态,返回新的正文;无法安全改写时返回 null。
 * `line` 是**正文里的行号**(frontmatter 已剥离),与渲染器给出的下标同一坐标系。
 */
export function toggleTaskLine(body: string, line: number, next: boolean): string | null {
  if (!Number.isInteger(line) || line < 0) return null
  const lines = body.split('\n')
  if (line >= lines.length) return null

  const m = TASK_LINE_RE.exec(lines[line])
  if (!m) return null // 那一行已经不是任务项了(用户改过)→ 放弃,不猜

  const want = next ? 'x' : ' '
  if (m[2] === want) return null // 已经是目标状态:不改,省掉一次无意义的写盘与 updated 前移

  lines[line] = `${m[1]}${want}${m[3]}${lines[line].slice(m[0].length)}`
  return lines.join('\n')
}
