// 宿主消息模型 ↔ pi 消息模型的双向映射(内部存储/渲染用前者,送进模型与回放用后者)
//
// 这是「Agent 数据格式」最容易出错的一层,两条硬约束:
//  ① **transcript 必须自洽**:Anthropic/OpenAI 都要求每个 assistant 的 toolCall 后面跟一条对应的 toolResult。
//     用户中途停止时必然留下「有 toolCall、无 result」的半截消息 —— 回放前必须补齐合成结果,
//     否则下一次发消息会被端点以 400 拒绝(而且错误信息通常很难看懂)。
//  ② **保真回传**:thinking 块的 thinkingSignature(redacted 推理的密文载荷)与 toolCall 的
//     thoughtSignature 必须原样带回模型,丢了会破坏多轮推理连续性。
import type {
  AssistantMessage,
  Message as PiMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage as PiToolResultMessage,
  UserMessage as PiUserMessage
} from '@earendil-works/pi-ai'
import type {
  AiAssistantMessage,
  AiContentBlock,
  AiMention,
  AiMessage,
  AiToolResultMessage,
  AiUsage
} from '../../shared/ai'

/** 中断产生的合成结果文案(回放时补进 transcript,让后续轮次仍然合法) */
const ABORTED_TOOL_RESULT = '（本轮已中断，该调用未执行）'

// ── 宿主 → pi ──

function blocksToPiContent(
  blocks: AiContentBlock[]
): (TextContent | ThinkingContent | ToolCall)[] {
  const out: (TextContent | ThinkingContent | ToolCall)[] = []
  for (const b of blocks) {
    if (b.type === 'text') {
      if (b.text.trim() !== '') out.push({ type: 'text', text: b.text })
    } else if (b.type === 'thinking') {
      // redacted 的正文为空但签名里带着密文 —— 空正文也要保留该块,否则会丢密文
      if (b.thinking.trim() !== '' || b.thinkingSignature) {
        out.push({
          type: 'thinking',
          thinking: b.thinking,
          ...(b.thinkingSignature ? { thinkingSignature: b.thinkingSignature } : {}),
          ...(b.redacted ? { redacted: true } : {})
        })
      }
    } else if (b.type === 'toolCall') {
      out.push({
        type: 'toolCall',
        id: b.id,
        name: b.name,
        arguments: b.args as ToolCall['arguments'],
        ...(b.thoughtSignature ? { thoughtSignature: b.thoughtSignature } : {})
      })
    }
    // image 不在此列:assistant 消息不会是图片(pi 的 AssistantMessage.content 也只允许 text/thinking/toolCall)
    // card / suggest 是宿主扩展块,不进模型上下文
  }
  return out
}

/** @ 引用转成模型可读的上下文行(引用的是本机真实对象,模型据此知道 "@" 指什么) */
function mentionLine(mentions: AiMention[] | undefined): string {
  if (!mentions || mentions.length === 0) return ''
  const parts = mentions.map((m) =>
    m.type === 'agent' ? `${m.label}（LaunchAgent · ${m.scope ?? 'user'}）` : `${m.label}（定时任务）`
  )
  return `[用户引用了本机任务：${parts.join('、')}]\n`
}

/** 协议 id → pi 的 api 名(回放历史消息时按原协议标注,跨协议切换也仍然自洽) */
const API_OF: Record<string, string> = {
  anthropic: 'anthropic-messages',
  'openai-compatible': 'openai-completions'
}

/**
 * 宿主消息数组 → pi transcript。
 * 会做两处修复:① 用户消息带上引用上下文 ② 补全被中断的 toolCall 的合成结果。
 */
