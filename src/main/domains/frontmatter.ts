// frontmatter:手写窄子集解析 + **外科式改写**。
//
// 为什么不引 yaml 库:主导需求是「绝不丢失、绝不静默重写用户内容」。任何库都要走
// parse → 重新序列化,即使注释保留模式也会规范化引号/flow 风格/键序 —— 也就是改动了没让它改的行,
// 在用户的 git 仓库里制造 diff 噪音,正是要防的失败模式(js-yaml 更糟:会把 `created: 2026-10-09`
// 变成 Date、把 `on/yes/no` 变成布尔,而笔记的 frontmatter 必须每个值都是不透明字符串)。
// 项目文化也一致:domains/plist-xml.ts、domains/crontab.ts、lib/markdown.tsx 都是手写窄解析器,
// crontab.ts 明写「序列化即 join('\n'),未改动行字节级保真」—— 同一套纪律。
//
// **外科式改写比解析器正确性更重要**:patchFrontmatter 只替换本应用拥有的那几个键所在的行,
// 其余逐字节透传。于是「未知键能存活」不是解析器正确性的推论,而是写路径根本不产出那些行的**结构性保证**。

import {
  MAX_FRONTMATTER_BYTES,
  MAX_TAGS,
  TAG_MAX,
  type NoteRef
} from '../../shared/notes'
import { normalizeRefs, normalizeTags } from './note-ref'

/** 围栏:行首 `---`(容忍尾随空白);结束围栏也接受 YAML 的 `...` */
const FENCE_RE = /^---\s*$/
const END_FENCE_RE = /^(?:---|\.\.\.)\s*$/
const KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:(.*)$/
/** 序列项:`  - xxx`(缩进可有可无,`-` 后须有空白) */
const SEQ_RE = /^\s*-\s+(.*)$/
/** 子键:可选 `- ` 前缀 + `key:` */
const SUBKEY_RE = /^\s*(?:-\s+)?([A-Za-z_][A-Za-z0-9_-]*)\s*:(.*)$/

/** 本应用拥有的键,以及它们在文件里的规范顺序 */
export const OWNED_KEYS = ['title', 'created', 'updated', 'tags', 'pinned', 'refs'] as const
export type OwnedKey = (typeof OWNED_KEYS)[number]

export interface FrontmatterFields {
  title?: string
  created?: string
  updated?: string
  tags?: string[]
  pinned?: boolean
  refs?: NoteRef[]
}

export interface FrontmatterSplit {
  /** 有 `---` 围栏且闭合 */
  present: boolean
  /** 有 `---` 但没闭合 → 整份当正文,且**拒绝写 frontmatter**(否则会把块插进正文中间) */
  unclosed: boolean
  bom: boolean
  eol: '\n' | '\r\n'
  /** 围栏之间的行(不含两行 ---);present=false 时为空 */
  lines: string[]
  /** 正文行(闭合围栏之后) */
  bodyLines: string[]
  /** frontmatter 区超过上限 → 不解析、不改写 */
  opaque: boolean
}

export interface FrontmatterReadResult {
  fields: FrontmatterFields
  /** 认得但形态无法解析的键:读作缺失、写时跳过(绝不覆盖) */
  issues: string[]
  /** refs 段不是本应用认识的形态 → 只读、不显示 chips */
  refsUnparsed: boolean
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8')
}

