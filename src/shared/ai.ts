// AI 助手契约(main ↔ preload ↔ renderer 单一事实来源)
//
// 消息模型按 docs/design/ai-message-model-gap.md 的结论落地:**内容块数组**而非固定槽位——
// pi 的一条助手消息里文本与工具调用可以交替多次(text → toolCall → text → toolCall),
// 固定槽位(thinking/steps/text/cards)表达不了这种混排,也承载不了 thinking/图片/用量/7 态 stopReason。
//
// 分层(同文档 §3):
//   通用层 = text / thinking / image / toolCall 四种块(直接镜像 pi-ai 的 AssistantMessage.content)
//   扩展层 = card / suggest 两种块(pi-agent-core 的 CustomAgentMessages 明确留给宿主的口子)
// 审批不在这两层里:它是宿主在 beforeToolCall 拦下来的钩子,由工具调用管线触发,不是"内容里的一种卡"。

import type { AgentScope } from './models'

// ── 通用内容块 ──

export interface AiTextBlock {
  type: 'text'
  text: string
}

/** 推理正文。redacted=true 时载荷被加密进 thinkingSignature,须原样回传以维持多轮连续性 */
export interface AiThinkingBlock {
  type: 'thinking'
  thinking: string
  redacted?: boolean
  thinkingSignature?: string
}

/** 图片块:用户输入与工具结果都能带(截图类工具结果) */
export interface AiImageBlock {
  type: 'image'
  /** base64(不含 data: 前缀) */
  data: string
  mimeType: string
}

/** 工具调用。id 用于与 AiToolResultMessage 配对(pi 用 id,不用数组下标) */
export interface AiToolCallBlock {
  type: 'toolCall'
  id: string
  name: string
  /** 人类可读名(pi 的 AgentTool.label;不用 name 直接当显示名) */
  label?: string
  args: Record<string, unknown>
  thoughtSignature?: string
}

// ── 扩展内容块(宿主自定义) ──

export interface AiReportItem {
  level: 'ok' | 'warn' | 'err'
  text: string
  /** 点击「前往处理」跳转的模块 */
  goto?: 'agents' | 'crontab' | 'services'
}

export interface AiReportCard {
  kind: 'report'
  items: AiReportItem[]
}

export interface AiCronCard {
  kind: 'cron'
  cmd: string
  expr: string
}

export interface AiPlistCard {
  kind: 'plist'
  /** 草稿目标路径(展示用;可为空表示仅预览) */
  path?: string
  xml: string
}

/** 授权卡状态:pending 等待用户 → approved 已授权 / cancelled 已取消 */
export type AiApproveState = 'pending' | 'approved' | 'cancelled'

export interface AiApproveCard {
  kind: 'approve'
  /** 触发授权的工具名 */
  tool: string
  /** 被拦截的那次调用(renderer 回传决策时要用它配对) */
  toolCallId: string
  detail: string
  command: string
  /** 危险操作需二次确认 */
  dangerous?: boolean
  state: AiApproveState
}

export type AiDomainCard = AiReportCard | AiCronCard | AiPlistCard | AiApproveCard

export interface AiCardBlock {
  type: 'card'
  card: AiDomainCard
}

export interface AiSuggestBlock {
  type: 'suggest'
  items: string[]
}

export type AiContentBlock =
  | AiTextBlock
  | AiThinkingBlock
  | AiImageBlock
  | AiToolCallBlock
  | AiCardBlock
  | AiSuggestBlock

// ── 用量与终止原因 ──

export interface AiCost {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export interface AiUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning?: number
  totalTokens: number
  cost?: AiCost
}

/** 7 态,与 pi 的 StopReason 对齐(demo 只有"运行中/已完成"两态) */
export type AiStopReason = 'pending' | 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' | 'deferred'

// ── 消息 ──

/** @ 引用的本机对象(随用户消息一起送出,也决定工具上下文) */
export interface AiMention {
  key: string
  type: 'agent' | 'cron'
  id: string
  label: string
  /** agent 的作用域(cron 无);用于把引用解析成可读上下文 */
  scope?: AgentScope
}

