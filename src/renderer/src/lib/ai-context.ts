// 上下文用量估算(展示用,不参与真实请求)。
//
// 口径:
//   · **锚点**:最近一次带 usage 的助手回复。它的 totalTokens 是服务端给出的真实读数,
//     已经包含此前的对话、系统提示词与工具 schema —— 比逐条文本估算准得多。
//   · 锚点之后的消息(工具结果、刚发出还没收到回复的用户消息)按文本估算后叠加。
//   · 输入框里的草稿不在 messages 里,单独按文字/附件估算。
//   · 从未收到过 usage 的旧会话没有锚点:显示 0,而不是假装能算出系统提示词的大小。
//
// 估算只追求「量级正确」:CJK 约 1 token/字,拉丁文本约 4 字符/token;
// 图片按固定值计(实际取决于尺寸与模型,界面提示里明确写了「估算」)。

import type { AiAttachment, AiMessage, AiMention, AiUsage } from '@shared/ai'
import { utf8Bytes } from '@shared/text'

/** 单张图片的粗略 token 成本(不同模型差异很大,只用于量级) */
export const IMAGE_TOKEN_ESTIMATE = 1_200

/** 引用/附件本身的结构开销(编号、文件名、围栏说明) */
const REF_OVERHEAD = 12

/** 会话基线(服务端锚点 + 锚点之后消息)的拆分;卡片要逐项展示 */
export interface UsageBaseBreakdown {
  /** 最近一条 totalTokens > 0 的助手消息下标;-1 表示还没有可信读数 */
  anchorIndex: number
  /** 锚点消息的 usage;没有锚点时为 null */
  anchorUsage: AiUsage | null
  anchorTokens: number
  /** 锚点之后新增的消息条数(含流式中的助手消息与工具结果) */
  trailingCount: number
  trailingTokens: number
  baseTokens: number
  /** 没有锚点时,已有历史消息的条数(卡片要说明这些消息尚未计入) */
  unanchoredMessageCount: number
}

/** 输入框草稿的拆分;用于悬停明细卡 */
export interface DraftBreakdown {
  textTokens: number
  attachmentTokens: number
  mentionTokens: number
  draftTokens: number
  chars: number
  attachmentCount: number
  textCount: number
  imageCount: number
  mentionCount: number
  /** 只引用了选中片段的笔记条数(整篇正文仍不计入) */
  quotedMentionCount: number
}

export interface ContextBreakdown extends UsageBaseBreakdown, DraftBreakdown {
  used: number
  limit: number
  /** 不钳位,用于 >100% 文案 */
  rawRatio: number
  remaining: number
  overBy: number
  pctLabel: string
}

export function estimateTokens(text: string): number {
  if (text === '') return 0
  // CJK、日文假名、韩文按 1 字 ≈ 1 token;其余按 4 字符 ≈ 1 token
  const cjk = (text.match(/[぀-ヿ㐀-鿿가-힯]/g) ?? []).length
  return Math.ceil(cjk + (text.length - cjk) / 4)
}

function attachmentTokens(a: AiAttachment): number {
  if (a.type === 'image') return a.trimmed ? 4 : IMAGE_TOKEN_ESTIMATE
  return estimateTokens(a.content) + REF_OVERHEAD
}

function mentionTokens(m: AiMention): number {
  // 整篇笔记正文在发送时才读取,渲染层拿不到;这里只计引用本身。
  // 实际正文会由服务端 usage 在下一轮如实反映出来。
  return REF_OVERHEAD + estimateTokens(m.label) + (m.quote ? estimateTokens(m.quote) : 0)
}

function blockTokens(block: unknown): number {
  if (typeof block !== 'object' || block === null) return 0
  const b = block as Record<string, unknown>
  if (b.type === 'text' && typeof b.text === 'string') return estimateTokens(b.text)
  if (b.type === 'thinking' && typeof b.thinking === 'string') return estimateTokens(b.thinking)
  if (b.type === 'toolCall') {
    let args = ''
    try {
      args = JSON.stringify(b.args ?? {})
    } catch {
      args = ''
    }
    return REF_OVERHEAD + estimateTokens(args)
  }
  if (b.type === 'card' || b.type === 'suggest') {
    let json = ''
    try {
      json = JSON.stringify(b)
    } catch {
      json = ''
    }
    return estimateTokens(json)
  }
  return 0
}

export function estimateMessageTokens(m: AiMessage): number {
  let n = 0
  for (const b of m.blocks) n += blockTokens(b)
  if (m.role === 'user') {
    for (const a of m.attachments ?? []) n += attachmentTokens(a)
    for (const ment of m.mentions ?? []) n += mentionTokens(ment)
  }
  return n
}