function isBlankOrComment(line: string): boolean {
  return /^\s*(?:#.*)?$/.test(line)
}

/**
 * 切分:结构层面的事,不做键解析(键解析在 readFrontmatter)。
 * 全程按行处理,`\r` 由 eol 统一承担 —— 纯 LF / 纯 CRLF 的文件可逐字节往返,
 * 混用行尾的文件在写出时会被归一到占多数的那种(已记入文档)。
 */
export function splitFrontmatter(text: string): FrontmatterSplit {
  const bom = text.charCodeAt(0) === 0xfeff
  const body0 = bom ? text.slice(1) : text
  const eol: '\n' | '\r\n' = body0.includes('\r\n') ? '\r\n' : '\n'
  const all = body0.split(/\r?\n/)

  const base: Omit<FrontmatterSplit, 'present' | 'unclosed' | 'lines' | 'bodyLines'> = {
    bom,
    eol,
    opaque: false
  }

  if (!FENCE_RE.test(all[0] ?? '')) {
    return { ...base, present: false, unclosed: false, lines: [], bodyLines: all }
  }

  let close = -1
  for (let i = 1; i < all.length; i++) {
    if (END_FENCE_RE.test(all[i])) {
      close = i
      break
    }
  }

  if (close === -1) {
    // 开了没闭合:整份当正文。绝不在这里「补一个闭合围栏」—— 那会把 frontmatter 之后
    // 的正文整段吞进元数据,是这份文件里最危险的一种「顺手修好」。
    return { ...base, present: false, unclosed: true, lines: [], bodyLines: all }
  }

  const lines = all.slice(1, close)
  return {
    ...base,
    present: true,
    unclosed: false,
    lines,
    bodyLines: all.slice(close + 1),
    opaque: byteLength(lines.join(eol)) > MAX_FRONTMATTER_BYTES
  }
}

// ── 读 ──

/** 顶层键块:head 是键行,块体延伸到下一个顶层键之前(尾部空行/注释行不算块体,保持原样) */
interface KeyBlock {
  key: string
  head: number
  end: number
  /** 键行 `:` 之后的原文 */
  inline: string
}

function scanBlocks(lines: string[]): Map<string, KeyBlock> {
  // 块体边界由「下一个**任意**顶层键」决定,不是「下一个拥有键」——
  // 否则 title 会把夹在它和 created 之间的未知键整段吞进块体,替换 title 时连带删掉它们。
  const allHeads: number[] = []
  for (let i = 0; i < lines.length; i++) if (KEY_RE.test(lines[i])) allHeads.push(i)

  const out = new Map<string, KeyBlock>()
  for (let h = 0; h < allHeads.length; h++) {
    const head = allHeads[h]
    const m = KEY_RE.exec(lines[head])!
    if (!(OWNED_KEYS as readonly string[]).includes(m[1])) continue
    const nextHead = h + 1 < allHeads.length ? allHeads[h + 1] : lines.length
    let end = nextHead
    // 尾部空行/注释行留给「未拥有」路径原样透传,不卷进块体(否则替换该键会顺手删掉它们)
    while (end > head + 1 && isBlankOrComment(lines[end - 1])) end--
    out.set(m[1], { key: m[1], head, end, inline: m[2] })
  }
  return out
}

/** 标量:裸值 / 双引号 / 单引号。**不做类型强制** —— 值里带 `:` 或 `#` 都安全(只按第一个 `:` 切分) */
function parseScalar(raw: string): string | null {
  const s = raw.trim()
  if (s === '') return ''
  if (s.startsWith('#')) return '' // 整行注释
  if (/^[|>]/.test(s)) return null // 块标量:多行,不是我们写的形态
  if (/^[&*!]/.test(s)) return null // 锚点 / 别名 / 标签
  if (/^[[{]/.test(s)) return null // flow 集合:交给各键自己的解析器
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s) as string
    } catch {
      return s.slice(1, -1)
    }
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'")
  }
  return s
}

/** 块体里除空行/注释行以外的内容行 */
function bodyLinesOf(lines: string[], b: KeyBlock): string[] {
  return lines.slice(b.head + 1, b.end).filter((l) => !isBlankOrComment(l))
}

function readScalarKey(
  lines: string[],
  b: KeyBlock | undefined,
  issues: string[],
  key: string
): string | undefined {
  if (!b) return undefined
  if (bodyLinesOf(lines, b).length > 0) {
    // 值另起多行(块标量 / 嵌套 map):不是我们写的形态 → 读作缺失,写时跳过
    issues.push(key)
    return undefined
  }
  const v = parseScalar(b.inline)
  if (v === null) {
    issues.push(key)
    return undefined
  }
  return v
}