export interface AiUserMessage {
  role: 'user'
  id: string
  blocks: AiContentBlock[]
  mentions?: AiMention[]
  timestamp: number
}

export interface AiAssistantMessage {
  role: 'assistant'
  id: string
  blocks: AiContentBlock[]
  usage?: AiUsage | null
  stopReason: AiStopReason
  errorMessage?: string
  /** 实际应答的模型 id */
  model?: string
  /** 服务商(展示用) */
  provider?: string
  timestamp: number
}

/** 工具执行状态:'run' 仅在流式中作为"已发起未返回"的瞬时态 */
export type AiToolStatus = 'run' | 'ok' | 'warn' | 'err'

export interface AiToolResultMessage {
  role: 'toolResult'
  id: string
  toolCallId: string
  toolName: string
  label?: string
  /** 结果也是块数组(可含图片) */
  blocks: AiContentBlock[]
  isError: boolean
  /** 显示态:ok 成功 / warn 被中断 / err 失败(run 见 AiToolStatus) */
  status: Exclude<AiToolStatus, 'run'>
  durationMs: number
  /** 该工具是否属写操作(需授权);写工具在步骤块里带标识 */
  write?: boolean
  timestamp: number
}

export type AiMessage = AiUserMessage | AiAssistantMessage | AiToolResultMessage

// ── 会话 ──

export interface AiSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

// ── 运行事件(main → renderer 流式推送) ──

export interface AiRunEventBase {
  sessionId: string
  runId: string
}

export type AiRunEvent =
  | (AiRunEventBase & { type: 'run_start' })
  /** 助手消息开始(一条 run 内可有多次:每轮一个) */
  | (AiRunEventBase & { type: 'message_start'; messageId: string })
  /** 块开始(text / thinking / card / suggest;toolCall 走 tool_start) */
  | (AiRunEventBase & { type: 'block_start'; messageId: string; index: number; block: AiContentBlock })
  | (AiRunEventBase & { type: 'text_delta'; messageId: string; index: number; delta: string })
  | (AiRunEventBase & { type: 'thinking_delta'; messageId: string; index: number; delta: string })
  | (AiRunEventBase & { type: 'block_end'; messageId: string; index: number; block: AiContentBlock })
  | (AiRunEventBase & { type: 'tool_start'; messageId: string; index: number; block: AiToolCallBlock })
  /** 工具执行中的增量输出(pi 的 tool_execution_update;demo 无此能力) */
  | (AiRunEventBase & { type: 'tool_update'; toolCallId: string; partial: string })
  | (AiRunEventBase & { type: 'tool_end'; result: AiToolResultMessage })
  | (AiRunEventBase & {
      type: 'message_end'
      messageId: string
      usage?: AiUsage | null
      stopReason: AiStopReason
      errorMessage?: string
      model?: string
      provider?: string
    })
  | (AiRunEventBase & { type: 'approval_request'; toolCallId: string; toolName: string; detail: string; command: string; dangerous: boolean })
  | (AiRunEventBase & { type: 'run_end'; stopReason: AiStopReason })
  | (AiRunEventBase & { type: 'run_error'; message: string })

// ── 授权应答(renderer → main) ──

export type AiApprovalDecision = 'approve' | 'cancel'

// ── 引擎状态(composer chip / 未配置引导 / 状态栏) ──

export interface AiEngineState {
  /** 当前接入协议 id(与 pi 的 KnownApi 对齐的已知枚举) */
  providerId: string
  providerName: string
  modelId: string
  /** 模型显示名(内置目录给友好名 claude-opus-5 → Claude Opus 5;目录外回退 id) */
  modelLabel: string
  /** 该协议是否已存有 API Key(Key 本体永不出 main) */
  hasKey: boolean
  /** 已配置 = 有 Key(切到没填 Key 的协议同样进未配置态) */
  configured: boolean
}

// ── 技能(内置任务模板) ──

export interface AiSkillInfo {
  id: string
  nameKey: string
  descKey: string
  tag: string
  icon: string
}
