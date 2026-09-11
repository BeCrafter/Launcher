// ported-from: docs/demo/js/modals.js parsePlistXml @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// plist 轻量解析(逐行为移植 modals.js parsePlistXml:提取 Label 与 Program/ProgramArguments[0])
import type { XmlIndent } from '@shared/settings'

export interface ParsedPlist {
  label: string
  program: string
}

export function parsePlistXml(xml: string): ParsedPlist | null {
  if (!xml || !xml.includes('<plist')) return null
  const pick = (key: string): string => {
    const m = xml.match(new RegExp(`<key>${key}<\\/key>\\s*<string>([^<]+)<\\/string>`))
    return m ? m[1].trim() : ''
  }
  const label = pick('Label')
  const program =
    pick('Program') ||
    (() => {
      const m = xml.match(/<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>/)
      return m ? m[1].trim() : ''
    })()
  return { label, program }
}

// ── plist XML 格式化(设置 xmlIndent 的消费点之一;纯函数,畸形输入原样返回不抛) ──

type TokenType = 'comment' | 'cdata' | 'doctype' | 'decl' | 'open' | 'close' | 'self' | 'text'
interface Token {
  type: TokenType
  raw: string
}

// 按序匹配:注释 / CDATA / DOCTYPE / 声明 / 闭合 / 自闭合 / 开标签 / 文本
const TOKEN_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\?[\s\S]*?\?>|<\/[^>]*>|<[^>]*\/>|<[^>]*>|[^<]+/g

function classify(raw: string): TokenType {
  if (raw.startsWith('<!--')) return 'comment'
  if (raw.startsWith('<![CDATA[')) return 'cdata'
  if (raw.startsWith('<!DOCTYPE')) return 'doctype'
  if (raw.startsWith('<?')) return 'decl'
  if (raw.startsWith('</')) return 'close'
  if (raw.startsWith('<')) return raw.endsWith('/>') ? 'self' : 'open'
  return 'text'
}

function tokenize(xml: string): Token[] | null {
  const tokens: Token[] = []
  TOKEN_RE.lastIndex = 0
  let last = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(xml))) {
    if (m.index !== last) return null // 存在未匹配片段(畸形)→ 放弃格式化
    tokens.push({ type: classify(m[0]), raw: m[0] })
    last = m.index + m[0].length
    if (m[0].length === 0) return null
  }
  return last === xml.length ? tokens : null
}

function tagName(openTag: string): string {
  const m = openTag.match(/^<([^\s/>]+)/)
  return m ? m[1] : ''
}

export function formatPlistXml(xml: string, indent: XmlIndent): string {
  if (!xml.trim()) return xml
  const tokens = tokenize(xml)
  if (!tokens) return xml
  const unit = indent === 'tab' ? '\t' : ' '.repeat(Number(indent))
  const lines: string[] = []
  const push = (depth: number, s: string): void => {
    lines.push(unit.repeat(Math.max(0, depth)) + s)
  }

  let depth = 0
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    switch (t.type) {
      case 'decl':
        push(0, t.raw.trim())
        i++
        break
      case 'doctype':
        push(0, t.raw.replace(/\s+/g, ' ').trim()) // 跨行 DOCTYPE 收敛为单行
        i++
        break
      case 'comment': {
        const parts = t.raw.split('\n').map((l) => l.trim())
        for (const p of parts) if (p) push(depth, p)
        i++
        break
      }
      case 'cdata':
        push(depth, t.raw)
        i++
        break
      case 'self':
        push(depth, t.raw)
        i++
        break
      case 'open': {
        const next = tokens[i + 1]
        const close = tokens[i + 2]
        // 空元素 <a></a> 直接内联
        if (next?.type === 'close' && next.raw === `</${tagName(t.raw)}>`) {
          push(depth, `${t.raw}${next.raw}`)
          i += 2
          break
        }
        // 叶子元素(开标签 + 文本 + 配对准闭合)单行内联
        if (
          next?.type === 'text' &&
          close?.type === 'close' &&
          close.raw === `</${tagName(t.raw)}>`
        ) {
          push(depth, `${t.raw}${next.raw.trim()}${close.raw}`)
          i += 3
          break
        }
        push(depth, t.raw)
        depth++
        i++
        break
      }
      case 'close':
        depth--
        push(depth, t.raw)
        i++
        break
      case 'text': {
        const s = t.raw.trim()
        if (s) push(depth, s) // 混合内容兜底:独立成行
        i++
        break
      }
    }
  }
  return lines.join('\n') + '\n'
}
