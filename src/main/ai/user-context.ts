// 用户消息 → 模型上下文:唯一拼接点。
//
// 历史回放(message-map.toPiMessages)与本轮 prompt(chat-service.runAgent)必须共用这里,
// 否则「历史里的用户消息」和「当前这轮的同一句话」会拼出两种内容(引用/附件各缺一块)。
import type { AiContentBlock, AiMention, AiUserMessage } from '../../shared/ai'
import type { ImageContent } from '@earendil-works/pi-ai'
import { attachmentContext, hasImageAttachments, toPiImages } from './attachments'
import { mentionContext, type NoteContext } from './note-context'

/** 用户消息里的纯文本块(不含图片/其他扩展块) */
export function userTextBlocks(m: AiUserMessage): string {
  return m.blocks
    .filter((b): b is Extract<AiContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

/**
 * 用户消息的完整文本上下文:@ 引用 + 附件说明/正文 + 用户原文。
 * 图片输入由调用方另行通过 prompt(text, images) / 内容块传递。
 */
export function userMessageContext(
  m: AiUserMessage,
  notes: Map<string, NoteContext> | undefined
): string {
  const text =
    referenceOrderLine(m) +
    mentionContext(m.mentions, notes) +
    attachmentContext(m.attachments) +
    userTextBlocks(m)
  // 只有图片/旧版 image block 时,文本必须非空 —— Anthropic 会拒绝空文本块
  if (text.trim() === '' && (hasImageAttachments(m.attachments) || hasLegacyImages(m))) {
    return '（用户发送了图片）'
  }
  return text
}

/**
 * 引用与附件共用 order 序号:跨类别的总顺序单独写一行。
 * 后面的 note/file 正文仍按各自类别成块,但模型能先看到用户实际添加的完整顺序。
 */
function referenceOrderLine(m: AiUserMessage): string {
  const mentions = m.mentions ?? []
  const attachments = m.attachments ?? []
  if (mentions.length === 0 || attachments.length === 0) return ''
  const labelOfMention = (x: AiMention): string => {
    if (x.type === 'note') return `笔记「${x.label}」`
    if (x.type === 'cron') return `定时任务「${x.label}」`
    return `任务「${x.label}」`
  }
  const refs = [
    ...mentions.map((x, i) => ({ order: x.order ?? 1_000_000 + i, label: labelOfMention(x) })),
    ...attachments.map((a, i) => ({
      order: a.order ?? i,
      label: `${a.type === 'image' ? '图片' : '文件'}「${a.name}」`
    }))
  ].sort((a, b) => a.order - b.order)
  return `[本条消息的引用顺序：${refs.map((r) => r.label).join(' → ')}]\n`
}

function hasLegacyImages(m: AiUserMessage): boolean {
  return m.blocks.some((b) => b.type === 'image' && b.data !== '')
}

/** 当前轮的用户消息:send() 刚把它 push 到末尾,不反向 find(避免未来插入新消息后取错) */
export function lastUserMessage(session: { messages: Array<{ role: string }> }): AiUserMessage | undefined {
  const last = session.messages[session.messages.length - 1]
  return last?.role === 'user' ? (last as AiUserMessage) : undefined
}

/** 当前轮随 prompt 一起送出的图片:新附件 + 旧数据里的 image block */
export function lastUserImages(m: AiUserMessage | undefined): ImageContent[] {
  if (!m) return []
  const fromAttachments = toPiImages(m.attachments)
  const fromBlocks = m.blocks
    .filter((b): b is Extract<AiContentBlock, { type: 'image' }> => b.type === 'image' && b.data !== '')
    .map((b) => ({ type: 'image' as const, data: b.data, mimeType: b.mimeType }))
  return [...fromAttachments, ...fromBlocks]
}