function readTags(lines: string[], b: KeyBlock | undefined, issues: string[]): string[] | undefined {
  if (!b) return undefined
  const inline = b.inline.trim()
  if (inline.startsWith('[')) {
    // flow 形态可读(读得懂就显示),但只在 tags 真的变化时才被改写成块形态
    if (!inline.endsWith(']')) {
      issues.push('tags')
      return undefined
    }
    const inner = inline.slice(1, -1)
    const parts = inner === '' ? [] : inner.split(',')
    return normalizeTags(
      parts.map((p) => parseScalar(p) ?? ''),
      MAX_TAGS,
      TAG_MAX
    )
  }
  if (inline !== '' && !inline.startsWith('#')) {
    // `tags: foo` —— YAML 会读成单元素序列,跟着走
    const v = parseScalar(inline)
    if (v === null) {
      issues.push('tags')
      return undefined
    }
    return normalizeTags([v], MAX_TAGS, TAG_MAX)
  }
  const items: string[] = []
  for (const line of bodyLinesOf(lines, b)) {
    const m = SEQ_RE.exec(line)
    if (!m) {
      issues.push('tags')
      return undefined
    }
    const v = parseScalar(m[1])
    if (v === null) {
      issues.push('tags')
      return undefined
    }
    items.push(v)
  }
  return normalizeTags(items, MAX_TAGS, TAG_MAX)
}

/** refs 块里的一个条目:raw 行范围 + 解析出的 ref(解析不出为 null) */
interface RefEntry {
  ref: NoteRef | null
  /** 在 lines 里的下标范围 [start, end) */
  start: number
  end: number
  /** 拥有子键 → 行下标 */
  subLines: Map<string, number>
}

function scanRefEntries(lines: string[], b: KeyBlock): RefEntry[] {
  const entries: RefEntry[] = []
  let i = b.head + 1
  while (i < b.end) {
    const m = SEQ_RE.exec(lines[i])
    if (!m) {
      if (isBlankOrComment(lines[i])) {
        i++
        continue
      }
      return [] // 形态不认识 → 交给调用方判 refsUnparsed
    }
    const start = i
    const subLines = new Map<string, number>()
    const first = SUBKEY_RE.exec(lines[i])
    if (!first) return [] // `- {…}` / `- 裸标量` 之类
    subLines.set(first[1], i)
    i++
    // 续行:缩进更深的 `key: value`;再深一层(嵌套)就不认了
    while (i < b.end) {
      const line = lines[i]
      if (isBlankOrComment(line)) {
        i++
        continue
      }
      if (SEQ_RE.test(line)) break // 下一个条目
      const sub = SUBKEY_RE.exec(line)
      if (!sub || !/^\s/.test(line)) return []
      subLines.set(sub[1], i)
      i++
    }
    const valueOf = (k: string): string | undefined => {
      const at = subLines.get(k)
      if (at === undefined) return undefined
      const v = parseScalar(SUBKEY_RE.exec(lines[at])![2])
      return v === null ? undefined : v
    }
    const type = valueOf('type')
    const key = valueOf('key')
    const ref =
      type && key
        ? {
            type,
            key,
            label: valueOf('label') ?? key,
            ...(valueOf('detail') !== undefined ? { detail: valueOf('detail')! } : {})
          }
        : null
    entries.push({ ref, start, end: i, subLines })
  }
  return entries
}

function readRefs(
  lines: string[],
  b: KeyBlock | undefined
): { refs?: NoteRef[]; unparsed: boolean } {
  if (!b) return { unparsed: false }
  if (b.inline.trim().startsWith('[')) return { unparsed: true } // flow 形态:不解析、不重写
  if (bodyLinesOf(lines, b).length === 0) return { refs: [], unparsed: false }
  const entries = scanRefEntries(lines, b)
  if (entries.length === 0) return { unparsed: true }
  return {
    refs: normalizeRefs(entries.map((e) => e.ref).filter((r): r is NoteRef => r !== null)),
    unparsed: false
  }
}

export function readFrontmatter(split: FrontmatterSplit): FrontmatterReadResult {
  if (!split.present || split.opaque) return { fields: {}, issues: [], refsUnparsed: false }

  const lines = split.lines
  const blocks = scanBlocks(lines)
  const issues: string[] = []
  const fields: FrontmatterFields = {}

  const title = readScalarKey(lines, blocks.get('title'), issues, 'title')
  if (title !== undefined && title !== '') fields.title = title

  // created/updated 是**不透明字符串**:`2026-10-09` 就该原样留着,不能被任何东西转成 Date
  const created = readScalarKey(lines, blocks.get('created'), issues, 'created')
  if (created !== undefined && created !== '') fields.created = created
  const updated = readScalarKey(lines, blocks.get('updated'), issues, 'updated')
  if (updated !== undefined && updated !== '') fields.updated = updated

  const tags = readTags(lines, blocks.get('tags'), issues)
  if (tags !== undefined) fields.tags = tags

  const pb = blocks.get('pinned')
  if (pb) {
    const v = (parseScalar(pb.inline) ?? '').toLowerCase()
    fields.pinned = v === 'true' || v === 'yes' || v === 'on'
  }

  const { refs, unparsed } = readRefs(lines, blocks.get('refs'))
  if (refs !== undefined) fields.refs = refs

  return { fields, issues, refsUnparsed: unparsed }
}