export function toPiMessages(messages: AiMessage[]): PiMessage[] {
  // 先把「已有哪些 toolCall 得到过结果」一次收齐:assistant 消息出现在结果之前,
  // 逐条向前扫描会误判成"未应答"而重复补合成结果
  const answered = new Set(
    messages.filter((m) => m.role === 'toolResult').map((m) => m.toolCallId)
  )
  const out: PiMessage[] = []
  for (const m of messages) {
    if (m.role === 'toolResult') {
      out.push(toPiToolResult(m))
      continue
    }
    if (m.role === 'user') {
      const texts = m.blocks
        .filter((b): b is Extract<AiContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
      const images = m.blocks
        .filter((b): b is Extract<AiContentBlock, { type: 'image' }> => b.type === 'image')
        .map((b) => ({ type: 'image' as const, data: b.data, mimeType: b.mimeType }))
      const text = mentionLine(m.mentions) + texts
      const user: PiUserMessage = {
        role: 'user',
        // 只有图片时 content 以空串文本兜底:部分端点不接受纯空内容
        content: images.length > 0 ? [{ type: 'text', text }, ...images] : text,
        timestamp: m.timestamp
      }
      out.push(user)
      continue
    }
    // assistant:先把该轮所有 toolCall 输出(顺序与模型生成一致),缺少结果的立刻补合成结果,
    // 保证「toolCall → toolResult」的相邻约束在任何中断点都成立
    const content = blocksToPiContent(m.blocks)
    if (content.length > 0 || m.errorMessage) {
      out.push({
        role: 'assistant',
        content,
        api: API_OF[m.provider ?? ''] ?? 'anthropic-messages',
        provider: m.provider === 'openai-compatible' ? 'openai-compatible' : 'anthropic',
        model: m.model ?? '',
        usage: toPiUsage(m.usage),
        stopReason: m.stopReason === 'pending' ? 'stop' : m.stopReason,
        ...(m.errorMessage ? { errorMessage: m.errorMessage } : {})
      } as AssistantMessage)
    }
    for (const b of m.blocks) {
      if (b.type === 'toolCall' && !answered.has(b.id)) {
        out.push(toPiToolResult(syntheticAbortResult(b, m.timestamp)))
        answered.add(b.id)
      }
    }
  }
  return out
}

function syntheticAbortResult(
  call: Extract<AiContentBlock, { type: 'toolCall' }>,
  ts: number
): AiToolResultMessage {
  return {
    role: 'toolResult',
    id: `aborted-${call.id}`,
    toolCallId: call.id,
    toolName: call.name,
    blocks: [{ type: 'text', text: ABORTED_TOOL_RESULT }],
    isError: true,
    status: 'warn',
    durationMs: 0,
    timestamp: ts
  }
}

function toPiToolResult(m: AiToolResultMessage): PiToolResultMessage {
  const content = m.blocks
    .filter((b) => b.type === 'text' || b.type === 'image')
    .map((b) =>
      b.type === 'text'
        ? ({ type: 'text', text: b.text } as TextContent)
        : ({ type: 'image', data: b.data, mimeType: b.mimeType } as const)
    )
  return {
    role: 'toolResult',
    toolCallId: m.toolCallId,
    toolName: m.toolName,
    // 空结果也要有内容:部分端点拒绝空 content
    content: content.length > 0 ? content : [{ type: 'text', text: '（无输出）' }],
    isError: m.isError,
    timestamp: m.timestamp
  } as PiToolResultMessage
}

/** 宿主用量 → pi 用量(pi 的字段是超集,缺的补 0) */
function toPiUsage(u: AiUsage | null | undefined): AssistantMessage['usage'] {
  return {
    input: u?.input ?? 0,
    output: u?.output ?? 0,
    cacheRead: u?.cacheRead ?? 0,
    cacheWrite: u?.cacheWrite ?? 0,
    totalTokens: u?.totalTokens ?? 0,
    ...(u?.reasoning != null ? { reasoning: u.reasoning } : {}),
    cost: {
      input: u?.cost?.input ?? 0,
      output: u?.cost?.output ?? 0,
      cacheRead: u?.cost?.cacheRead ?? 0,
      cacheWrite: u?.cost?.cacheWrite ?? 0,
      total: u?.cost?.total ?? 0
    }
  }
}

// ── pi → 宿主 ──

export function fromPiUsage(u: AssistantMessage['usage'] | undefined): AiUsage | null {
  if (!u) return null
  return {
    input: u.input,
    output: u.output,
    cacheRead: u.cacheRead,
    cacheWrite: u.cacheWrite,
    ...(u.reasoning != null ? { reasoning: u.reasoning } : {}),
    totalTokens: u.totalTokens,
    cost: {
      input: u.cost?.input ?? 0,
      output: u.cost?.output ?? 0,
      cacheRead: u.cost?.cacheRead ?? 0,
      cacheWrite: u.cost?.cacheWrite ?? 0,
      total: u.cost?.total ?? 0
    }
  }
}

/** pi 助手消息的内容块 → 宿主内容块(剪掉空文本块;保留 thinking 签名) */
export function fromPiContent(content: AssistantMessage['content']): AiContentBlock[] {
  const out: AiContentBlock[] = []
  for (const b of content) {
    if (b.type === 'text') {
      if (b.text !== '') out.push({ type: 'text', text: b.text })
    } else if (b.type === 'thinking') {
      out.push({
        type: 'thinking',
        thinking: b.thinking,
        ...(b.redacted ? { redacted: true } : {}),
        ...(b.thinkingSignature ? { thinkingSignature: b.thinkingSignature } : {})
      })
    } else if (b.type === 'toolCall') {
      out.push({
        type: 'toolCall',
        id: b.id,
        name: b.name,
        args: (b.arguments ?? {}) as Record<string, unknown>,
        ...(b.thoughtSignature ? { thoughtSignature: b.thoughtSignature } : {})
      })
    }
  }
  return out
}

/** pi 工具结果 → 宿主工具结果(isError 布尔 → 三态 status:中断/错误都算 err,中断归 warn) */
export function fromPiToolResult(
  r: PiToolResultMessage,
  extra: { label?: string; durationMs: number; write?: boolean }
): AiToolResultMessage {
  const aborted = r.content.some((c) => c.type === 'text' && c.text.includes(ABORTED_TOOL_RESULT))
  return {
    role: 'toolResult',
    id: `tr-${r.toolCallId}`,
    toolCallId: r.toolCallId,
    toolName: r.toolName,
    ...(extra.label ? { label: extra.label } : {}),
    blocks: r.content.map((c) =>
      c.type === 'text'
        ? ({ type: 'text', text: c.text } as AiContentBlock)
        : ({ type: 'image', data: c.data, mimeType: c.mimeType } as AiContentBlock)
    ),
    isError: r.isError,
    status: r.isError ? (aborted ? 'warn' : 'err') : 'ok',
    durationMs: extra.durationMs,
    ...(extra.write ? { write: true } : {}),
    timestamp: r.timestamp
  }
}

/** 构造一条宿主助手消息(流式开始时创建,结束时回填用量与终止原因) */
export function newAssistantMessage(id: string, model: string, provider: string): AiAssistantMessage {
  return { role: 'assistant', id, blocks: [], stopReason: 'pending', model, provider, timestamp: Date.now() }
}
