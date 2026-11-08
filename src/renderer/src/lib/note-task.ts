// 任务清单勾选 → 源文件回写(纯函数)。
//
// 预览里的复选框不是装饰:勾一下要真的把 `- [ ]` 改成 `- [x]`。但预览渲染与源文件之间
// 只靠**行号**关联,而用户可能刚改过那一行 —— 所以这里先校验该行仍是任务项,不是就返回 null
// 让调用方放弃(而不是把别的内容改坏)。
//
// 识别口径统一在 `md-list-syntax.ts`:引用前缀、缩进、无序/有序标记、宽松的 `[]` 都在那一处,
// 这里只负责把 `[ ]` / `[x]` 那一段原地换掉,其余字节逐字不动。

import { parseListLine } from './md-list-syntax'

/**
 * 翻转第 `line` 行的勾选状态,返回新的正文;无法安全改写时返回 null。
 * `line` 是**正文里的行号**(frontmatter 已剥离),与渲染器给出的下标同一坐标系。
 */
export function toggleTaskLine(body: string, line: number, next: boolean): string | null {
  if (!Number.isInteger(line) || line < 0) return null
  const lines = body.split('\n')
  if (line >= lines.length) return null

  const text = lines[line]
  const syntax = parseListLine(text)
  if (syntax === null || !syntax.task) return null // 那一行已经不是任务项了(用户改过)→ 放弃,不猜

  if (syntax.checked === next) return null // 已经是目标状态:不改,省掉一次无意义的写盘与 updated 前移

  lines[line] = `${text.slice(0, syntax.taskFrom)}${next ? '[x]' : '[ ]'}${text.slice(syntax.taskTo)}`
  return lines.join('\n')
}
