// 「旧文本 → 新文本」的最小改动区间。
//
// 缩进、换列表标记都是「整行纯函数 → 新行」:直接替换整行会把行内光标挤到行首,
// CodeMirror 只会把行首映射过去。取公共前后缀后只替换真正变化的那一段,
// 行内光标就能留在原来的文字上(与 applyDocText 的整篇 diff 是同一个思路)。

export interface TextChange {
  from: number
  to: number
  insert: string
}

/** 最小前缀/后缀 diff;`from` / `to` 已加上 `offset`。两边相同返回 null。 */
export function minimalTextChange(
  oldText: string,
  nextText: string,
  offset = 0
): TextChange | null {
  if (oldText === nextText) return null
  let head = 0
  const max = Math.min(oldText.length, nextText.length)
  while (head < max && oldText[head] === nextText[head]) head += 1
  let tail = 0
  while (
    tail < max - head &&
    oldText[oldText.length - 1 - tail] === nextText[nextText.length - 1 - tail]
  ) {
    tail += 1
  }
  return {
    from: offset + head,
    to: offset + oldText.length - tail,
    insert: nextText.slice(head, nextText.length - tail)
  }
}
