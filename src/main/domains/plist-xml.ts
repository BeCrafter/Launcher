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

export function escapeXml(s: string): string {
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
  if (typeof value === 'string') return `${pad}<string>${escapeXml(value)}</string>`
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
    .map(([k, v]) => `${indent.repeat(depth + 1)}<key>${escapeXml(k)}</key>\n${valueToXml(v, indent, depth + 1)}`)
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
  if (desc && desc !== '') lines.push(`<!-- ${escapeXml(desc)} -->`)
  lines.push('<plist version="1.0">', valueToXml(value, indent, 0), '</plist>', '')
  return lines.join('\n')
}

/**
 * 读取 plist 的描述注释。应用自有约定:**DOCTYPE 与 `<plist>` 之间**的那条注释才是描述
 * (toPlistXml 就写在那里)。此前取「任意首条注释」会把字典内部的普通注释误当描述,
 * 节点级补丁保存时又把它当作描述插到 `<plist>` 前 → 注释被复制一份。
 */
export function extractPlistDesc(xml: string): string {
  const plistStart = xml.indexOf('<plist')
  const head = plistStart < 0 ? xml : xml.slice(0, plistStart)
  const m = head.match(/<!--([\s\S]*?)-->/)
  return m ? unescape(m[1]).trim() : ''
}

// ─────────── 节点级补丁支持(复审 item 4/5:只改写被改动的节点) ───────────

/** 顶层 dict 里一个键的跨度(偏移基于原始 XML 字符串) */
export interface DictNodeSpan {
  key: string
  /** 整对 `<key>…</key>` + 值元素的跨度(删键时整段移除) */
  spanStart: number
  spanEnd: number
  /** 值元素的跨度(改值时只换这一段,`<key>` 原文与注释/空行保持不动) */
  valueStart: number
  valueEnd: number
  /** 该键所在行的缩进(新值按原缩进重排) */
  indent: string
}

export type TopLevelScan =
  | { ok: true; bodyStart: number; bodyEnd: number; nodes: DictNodeSpan[]; selfClosing: boolean; dictStart: number; dictEnd: number; dictIndent: string }
  | { ok: false; reason: string }

/** 从 start(指向 '<')读一个完整元素,返回结束偏移与标签名;支持自闭合、嵌套与 CDATA */
function scanElement(xml: string, start: number): { end: number; tag: string } | null {
  if (xml[start] !== '<') return null
  let i = start + 1
  // 跳过 CDATA/注释/声明(它们不是元素)
  if (xml.startsWith('![CDATA[', i)) {
    const closeCdata = xml.indexOf(']]>', i)
    return closeCdata < 0 ? null : { end: closeCdata + 3, tag: '#cdata' }
  }
  if (xml.startsWith('!--', i)) {
    const closeComment = xml.indexOf('-->', i)
    return closeComment < 0 ? null : { end: closeComment + 3, tag: '#comment' }
  }
  // 标签头(引号内的 '>' 不算结束)
  let quote = ''
  while (i < xml.length) {
    const c = xml[i]
    if (quote !== '') {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '>') break
    i += 1
  }
  if (i >= xml.length) return null
  const header = xml.slice(start + 1, i)
  const tag = header.trim().split(/[\s/]/)[0]
  if (tag === '' || tag.startsWith('/') || tag.startsWith('?') || tag.startsWith('!')) return { end: i + 1, tag: '#other' }
  if (header.trimEnd().endsWith('/')) return { end: i + 1, tag }
  // 配对闭合(同名嵌套要计深度)
  const closeTag = `</${tag}>`
  let depth = 1
  let cursor = i + 1
  const openRe = new RegExp(`<${tag}(?=[\\s/>])`, 'g')
  while (depth > 0) {
    openRe.lastIndex = cursor
    const nextOpen = openRe.exec(xml)
    const nextClose = xml.indexOf(closeTag, cursor)
    if (nextClose < 0) return null
    if (nextOpen && nextOpen.index < nextClose) {
      depth += 1
      cursor = nextOpen.index + 1
    } else {
      depth -= 1
      cursor = nextClose + closeTag.length
    }
  }
  return { end: cursor, tag }
}

