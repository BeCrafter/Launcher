// 回车的「退出引用」计划(纯函数)。
//
// 上游 `insertNewlineContinueMarkup` 要连续两条空引用行才肯退出:从 `> 文字` 起
// 得按三次回车。这里接管第二次:在空引用行上回车时,只把**最内层**一个 `>` 删掉,
// 光标留在这一行 —— 于是「一条空行」就结束引用,嵌套引用也一次只退一层。
//
// 删除区间从最内层 `>` 到行尾(尾随空白一起清掉),前导缩进保留:
// 它属于还没退掉的外层容器,和上游退出分支的口径一致。

import { QUOTE_PREFIX_RE } from './md-list-syntax'

export interface QuoteExitPlan {
  /** 删除起点(相对行首):最内层 `>` 的下标 */
  from: number
  /** 删除终点(相对行首):行尾 */
  to: number
  /** 执行后的光标列(相对行首) */
  caret: number
}

export function planQuoteExit(line: string, caretCol: number): QuoteExitPlan | null {
  // 只接行尾回车;行中切分交给上游,避免复杂的光标映射。
  if (line.slice(caretCol).trim() !== '') return null

  const prefix = QUOTE_PREFIX_RE.exec(line)?.[1]
  if (prefix === undefined) return null
  // 引用前缀之后必须全是空白:`> 甲` / `> - ` / `> [!note]` 都不是空引用行,交给上游。
  if (line.slice(prefix.length).trim() !== '') return null
  // 光标必须在前缀之后;停在前缀里时按回车仍交给默认行为。
  if (caretCol < prefix.length) return null

  const from = line.lastIndexOf('>')
  return { from, to: line.length, caret: from }
}
