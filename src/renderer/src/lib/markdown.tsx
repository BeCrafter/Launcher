// 最小安全 Markdown 渲染(应用新增,demo 无此能力 —— 真实 LLM 正文普遍带 md,
// demo 的 aiEsc + pre-wrap 会把代码块/列表退化成原文;见 docs/design/ai-message-model-gap.md §2.1)
//
// 安全策略:产 React 节点、**绝不用 dangerouslySetInnerHTML**——React 默认把字符串当文本转义,
// 因此输入里的 HTML 天然 inert;不需要也不允许「先转义再拼 HTML」的那条路。
// 支持面刻意收窄:围栏代码块 / 行内代码 / 粗体 / 标题 #~#### / 无序有序列表 / 引用块 / 链接;
// 其余一律按纯文本段落透出。链接统一走 openExternal(main 侧 https? 白名单),不渲染裸 URL。

import type { ReactNode } from 'react'
import { openExternal } from './utils'

/** 行内片段:纯文本 / 行内代码 / 粗体(可嵌套行内代码) / 链接 */
type Inline = string | { code: string } | { bold: Inline[] } | { linkText: string; url: string }

const INLINE_RE = /(\*\*([\s\S]+?)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/g

/** 行内解析:命中粗体时对其内容递归(允许 **..`code`..** 嵌套);未命中部分原样为文本 */
function parseInline(src: string, noBold = false): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of src.matchAll(INLINE_RE)) {
    if (m.index > last) out.push(src.slice(last, m.index))
    if (!noBold && m[1] !== undefined) out.push({ bold: parseInline(m[2], true) })
    else if (m[3] !== undefined) out.push({ code: m[4] })
    else if (m[5] !== undefined) out.push({ linkText: m[6], url: m[7] })
    else out.push(m[0])
    last = m.index + m[0].length
  }
  if (last < src.length) out.push(src.slice(last))
  return out
}

function renderInline(parts: Inline[], keyBase: string): ReactNode[] {
  return parts.map((p, i) => {
    const key = `${keyBase}-${i}`
    if (typeof p === 'string') return p
    if ('code' in p)
      return (
        <code className="md-code-inline" key={key}>
          {p.code}
        </code>
      )
    if ('bold' in p)
      return (
        <strong key={key}>{renderInline(p.bold, key)}</strong>
      )
    return (
      <a
        key={key}
        className="md-link"
        href={p.url}
        onClick={(e) => {
          e.preventDefault()
          openExternal(p.url)
        }}
      >
        {p.linkText}
        <i className="fa-solid fa-arrow-up-right-from-square md-link-icon" />
      </a>
    )
  })
}

const FENCE_RE = /^```(\w*)/
const HEAD_RE = /^(#{1,4})\s+(.*)$/
const UL_RE = /^[-*]\s+(.*)$/
const OL_RE = /^\d+[.)]\s+(.*)$/

/** 块级解析:行扫描;未识别的连续行合为一段(段内保留换行,交由 pre-wrap 展示) */
export function renderMarkdown(src: string, keyPrefix = 'md'): ReactNode[] {
  const lines = src.split('\n')
  const out: ReactNode[] = []
  let i = 0
  let k = 0
  const key = (): string => `${keyPrefix}-${k++}`

  while (i < lines.length) {
    const line = lines[i]

    // 围栏代码块:未闭合则吃到结尾(不静默丢弃后半段)
    const fence = line.match(FENCE_RE)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++])
      if (i < lines.length) i++ // 跳过闭合行
      out.push(
        <pre className="md-code" key={key()}>
          <code>{body.join('\n')}</code>
        </pre>
      )
      continue
    }

    const head = line.match(HEAD_RE)
    if (head) {
      const level = head[1].length
      out.push(
        <div className={`md-h md-h${level}`} key={key()}>
          {renderInline(parseInline(head[2]), key())}
        </div>
      )
      i++
      continue
    }

    if (UL_RE.test(line)) {
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(UL_RE)
        if (!m) break
        items.push(m[1])
        i++
      }
      out.push(
        <ul className="md-list" key={key()}>
          {items.map((it, n) => (
            <li key={n}>{renderInline(parseInline(it), `${keyPrefix}-ul${k}-${n}`)}</li>
          ))}
        </ul>
      )
      continue
    }

    if (OL_RE.test(line)) {
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(OL_RE)
        if (!m) break
        items.push(m[1])
        i++
      }
      out.push(
        <ol className="md-list" key={key()}>
          {items.map((it, n) => (
            <li key={n}>{renderInline(parseInline(it), `${keyPrefix}-ol${k}-${n}`)}</li>
          ))}
        </ol>
      )
      continue
    }

    if (/^>\s?/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      out.push(
        <blockquote className="md-quote" key={key()}>
          {renderInline(parseInline(body.join('\n')), key())}
        </blockquote>
      )
      continue
    }

    if (line.trim() === '') {
      i++
      continue
    }

    // 普通段落:吃到空行或下一个块级结构为止
    const para: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) para.push(lines[i++])
    out.push(
      <p className="md-p" key={key()}>
        {renderInline(parseInline(para.join('\n')), key())}
      </p>
    )
  }
  return out
}

function isBlockStart(line: string): boolean {
  return FENCE_RE.test(line) || HEAD_RE.test(line) || UL_RE.test(line) || OL_RE.test(line) || /^>\s?/.test(line)
}