// ── 写 ──

/** YAML 里有歧义或会被吞掉的值形态 —— 命中就加引号 */
const AMBIGUOUS = /^(?:true|false|null|yes|no|on|off|~|-?\d+(?:\.\d+)?)$/i
const UNSAFE_START = /^[\s>|&*!%@`{}[\],#'"-]/
const UNSAFE_INSIDE = /:\s|[\s]#|[\n\r]|\s$/

function scalar(v: string): string {
  if (v === '') return '""'
  if (AMBIGUOUS.test(v) || UNSAFE_START.test(v) || UNSAFE_INSIDE.test(v)) return JSON.stringify(v)
  return v
}

/** 保留行首(键名与 `- ` 前缀),只换 `:` 之后的值 */
function replaceValue(line: string, value: string): string {
  const at = line.indexOf(':')
  return `${line.slice(0, at)}: ${scalar(value)}`
}

function renderRefEntry(ref: NoteRef, indent: string): string[] {
  const out = [
    `${indent}- type: ${scalar(ref.type)}`,
    `${indent}  key: ${scalar(ref.key)}`,
    `${indent}  label: ${scalar(ref.label)}`
  ]
  if (ref.detail !== undefined) out.push(`${indent}  detail: ${scalar(ref.detail)}`)
  return out
}

/**
 * 复用既有条目的原始行,只替换 type/key/label/detail 的值 —— 条目里的**未知子键因此原样存活**。
 * detail 在新值里没有时删掉那一行;新增的拥有子键补在第一行之后。
 */
function patchRefEntry(lines: string[], entry: RefEntry, ref: NoteRef): string[] {
  const want = new Map<string, string | undefined>([
    ['type', ref.type],
    ['key', ref.key],
    ['label', ref.label],
    ['detail', ref.detail]
  ])
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = entry.start; i < entry.end; i++) {
    const line = lines[i]
    const sub = SUBKEY_RE.exec(line)
    const name = sub?.[1]
    if (name !== undefined && want.has(name)) {
      seen.add(name)
      const value = want.get(name)
      if (value === undefined) continue // detail 被移除
      out.push(replaceValue(line, value))
    } else {
      out.push(line) // 未知子键 / 空行 / 注释行:原样
    }
  }
  const indent = /^(\s*)/.exec(lines[entry.start])?.[1] ?? '  '
  for (const [name, value] of want) {
    if (seen.has(name) || value === undefined) continue
    out.push(`${indent}  ${name}: ${scalar(value)}`)
  }
  return out
}

function renderRefs(lines: string[], b: KeyBlock | undefined, refs: NoteRef[]): string[] {
  const existing = b ? scanRefEntries(lines, b) : []
  const used = new Set<number>()
  const out: string[] = []
  for (const ref of refs) {
    const hit = existing.findIndex(
      (e, i) => !used.has(i) && e.ref && e.ref.type === ref.type && e.ref.key === ref.key
    )
    if (hit >= 0) {
      used.add(hit)
      out.push(...patchRefEntry(lines, existing[hit], ref))
    } else {
      out.push(...renderRefEntry(ref, '  '))
    }
  }
  return out
}

/** 渲染一个拥有键;返回 null 表示「这个键不该出现在文件里」 */
function renderKey(
  lines: string[],
  key: OwnedKey,
  value: unknown,
  existing: KeyBlock | undefined
): string[] | null {
  switch (key) {
    case 'title': {
      const v = typeof value === 'string' ? value.trim() : ''
      return v === '' ? null : [`title: ${scalar(v)}`]
    }
    case 'created':
    case 'updated': {
      const v = typeof value === 'string' ? value.trim() : ''
      return v === '' ? null : [`${key}: ${scalar(v)}`]
    }
    case 'tags': {
      const tags = normalizeTags(value, MAX_TAGS, TAG_MAX)
      // 语义未变 → **原样透传**。这一步不只是省 diff:flow 形态(`tags: [a, b]`)读得懂,
      // 但只有真的改了才改写成块形态,否则一次无关的保存就会重排用户的写法。
      if (existing && tagsEqual(readTags(lines, existing, []), tags)) {
        return lines.slice(existing.head, existing.end)
      }
      if (tags.length === 0) return null
      return ['tags:', ...tags.map((t) => `  - ${scalar(t)}`)]
    }
    case 'pinned':
      return value === true ? ['pinned: true'] : null
    case 'refs': {
      const refs = normalizeRefs(value)
      const old = existing ? readRefs(lines, existing) : { refs: undefined, unparsed: false }
      // 同上:未变则原样透传。refsUnparsed 时 old.refs 为 undefined,必然走重写分支 ——
      // 那条路径由 UI 把关(形态不认识时禁用关联编辑,只留显式的「重写 refs 段」按钮)。
      if (existing && !old.unparsed && old.refs && refsEqual(old.refs, refs)) {
        return lines.slice(existing.head, existing.end)
      }
      if (refs.length === 0) return null
      return ['refs:', ...renderRefs(lines, existing, refs)]
    }
  }
}

function tagsEqual(a: string[] | undefined, b: string[]): boolean {
  return a !== undefined && a.length === b.length && a.every((v, i) => v === b[i])
}

function refsEqual(a: NoteRef[], b: NoteRef[]): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => r.type === b[i].type && r.key === b[i].key && r.label === b[i].label && r.detail === b[i].detail)
  )
}

/**
 * 外科式改写:按原顺序走一遍,拥有的键就地替换,其余行(未知键、空行、注释)逐字节透传。
 * 文件里没有、patch 里有的键按规范顺序追加到末尾。
 */
export function patchFrontmatter(
  split: FrontmatterSplit,
  patch: Partial<FrontmatterFields>
): string[] {
  const lines = split.lines
  const blocks = scanBlocks(lines)
  const replaced = new Set<number>()
  const out: string[] = []

  for (let i = 0; i < lines.length; i++) {
    if (replaced.has(i)) continue
    const owned = OWNED_KEYS.find((k) => blocks.get(k)?.head === i)
    if (owned === undefined) {
      out.push(lines[i])
      continue
    }
    const block = blocks.get(owned)!
    for (let k = block.head; k < block.end; k++) replaced.add(k)
    if (Object.prototype.hasOwnProperty.call(patch, owned)) {
      const rendered = renderKey(lines, owned, patch[owned], block)
      if (rendered) out.push(...rendered)
    } else {
      out.push(...lines.slice(block.head, block.end)) // 未被 patch 触及:原样
    }
  }

  for (const key of OWNED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    if (blocks.has(key)) continue
    const rendered = renderKey(lines, key, patch[key], undefined)
    if (rendered) out.push(...rendered)
  }

  return out
}

/** 新建文件时的完整 frontmatter 区 */
export function renderFrontmatter(fields: FrontmatterFields): string[] {
  return patchFrontmatter(
    { present: false, unclosed: false, bom: false, eol: '\n', lines: [], bodyLines: [], opaque: false },
    fields
  )
}

/**
 * 拼回整份文件。`frontmatterLines` 为 null 表示不写 frontmatter 区(裸正文文件)。
 * 行数组一律以 `\n` 为内部约定,这里按检测到的 eol 统一还原。
 */
export function assembleFile(o: {
  bom: boolean
  eol: '\n' | '\r\n'
  frontmatterLines: string[] | null
  body: string
}): string {
  const bodyLines = o.body.split('\n')
  const all =
    o.frontmatterLines === null ? bodyLines : ['---', ...o.frontmatterLines, '---', ...bodyLines]
  return (o.bom ? '﻿' : '') + all.join(o.eol)
}

/** 正文行 → 字符串(读路径用) */
export function bodyText(split: FrontmatterSplit): string {
  return split.bodyLines.join('\n')
}