/**
 * 当前会话基线的拆分。
 * 没有锚点时返回 0 —— 不拿锚点之后的消息硬凑,但把历史消息数带出去,
 * 让悬停卡能说明「这些消息还没被服务端读数覆盖」。
 */
export function usageBaseBreakdown(messages: AiMessage[]): UsageBaseBreakdown {
  let anchorIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && (m.usage?.totalTokens ?? 0) > 0) {
      anchorIndex = i
      break
    }
  }
  if (anchorIndex === -1) {
    return {
      anchorIndex: -1,
      anchorUsage: null,
      anchorTokens: 0,
      trailingCount: 0,
      trailingTokens: 0,
      baseTokens: 0,
      unanchoredMessageCount: messages.length
    }
  }
  const anchorMsg = messages[anchorIndex]
  const anchorUsage = anchorMsg?.role === 'assistant' ? (anchorMsg.usage ?? null) : null
  const anchorTokens = anchorUsage?.totalTokens ?? 0
  let trailingTokens = 0
  for (let i = anchorIndex + 1; i < messages.length; i++) {
    trailingTokens += estimateMessageTokens(messages[i])
  }
  return {
    anchorIndex,
    anchorUsage,
    anchorTokens,
    trailingCount: messages.length - anchorIndex - 1,
    trailingTokens,
    baseTokens: anchorTokens + trailingTokens,
    unanchoredMessageCount: 0
  }
}

/**
 * 当前会话已用的 token 估算。
 * 返回 0 表示「还没有可信读数」—— 界面仍显示 0%,但 tooltip 会说明尚未开始。
 */
export function usageBaseTokens(messages: AiMessage[]): number {
  return usageBaseBreakdown(messages).baseTokens
}

/** 输入框草稿:文字 + 附件正文 + 引用标签(笔记正文不可见,不计入) */
export function draftBreakdown(
  text: string,
  attachments: AiAttachment[],
  mentions: AiMention[]
): DraftBreakdown {
  const textTokens = estimateTokens(text)
  let attachmentTotal = 0
  for (const a of attachments) attachmentTotal += attachmentTokens(a)
  let mentionTotal = 0
  for (const m of mentions) mentionTotal += mentionTokens(m)
  return {
    textTokens,
    attachmentTokens: attachmentTotal,
    mentionTokens: mentionTotal,
    draftTokens: textTokens + attachmentTotal + mentionTotal,
    chars: text.length,
    attachmentCount: attachments.length,
    textCount: attachments.filter((a) => a.type === 'text').length,
    imageCount: attachments.filter((a) => a.type === 'image').length,
    mentionCount: mentions.length,
    quotedMentionCount: mentions.filter((m) => m.quote !== undefined).length
  }
}

export function estimateDraftTokens(
  text: string,
  attachments: AiAttachment[],
  mentions: AiMention[]
): number {
  return draftBreakdown(text, attachments, mentions).draftTokens
}

/** 0..1;窗口值非法时返回 0 */
export function contextRatio(used: number, contextWindow: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(contextWindow) || contextWindow <= 0) return 0
  return Math.max(0, Math.min(1, used / contextWindow))
}

/**
 * 环与悬停卡共用的百分比文案。
 * 超限时不钳成 100%,明确显示 >100%(弧本身仍由 contextRatio 钳位)。
 */
export function contextPercentLabel(used: number, limit: number): string {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0 || used <= 0) return '0%'
  const ratio = used / limit
  if (ratio < 0.01) return '<1%'
  if (ratio > 1) return '>100%'
  return `${Math.round(ratio * 100)}%`
}

/** 一次算齐环与悬停卡需要的全部读数,避免两处各算一遍导致数字漂移 */
export function contextBreakdown(
  messages: AiMessage[],
  text: string,
  attachments: AiAttachment[],
  mentions: AiMention[],
  limit: number
): ContextBreakdown {
  const base = usageBaseBreakdown(messages)
  const draft = draftBreakdown(text, attachments, mentions)
  const used = base.baseTokens + draft.draftTokens
  const valid = Number.isFinite(limit) && limit > 0
  const rawRatio = valid && Number.isFinite(used) ? used / limit : 0
  return {
    ...base,
    ...draft,
    used,
    limit,
    rawRatio,
    remaining: valid ? Math.max(0, limit - used) : 0,
    overBy: valid ? Math.max(0, used - limit) : 0,
    pctLabel: contextPercentLabel(used, limit)
  }
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}
