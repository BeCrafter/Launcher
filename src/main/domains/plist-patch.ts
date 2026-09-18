// plist XML 节点级补丁(复审 item 4/5 的最终形态):
// 表单保存**只改写被改动的顶层键**,其余部分(注释、键序、`<integer>`/`<real>` 的原始写法、空行缩进)
// 逐字节保持原样 —— 从「值级保留」升级为「原文保留」。
// 结构无法安全扫描(根节点异常、顶层出现 CDATA/裸文本、键缺值等)→ 返回 reason,
// 由调用方按「锁表单、请用 XML 编辑」处理,绝不盲重建。
import type { PlistDict, PlistValue } from './plist-xml'
import { escapeXml, renderValueXml, scanTopLevelDict } from './plist-xml'

export type PatchResult = { ok: true; xml: string; changed: string[] } | { ok: false; reason: string }

function deepEqual(a: PlistValue | undefined, b: PlistValue | undefined): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b)
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const da = a as PlistDict
    const db = b as PlistDict
    const ka = Object.keys(da)
    const kb = Object.keys(db)
    return ka.length === kb.length && ka.every((k) => deepEqual(da[k], db[k]))
  }
  return false
}

/** 删除整行时把行尾换行一起吃掉,避免留下空行 */
function extendToLineEnd(xml: string, end: number): number {
  let i = end
  if (xml[i] === '\r') i += 1
  if (xml[i] === '\n') i += 1
  return i
}

/**
 * 生成打了补丁的 XML。nextDict 必须是「完整的下一份顶层字典」
 * (调用方用 plistFromForm 生成,非托管键已在其中按原值带过来)。
 */
export function patchPlistXml(opts: {
  originalXml: string
  originalDict: PlistDict
  nextDict: PlistDict
  indent: string
  /** 期望的描述注释;undefined = 不动描述 */
  desc?: string
}): PatchResult {
  const scan = scanTopLevelDict(opts.originalXml)
  if (!scan.ok) return { ok: false, reason: scan.reason }

  interface Edit {
    start: number
    end: number
    text: string
  }
  const edits: Edit[] = []
  const changed: string[] = []
  const seen = new Set<string>()
  const has = (d: PlistDict, k: string): boolean => Object.prototype.hasOwnProperty.call(d, k)

  for (const node of scan.nodes) {
    seen.add(node.key)
    const existed = has(opts.originalDict, node.key)
    const exists = has(opts.nextDict, node.key)
    if (existed && !exists) {
      edits.push({ start: node.spanStart, end: extendToLineEnd(opts.originalXml, node.spanEnd), text: '' })
      changed.push(node.key)
      continue
    }
    if (!exists) continue
    if (existed && deepEqual(opts.originalDict[node.key], opts.nextDict[node.key])) continue // 未改动 → 原文不动
    // 只换值元素,`<key>` 行(含其缩进与同行注释)保持原样;
    // 值按 depth 1 渲染后剥掉首行缩进 —— 那段缩进是原文(spanStart→valueStart)的一部分
    const unit = node.indent !== '' ? node.indent : opts.indent
    const rendered = renderValueXml(opts.nextDict[node.key], unit, 1)
    edits.push({
      start: node.valueStart,
      end: node.valueEnd,
      text: rendered.startsWith(unit) ? rendered.slice(unit.length) : rendered
    })
    changed.push(node.key)
  }

  const added = Object.keys(opts.nextDict).filter((k) => !seen.has(k) && !has(opts.originalDict, k))
  if (added.length > 0 && scan.selfClosing) {
    // 空占位 `<dict/>` → 展开成成对标签(keystone 这类占位文件也能在表单里补 Label)
    const unit = opts.indent
    const inner = added
      .map((k) => `${unit}<key>${escapeXml(k)}</key>\n${renderValueXml(opts.nextDict[k], unit, 1)}`)
      .join('\n')
    edits.push({ start: scan.dictStart, end: scan.dictEnd, text: `<dict>\n${inner}\n${scan.dictIndent}</dict>` })
    changed.push(...added)
  } else if (added.length > 0) {
    const indent = scan.nodes[0]?.indent ?? opts.indent
    const body = added
      .map((k) => `${indent}<key>${escapeXml(k)}</key>\n${renderValueXml(opts.nextDict[k], indent, 1)}`)
      .join('\n')
    const before = opts.originalXml.slice(0, scan.bodyEnd)
    const needsNewline = before.endsWith('\n') ? '' : '\n'
    edits.push({ start: scan.bodyEnd, end: scan.bodyEnd, text: `${needsNewline}${body}\n` })
    changed.push(...added)
  }

  // 描述注释:应用约定它位于 DOCTYPE 与 <plist> 之间
  if (opts.desc !== undefined) {
    const target = opts.desc.trim()
    const plistStart = opts.originalXml.indexOf('<plist')
    const head = opts.originalXml.slice(0, plistStart)
    const m = /<!--[\s\S]*?-->/.exec(head)
    if (target === '') {
      if (m) edits.push({ start: m.index, end: extendToLineEnd(opts.originalXml, m.index + m[0].length), text: '' })
    } else if (m) {
      edits.push({ start: m.index, end: m.index + m[0].length, text: `<!-- ${escapeXml(target)} -->` })
    } else {
      edits.push({ start: plistStart, end: plistStart, text: `<!-- ${escapeXml(target)} -->\n` })
    }
    if (m ? true : target !== '') changed.push('__desc')
  }

  if (edits.length === 0) return { ok: true, xml: opts.originalXml, changed: [] }

  // 逆序应用,保证偏移不互相影响
  edits.sort((a, b) => b.start - a.start)
  let out = opts.originalXml
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return { ok: true, xml: out, changed }
}
