// 会话转录:单条复制与批量导出共用。
// 只取消息的 text 块 —— thinking/工具调用/卡片/工具结果是执行过程,不是用户要汇总的内容。
import type { AiAssistantMessage, AiMessage, AiUserMessage } from '@shared/ai'
import { formatClock, formatDuration } from './ai-time'

export interface TranscriptLabels {
  user: string
  assistant: string
  /** “完成于” */
  completedAt: string
  /** “整轮” */
  duration: string
  /** “附件” */
  attachments: string
}

/** 当前可选的渲染项:用户消息 + 助手回复(toolResult 不单独可选) */
export function selectableIds(messages: AiMessage[]): string[] {
  return messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => m.id)
}

export function messageText(msg: AiMessage): string {
  if (msg.role === 'toolResult') return ''
  return msg.blocks
    .filter((b): b is Extract<AiMessage['blocks'][number], { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
    .trim()
}

function attachmentNames(msg: AiUserMessage): string[] {
  if (!Array.isArray(msg.attachments)) return []
  return msg.attachments
    .map((a) => (typeof a.name === 'string' ? a.name.trim() : ''))
    .filter((n) => n !== '')
}

function heading(msg: AiMessage, labels: TranscriptLabels, stamp: number): string {
  if (msg.role === 'assistant') {
    const parts = [labels.assistant]
    if (msg.finishedAt !== undefined) parts.push(`${labels.completedAt} ${formatClock(msg.finishedAt)}`)
    else parts.push(formatClock(stamp))
    if (msg.durationMs !== undefined) parts.push(`${labels.duration} ${formatDuration(msg.durationMs)}`)
    return `## ${parts.join(' · ')}`
  }
  return `## ${labels.user} · ${formatClock(stamp)}`
}

/**
 * 选中消息 → Markdown 转录。
 * 顺序跟随原消息顺序;选中一条助手消息不会连带它的 toolResult(结果不进转录)。
 */
export function buildTranscript(
  messages: AiMessage[],
  selectedIds: Iterable<string>,
  labels: TranscriptLabels
): string {
  const selected = new Set(selectedIds)
  const sections: string[] = []
  for (const m of messages) {
    if (m.role === 'toolResult' || !selected.has(m.id)) continue
    const text = messageText(m)
    const names = m.role === 'user' ? attachmentNames(m) : []
    if (text === '' && names.length === 0) continue
    const body: string[] = [heading(m, labels, m.timestamp)]
    if (names.length > 0) body.push(`${labels.attachments}: ${names.join(', ')}`)
    if (text !== '') body.push(text)
    sections.push(body.join('\n\n'))
  }
  return sections.join('\n\n')
}

/** 导出文件名:launcher-ai-YYYYMMDD-HHmm.md */
export function transcriptFileName(date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `launcher-ai-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.md`
}

/** 单条复制:助手回复只取正文;用户消息带附件文件名 */
export function singleMessageCopy(msg: AiMessage, labels: TranscriptLabels): string {
  if (msg.role === 'toolResult') return ''
  const text = messageText(msg)
  if (msg.role === 'assistant') return text
  const names = attachmentNames(msg as AiUserMessage)
  if (names.length === 0) return text
  return [`${labels.attachments}: ${names.join(', ')}`, text].filter((s) => s !== '').join('\n\n')
}

/** 助手回复是否还有可复制的文本(复制按钮禁用态用) */
export function hasCopyableText(msg: AiAssistantMessage): boolean {
  return messageText(msg) !== ''
}
