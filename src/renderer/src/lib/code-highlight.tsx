// 把一段代码切成带 class 的 React 文本节点。
//
// ⚠ 这条路是刻意选的:`highlightTree` / `highlightCode` 的常见用法是拿 HTML 字符串,
//   那就必须 dangerouslySetInnerHTML —— 而 markdown.tsx 的**定义性保证**正是「绝不用它」。
//   这里用的是 highlightCode 的另一个重载:它回调给我们 (文本, class) 对,
//   由我们自己产 React 节点。于是「代码高亮」与「HTML 惰性」两件事不再互斥。
//
// 解析器来自 code-langs.ts。不认识的语言返回纯文本 —— 猜一个近似的语法去染色,
// 比不高亮更糟(一整段日志会被染成字符串色)。

import type { ReactNode } from 'react'
import { highlightCode } from '@lezer/highlight'
import { parserFor } from './code-langs'
import { TOKEN_STYLE } from './code-tokens'

/**
 * 解析结果缓存。
 *
 * 预览是**每次击键**重渲染整篇的(去抖只管保存,不管渲染),同一段代码在光标别处移动时
 * 会被反复重新解析。缓存键带上语言,避免 `foo` 与 ```foo 互相串味。
 * 上限 64:一篇笔记里的代码块数量远小于此,超了按插入顺序淘汰最老的。
 */
const CACHE_MAX = 64
const cache = new Map<string, ReactNode[]>()

function cached(key: string, build: () => ReactNode[]): ReactNode[] {
  const hit = cache.get(key)
  if (hit !== undefined) {
    // 命中后重新插入:Map 的迭代顺序即插入顺序,删掉再放 = LRU
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const built = build()
  cache.set(key, built)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return built
}

/** 供测试与「笔记目录变了」之类的场合清空 */
export function clearHighlightCache(): void {
  cache.clear()
}

/**
 * 高亮一段代码,返回可直接放进 `<code>` 的 React 节点。
 *
 * 行与行之间用字面 `\n` 连接(与源文本逐字节一致)—— 复制出去还是原样的代码,
 * 而 `<pre>` 的 `white-space: pre` 会把它渲染成换行。
 */
export function highlightCodeNodes(code: string, lang: string, keyPrefix: string): ReactNode[] {
  const parser = parserFor(lang)
  if (parser === null || code === '') return [code]

  return cached(`${lang}\u0000${code}`, () => {
    let tree: ReturnType<typeof parser.parse>
    try {
      tree = parser.parse(code)
    } catch {
      // 语法本身不该抛,但真抛了也不能让整篇笔记渲染不出来
      return [code]
    }
    const out: ReactNode[] = []
    let k = 0
    try {
      highlightCode(
        code,
        tree,
        TOKEN_STYLE,
        (text, classes) => {
          out.push(classes === '' ? text : <span className={classes} key={`${keyPrefix}-${k++}`}>{text}</span>)
        },
        () => out.push('\n')
      )
    } catch {
      return [code]
    }
    return out
  })
}

/** 该语言是否认得(围栏右上角的语言角标据此决定要不要淡化显示) */
export function isKnownLang(lang: string): boolean {
  return parserFor(lang) !== null
}
