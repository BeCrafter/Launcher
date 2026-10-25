// 输入框的内联引用编码(纯函数,main / renderer / 单测共用)。
//
// 为什么用「不可见 token + 装饰器」而不是把 chip 做成富文本节点:
// CodeMirror 的文档仍然是纯字符串 —— 撤销、输入法、粘贴、选区、换行全部沿用它的原生行为,
// 只有绘制层把 token 替换成 chip。删掉 chip 就是删掉 token,不存在两套状态需要对齐。
//
// token 用两个 Unicode 私用区字符包住 encodeURIComponent(key):
//   a:img-xxx   附件
//   m:note:xxx  @ 引用
//   k:sk-diag   技能
// 私用区字符不会出现在正常输入里,token 本身对用户不可见(装饰器整体替换)。
import type { AiAttachment, AiMention, AiUserSegment } from './ai'
import { MAX_MENTIONS } from './ai'

export const INLINE_OPEN = ''
export const INLINE_CLOSE = ''
export const MAX_SEGMENT_COUNT = 240
export const MAX_SEGMENT_TEXT_TOTAL = 64 * 1024
export const MAX_MENTION_QUERY = 80
export const MAX_SLASH_QUERY = 32

export type InlineAttachmentItem = {
  kind: 'attachment'
  key: string
  start: number
  end: number
  raw: string
}
export type InlineMentionItem = {
  kind: 'mention'
  key: string
  start: number
  end: number
  raw: string
}
export type InlineSkillItem = {
  kind: 'skill'
  id: string
  start: number
  end: number
  raw: string
}
export type InlineItem = InlineAttachmentItem | InlineMentionItem | InlineSkillItem

/** 每次新建 RegExp:全局正则有 lastIndex 状态,跨调用复用会漏匹配 */
export function inlineTokenRe(): RegExp {
  return /([^]*)/g
}

export function inlineTokenFor(item: { kind: InlineItem['kind']; key?: string; id?: string }): string {
  const prefix = item.kind === 'attachment' ? 'a' : item.kind === 'mention' ? 'm' : 'k'
  const value = item.kind === 'skill' ? (item.id ?? '') : (item.key ?? '')
  return `${INLINE_OPEN}${prefix}:${encodeURIComponent(value)}${INLINE_CLOSE}`
}

function decode(raw: string, start: number, end: number): InlineItem | null {
  const sep = raw.indexOf(':')
  if (sep <= 0) return null
  const prefix = raw.slice(0, sep)
  let value = ''
  try {
    value = decodeURIComponent(raw.slice(sep + 1))
  } catch {
    return null
  }
  if (value === '') return null
  if (prefix === 'a') return { kind: 'attachment', key: value, start, end, raw }
  if (prefix === 'm') return { kind: 'mention', key: value, start, end, raw }
  if (prefix === 'k') return { kind: 'skill', id: value, start, end, raw }
  return null
}

export function parseInlineItems(doc: string): InlineItem[] {
  const out: InlineItem[] = []
  const re = inlineTokenRe()
  let m: RegExpExecArray | null
  while ((m = re.exec(doc)) !== null) {
    const item = decode(m[1], m.index, m.index + m[0].length)
    if (item) out.push(item)
  }
  return out
}

/**
 * token → 送给模型的纯文本。
 * token 两边是用户文字时,直接删掉会粘成一个词(`看` + chip + `日志` → `看日志` 反而可读),
 * 但英文 `read` + chip + `this` 会变成 `readthis`。统一替换成一个空格再收敛连续空格最稳。
 */