/** 定位根 `<dict>` 的 body 与全部顶层键跨度(改值/增删键都基于它做定点替换) */
export function scanTopLevelDict(xml: string): TopLevelScan {
  const plistStart = xml.indexOf('<plist')
  if (plistStart < 0) return { ok: false, reason: '缺少 <plist> 根' }
  const plist = scanElement(xml, plistStart)
  if (!plist) return { ok: false, reason: '<plist> 未闭合' }
  const dictStart = xml.indexOf('<dict', plistStart)
  if (dictStart < 0 || dictStart > plist.end) return { ok: false, reason: '根不是 <dict>' }
  const dict = scanElement(xml, dictStart)
  if (!dict) return { ok: false, reason: '根 <dict> 未闭合' }
  const headerEnd = xml.indexOf('>', dictStart)
  if (headerEnd < 0 || headerEnd > dict.end) return { ok: false, reason: '根 <dict> 头解析失败' }
  const header = xml.slice(dictStart, headerEnd)
  const dictLineStart = xml.lastIndexOf('\n', dictStart)
  const dictIndentRaw = xml.slice(dictLineStart < 0 ? 0 : dictLineStart + 1, dictStart)
  const dictIndent = /^[ \t]*$/.test(dictIndentRaw) ? dictIndentRaw : ''
  // 自闭合根 `<dict/>`(keystone 占位就是这种):没有 body,新增键时要把它展开成成对标签
  if (header.trimEnd().endsWith('/')) {
    return { ok: true, bodyStart: headerEnd, bodyEnd: headerEnd, nodes: [], selfClosing: true, dictStart, dictEnd: dict.end, dictIndent }
  }
  const bodyStart = headerEnd + 1
  const bodyEnd = dict.end - '</dict>'.length
  const nodes: DictNodeSpan[] = []
  let i = bodyStart
  while (i < bodyEnd) {
    // 跳过空白与注释
    const lt = xml.indexOf('<', i)
    if (lt < 0 || lt >= bodyEnd) break
    const el = scanElement(xml, lt)
    if (!el || el.end > bodyEnd) return { ok: false, reason: '根 dict 内部元素越界' }
    if (el.tag === '#comment' || el.tag === '#other') {
      i = el.end
      continue
    }
    if (el.tag !== 'key') return { ok: false, reason: '根 dict 中出现非 <key> 元素' }
    const keyText = xml.slice(xml.indexOf('>', lt) + 1, el.end - '</key>'.length)
    // 值的起始:key 结束后的第一个 '<'(跳过空白与注释)
    let v = el.end
    while (v < bodyEnd) {
      const vt = xml.indexOf('<', v)
      if (vt < 0 || vt >= bodyEnd) return { ok: false, reason: `键「${keyText}」缺值` }
      const vel = scanElement(xml, vt)
      if (!vel || vel.end > bodyEnd) return { ok: false, reason: `键「${keyText}」的值元素越界` }
      if (vel.tag === '#comment') {
        v = vel.end
        continue
      }
      // 行缩进 = `<key>` 所在行首到 `<key>` 之间的空白(spanStart 指向行首,删键时整行移除)
      const lineStart = xml.lastIndexOf('\n', lt)
      const rawIndent = xml.slice(lineStart < 0 ? 0 : lineStart + 1, lt)
      const indent = /^[ \t]*$/.test(rawIndent) ? rawIndent : ''
      nodes.push({
        key: unescape(keyText),
        spanStart: lineStart < 0 ? lt : lineStart + 1,
        spanEnd: vel.end,
        valueStart: vt,
        valueEnd: vel.end,
        indent
      })
      i = vel.end
      break
    }
  }
  return { ok: true, bodyStart, bodyEnd, nodes, selfClosing: false, dictStart, dictEnd: dict.end, dictIndent }
}

/** 单值序列化(供补丁按原缩进重排) */
export function renderValueXml(value: PlistValue, indent: string, depth = 0): string {
  return valueToXml(value, indent, depth)
}
