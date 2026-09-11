// plist XML ⇄ 值的纯函数层(阶段 1;对齐开源 PlistService 的 PropertyListSerialization 语义,改为自实现以免依赖)
// 支持:string/integer/real/true/false/array/dict/date/data;保留根 dict 校验(launchd 要求)
// 序列化输出含 xml 声明 + DOCTYPE(与系统 plutil 输出同构),缩进可注入(设置 xmlIndent)

export type PlistValue = string | number | boolean | PlistValue[] | PlistDict | null
export interface PlistDict {
  [key: string]: PlistValue
}

export type ParseResult = { ok: true; value: PlistDict } | { ok: false; error: string }

interface XmlNode {
  tag: string
  children: XmlNode[]
  text: string
}

function unescape(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function tokenize(xml: string): XmlNode[] | string {
  const body = xml
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  const stack: XmlNode[] = []
  const roots: XmlNode[] = []
  const re = /<([^>]+)>|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    if (m[1] !== undefined) {
      const raw = m[1].trim()
      if (raw.startsWith('/')) {
        const tag = raw.slice(1).trim().split(/\s+/)[0]
        const node = stack.pop()
        if (!node || node.tag !== tag) return `标签不匹配: </${tag}>`
        if (stack.length === 0) roots.push(node)
        else stack[stack.length - 1].children.push(node)
      } else if (raw.endsWith('/')) {
        const name = raw.slice(0, -1).trim().split(/\s+/)[0]
        const node = { tag: name, children: [], text: '' }
        if (stack.length === 0) roots.push(node)
        else stack[stack.length - 1].children.push(node)
      } else {
        stack.push({ tag: raw.split(/\s+/)[0], children: [], text: '' })
      }
    } else if (m[2] !== undefined) {
      const t = m[2].trim()
      if (t !== '' && stack.length > 0) {
        const top = stack[stack.length - 1]
        top.text += (top.text === '' ? '' : '\n') + t
      }
    }
  }
  if (stack.length > 0) return `标签未闭合: <${stack[stack.length - 1].tag}>`
  return roots
}

function nodeToValue(node: XmlNode): PlistValue {
  switch (node.tag) {
    case 'string':
      return unescape(node.text)
    case 'integer':
      return Number.parseInt(node.text, 10)
    case 'real':
      return Number.parseFloat(node.text)
    case 'true':
      return true
    case 'false':
      return false
    case 'date':
    case 'data':
      return node.text // 保留原文(展示/往返足够;launchd 极少用)
    case 'array':
      return node.children.map(nodeToValue)
    case 'dict': {
      const out: PlistDict = {}
      for (let i = 0; i + 1 < node.children.length; i += 2) {
        const keyNode = node.children[i]
        if (keyNode.tag !== 'key') continue
        out[unescape(keyNode.text)] = nodeToValue(node.children[i + 1])
      }
      return out
    }
    default:
      return null
  }
}

/** 解析 plist XML;根必须是 dict(launchd 要求,同开源 PlistService 的校验) */
export function parsePlistXml(xml: string): ParseResult {
  if (!xml.includes('<plist')) return { ok: false, error: 'missing <plist> root' }
  const roots = tokenize(xml)
  if (typeof roots === 'string') return { ok: false, error: roots }
  const plist = roots.find((r) => r.tag === 'plist')
  const dict = plist?.children.find((c) => c.tag === 'dict')
  if (!dict) return { ok: false, error: 'root is not a dictionary' }
  const value = nodeToValue(dict)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'root is not a dictionary' }
  }
  return { ok: true, value: value as PlistDict }
}

function valueToXml(value: PlistValue, indent: string, depth: number): string {
  const pad = indent.repeat(depth)
  if (typeof value === 'string') return `${pad}<string>${escape(value)}</string>`
  if (typeof value === 'number') {
    return Number.isInteger(value) ? `${pad}<integer>${value}</integer>` : `${pad}<real>${value}</real>`
  }
  if (typeof value === 'boolean') return `${pad}<${value ? 'true' : 'false'}/>`
  if (value === null) return `${pad}<string></string>`
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}<array/>`
    const items = value.map((v) => valueToXml(v, indent, depth + 1)).join('\n')
    return `${pad}<array>\n${items}\n${pad}</array>`
  }
  const entries = Object.entries(value)
  if (entries.length === 0) return `${pad}<dict/>`
  const body = entries
    .map(([k, v]) => `${indent.repeat(depth + 1)}<key>${escape(k)}</key>\n${valueToXml(v, indent, depth + 1)}`)
    .join('\n')
  return `${pad}<dict>\n${body}\n${pad}</dict>`
}

/** 序列化 plist XML(声明 + DOCTYPE + plist 根;desc 作为 <plist> 前的 XML 注释,往返保留) */
export function toPlistXml(value: PlistDict, opts?: { indent?: string; desc?: string }): string {
  const indent = opts?.indent ?? '\t'
  const desc = opts?.desc?.trim()
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
  ]
  if (desc && desc !== '') lines.push(`<!-- ${escape(desc)} -->`)
  lines.push('<plist version="1.0">', valueToXml(value, indent, 0), '</plist>', '')
  return lines.join('\n')
}

/** 读取 plist 中的描述注释(应用自有约定:首个 XML 注释;无则空) */
export function extractPlistDesc(xml: string): string {
  const m = xml.match(/<!--([\s\S]*?)-->/)
  return m ? unescape(m[1]).trim() : ''
}
