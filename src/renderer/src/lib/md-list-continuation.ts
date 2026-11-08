// 回车的「规整 + 续行」计划(纯函数)。
//
// 上游 `insertNewlineContinueMarkup` 已经能处理标准写法;这里只接管它不认的那几种:
//   `-[]` / `- []` / `- [x]文字` / 行尾不带空格的 `- [ ]`,以及所有有序任务。
// 计划里把当前行前缀补成标准 Markdown,下一行继续同样的容器 + 一个未勾选任务。
// 规整与换行由调用方放进同一个 transaction —— 一次撤销就回到输入前。

import { parseListLine } from './md-list-syntax'

export interface ContinuationPlan {
  /** 当前行前缀的规整(相对行首);已是标准写法时为 undefined */
  normalize?: { from: number; to: number; insert: string }
  /** 换行插入位置(相对行首),固定在物理行尾 */
  insertAt: number
  /** 插入的 `\n` + 下一行前缀 */
  insert: string
  /** 执行后的光标列(相对行首,按新文档计算) */
  caret: number
}

export function planMarkdownContinuation(line: string, caretCol: number): ContinuationPlan | null {
  // 只接行尾回车;行中切分交给上游,避免复杂的光标映射。
  if (line.slice(caretCol).trim() !== '') return null

  const syntax = parseListLine(line)
  if (syntax === null || !syntax.task) return null
  // 上游已经能正确续行的标准任务,原样交给它。
  if (syntax.canonical) return null

  const checked = syntax.checked ? '[x]' : '[ ]'
  const prefix = `${syntax.quote}${syntax.indent}${syntax.marker} ${checked} `
  const normalize =
    prefix === line.slice(0, syntax.contentStart)
      ? undefined
      : { from: 0, to: syntax.contentStart, insert: prefix }

  const nextMarker = syntax.ordered
    ? `${(syntax.number ?? 1) + 1}${syntax.marker.slice(-1)}`
    : syntax.marker
  const nextPrefix = `${syntax.quote}${syntax.indent}${nextMarker} [ ] `

  const contentLength = line.length - syntax.contentStart
  return {
    normalize,
    insertAt: line.length,
    insert: `\n${nextPrefix}`,
    caret: prefix.length + contentLength + 1 + nextPrefix.length
  }
}