export function stripInlineTokens(doc: string): string {
  return doc
    .replace(inlineTokenRe(), ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/** 归一化技能 id 列表:只保留非空字符串,按首次出现去重 */
export function uniqueSkillIds(raw: readonly unknown[]): string[] {
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const id = v.trim().slice(0, 120)
    if (id === '' || out.includes(id)) continue
    out.push(id)
  }
  return out
}

/**
 * 读取消息里的技能列表:新数据用 skillIds,旧数据只有 skillId。
 * 两个字段同时存在时以 skillIds 的顺序为准,再补上旧字段(去重)。
 */
export function skillIdsOf(msg: { skillIds?: unknown; skillId?: unknown }): string[] {
  const list = Array.isArray(msg.skillIds) ? msg.skillIds : []
  const legacy = typeof msg.skillId === 'string' ? [msg.skillId] : []
  return uniqueSkillIds([...list, ...legacy])
}

/** 文档里仍然存在的引用键(按视觉顺序去重);用于裁剪 composer 的引用数组 */
export function inlineRefKeys(doc: string): { attachments: string[]; mentions: string[]; skillIds: string[] } {
  const attachments: string[] = []
  const mentions: string[] = []
  const skillIds: string[] = []
  for (const item of parseInlineItems(doc)) {
    if (item.kind === 'attachment') {
      if (!attachments.includes(item.key)) attachments.push(item.key)
    } else if (item.kind === 'mention') {
      if (!mentions.includes(item.key)) mentions.push(item.key)
    } else if (!skillIds.includes(item.id)) {
      skillIds.push(item.id)
    }
  }
  return { attachments, mentions, skillIds }
}

/** 文档 → 气泡用的分段(文字与 ref 交错,顺序即视觉顺序) */
export function segmentsFromDoc(doc: string): AiUserSegment[] {
  const items = parseInlineItems(doc)
  if (items.length === 0) return []
  const out: AiUserSegment[] = []
  const seenRefs = new Set<string>()
  const seenSkills = new Set<string>()
  let cursor = 0
  const pushText = (text: string): void => {
    if (text === '') return
    const last = out[out.length - 1]
    if (last?.type === 'text') last.text += text
    else out.push({ type: 'text', text })
  }
  for (const item of items) {
    if (item.kind === 'skill') {
      // 同一技能重复出现不画第二颗 chip(main 的 sanitize 也是这个口径);不同技能各自保留
      if (seenSkills.has(item.id)) {
        pushText(doc.slice(cursor, item.start))
        cursor = item.end
        continue
      }
      seenSkills.add(item.id)
    } else {
      const refKey = `${item.kind}:${item.key}`
      if (seenRefs.has(refKey)) {
        pushText(doc.slice(cursor, item.start))
        cursor = item.end
        continue
      }
      seenRefs.add(refKey)
    }
    pushText(doc.slice(cursor, item.start))
    if (item.kind === 'skill') out.push({ type: 'skill', id: item.id })
    else out.push({ type: 'ref', refType: item.kind, key: item.key })
    cursor = item.end
  }
  pushText(doc.slice(cursor))
  return out
}

/** 分段 → 文档(撤回草稿 / 发送失败恢复) */
export function docFromSegments(segments: AiUserSegment[]): string {
  let out = ''
  for (const s of segments) {
    if (s.type === 'text') out += s.text
    else if (s.type === 'skill') out += inlineTokenFor({ kind: 'skill', id: s.id })
    else out += inlineTokenFor({ kind: s.refType === 'attachment' ? 'attachment' : 'mention', key: s.key })
  }
  return out
}

/**
 * 旧草稿(只有 text + 引用数组,没有 segments)的兜底:
 * 正文在前,引用按 order 依次贴在后面。不会与原输入逐字一致,但内容与外发顺序不丢。
 */
export function fallbackDoc(
  text: string,
  attachments: AiAttachment[],
  mentions: AiMention[],
  skillIds: readonly string[] = []
): string {
  const refs = [
    ...attachments.map((a, i) => ({ order: a.order ?? i, token: inlineTokenFor({ kind: 'attachment', key: a.key }) })),
    ...mentions.map((m, i) => ({ order: m.order ?? 1_000_000 + i, token: inlineTokenFor({ kind: 'mention', key: m.key }) }))
  ].sort((a, b) => a.order - b.order)
  let out = text
  for (const id of uniqueSkillIds(skillIds)) {
    out += `${out === '' || out.endsWith('\n') ? '' : '\n'}${inlineTokenFor({ kind: 'skill', id })} `
  }
  if (refs.length > 0) {
    if (out !== '' && !out.endsWith('\n')) out += '\n'
    out += refs.map((r) => `${r.token} `).join('')
  }
  return out
}

// ── 输入触发词 ──

export interface QueryHit {
  /** 触发符在文档里的位置 */
  start: number
  /** 触发符到光标之间的查询词 */
  query: string
  /** 触发符落在哪种边界上(只有技能 `/` 关心,`@` 不设) */
  boundary?: SlashBoundary
}

export type SlashBoundary = 'line' | 'space' | 'chip' | 'cjk'

/** `@` 查询:最后一个 @ 到光标之间不能有空白 */
export function mentionQueryAt(doc: string, pos: number): QueryHit | null {
  const head = Math.max(0, Math.min(pos, doc.length))
  const before = doc.slice(0, head)
  const at = before.lastIndexOf('@')
  if (at === -1) return null
  const query = before.slice(at + 1)
  if (query.length > MAX_MENTION_QUERY || /[\s\n]/.test(query)) return null
  return { start: at, query }
}

/** 中日韩文字与全角标点(假名、谚文、CJK 标点、全角 ASCII 变体) */
const CJK_BOUNDARY = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/

/**
 * `/` 前面的字符落在哪种词边界上 —— 决定这个 `/` 是技能命令还是普通斜线。
 *
 * 必须区分,否则 `src/main`、`https://…`、`./run.sh` 这类写法会把技能菜单
 * 一直顶在屏幕上。但判断条件不能只有空白:
 *   · 中文没有词间空格,`总结一下/` 才是最自然的写法,只认空白等于中文用户敲不出菜单;
 *   · chip(引用/附件/技能)是独立的块,紧跟其后的 `/` 是新命令,不会延长成路径。
 * 因此边界 = 行首 / 空白 / chip 之后 / 中日韩文字或全角标点之后;
 * ASCII 字母、数字、`:` `.` `/` `~` `-` 等一律不算,路径与 URL 继续安全。
 *
 * 返回 null 表示不是边界。`cjk` 与其它几种的区别见 AiComposer:中文里的 `/`
 * 也可能是「上午/下午」这种并列,菜单要按「有没有匹配项」决定留不留。
 */
export function slashBoundaryAt(prev: string): SlashBoundary | null {
  if (prev === '') return 'line'
  if (/\s/.test(prev)) return 'space'
  if (prev === INLINE_CLOSE) return 'chip'
  if (CJK_BOUNDARY.test(prev)) return 'cjk'
  return null
}

/** 同 slashBoundaryAt,只要布尔值(工具栏按钮插入 `/` 时用) */
export function isSlashBoundary(prev: string): boolean {
  return slashBoundaryAt(prev) !== null
}

/**
 * `/` 技能查询:只在词边界(见 slashBoundaryAt)之后触发,避免把 `/usr/bin` 当成命令。
 * 查询词里再出现 `/` 或空白即关闭(路径、URL 都会自然退出菜单)。
 */
export function slashQueryAt(doc: string, pos: number): QueryHit | null {
  const head = Math.max(0, Math.min(pos, doc.length))
  const before = doc.slice(0, head)
  const at = before.lastIndexOf('/')
  if (at === -1) return null
  const boundary = slashBoundaryAt(at === 0 ? '' : before[at - 1])
  if (boundary === null) return null
  const query = before.slice(at + 1)
  if (query.length > MAX_SLASH_QUERY || /[\s/]/.test(query)) return null
  return { start: at, query, boundary }
}

/** 删除触发符到光标之间的查询词,保留光标后面的文字 */
export function cutQuery(doc: string, hit: QueryHit, pos: number): { doc: string; pos: number } {
  const head = Math.max(hit.start, Math.min(pos, doc.length))
  return { doc: doc.slice(0, hit.start) + doc.slice(head), pos: hit.start }
}

// ── 入参收敛(main) ──

function safeText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

/**
 * 用户消息内联分段的收敛。
 *
 * 只信任「确实存在」的引用键:附件/引用数组已在同一层收敛过,分段里引用不存在的 key
 * 一律丢弃(否则历史气泡会渲染一颗永远找不到数据的 chip)。没有任何 ref/skill 时
 * 返回空数组 —— 纯文字消息不需要重复存一份分段。
 */
export function sanitizeUserSegments(
  raw: unknown,
  attachments: AiAttachment[],
  mentions: AiMention[],
  skillIds: readonly string[] = []
): AiUserSegment[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const attachmentKeys = new Set(attachments.map((a) => a.key))
  const mentionKeys = new Set(mentions.map((m) => m.key))
  const allowedSkills = new Set(uniqueSkillIds(skillIds))
  const out: AiUserSegment[] = []
  let textTotal = 0
  let hasRef = false
  const seenSkills = new Set<string>()

  for (const item of raw) {
    if (out.length >= MAX_SEGMENT_COUNT) break
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    if (o.type === 'text') {
      const text = safeText(o.text, MAX_SEGMENT_TEXT_TOTAL)
      if (text === '') continue
      textTotal += text.length
      if (textTotal > MAX_SEGMENT_TEXT_TOTAL) break
      const last = out[out.length - 1]
      if (last?.type === 'text') last.text += text
      else out.push({ type: 'text', text })
      continue
    }
    if (o.type === 'ref') {
      const key = typeof o.key === 'string' ? o.key : ''
      const refType = o.refType
      if (refType !== 'attachment' && refType !== 'mention') continue
      const exists = refType === 'attachment' ? attachmentKeys.has(key) : mentionKeys.has(key)
      if (!exists) continue
      if (
        out.some(
          (s) => s.type === 'ref' && s.refType === refType && s.key === key
        )
      ) {
        continue
      }
      // 引用数组本身有上限,分段也不该超过它(两者独立收敛,避免互相撑大)
      const refCount = out.filter((s) => s.type === 'ref').length
      if (refCount >= MAX_MENTIONS + 6) continue
      out.push({ type: 'ref', refType, key })
      hasRef = true
      continue
    }
    if (o.type === 'skill') {
      const id = typeof o.id === 'string' ? o.id.slice(0, 120) : ''
      if (id === '' || !allowedSkills.has(id) || seenSkills.has(id)) continue
      seenSkills.add(id)
      out.push({ type: 'skill', id })
      hasRef = true
      continue
    }
    continue
  }

  return hasRef ? out : []
}
