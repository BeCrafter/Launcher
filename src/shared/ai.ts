// AI 助手契约(main ↔ preload ↔ renderer 单一事实来源)
//
// 消息模型落地为**内容块数组**而非固定槽位——
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

/** 创建 Agent 前的只读准备计划:展示给内置聊天,不执行任何写入/载入 */
export interface AiAgentPreparationCard {
  kind: 'agentPreparation'
  readiness: 'ready' | 'blocked'
  label: string
  scope: 'user' | 'system' | 'daemon'
  command: string
  trigger: string
  logs: string[]
  /** 端口状态未提供时省略 */
  port?: { value: number; state: 'free' | 'occupied'; detail: string }
  risks: string[]
  questions: string[]
  verification: string[]
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
  /** 由「本会话自动允许」放行(不是本次点击授权),卡片上据此标明 */
  auto?: boolean
  state: AiApproveState
}

export type AiDomainCard = AiReportCard | AiCronCard | AiPlistCard | AiAgentPreparationCard | AiApproveCard

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

/**
 * @ 引用的本机对象(随用户消息一起送出,也决定工具上下文)。
 *
 * 三类引用的**注入语义不一样**,别当成同一种:
 *   · agent / cron 是「指路」—— 只给模型一行标签,细节它自己去调工具;
 *   · note 是「给料」—— 正文由 main 在发送时**现读现拼**进这一轮的消息文本
 *     (见 main/ai/note-context.ts)。落库的仍只有 text + mentions,正文不进会话文件。
 */
export interface AiMention {
  key: string
  type: 'agent' | 'cron' | 'note'
  id: string
  label: string
  /** agent 的作用域(cron 无);用于把引用解析成可读上下文 */
  scope?: AgentScope
  /**
   * 引用的是**选中片段**而非整篇(仅 note)。
   * 有它就只注入这段文字,不再读整篇正文 —— 用户选了一段,就是想只说这一段。
   */
  quote?: string
  /**
   * 同一条用户消息内的添加顺序(与附件共用一套序号)。
   * 旧数据没有该字段时,按原数组/分组顺序处理。
   */
  order?: number
}

/**
 * 一条消息里最多几个引用。
 * 不是防呆:每个笔记引用都会把正文带进上下文,而正文**之后每一轮都会重发**。
 */
export const MAX_MENTIONS = 10

/** 用户随消息附加的图片(渲染层压缩后的 base64,不含 data: 前缀) */
export interface AiImageAttachment {
  type: 'image'
  key: string
  name: string
  mimeType: string
  data: string
  /** 会话保留策略裁剪后为 true,data 为空,仅保留占位 */
  trimmed?: boolean
  /** 同一条消息内与引用共用一套添加顺序 */
  order?: number
}

/** 用户随消息附加的文本文件(附加时的快照,后续文件变化不会同步) */
export interface AiTextAttachment {
  type: 'text'
  key: string
  name: string
  content: string
  /** 落库内容的 UTF-8 字节数 */
  bytes: number
  truncated?: boolean
  /** 会话保留策略裁剪后为 true,content 为空 */
  trimmed?: boolean
  /** 同一条消息内与引用共用一套添加顺序 */
  order?: number
}

export type AiAttachment = AiImageAttachment | AiTextAttachment

/**
 * 用户消息的「内联排版」:引用/附件/技能与文字按真实顺序交错。
 *
 * `text` 仍然是送模型的纯文本(引用本身另走 mentions/attachments/skillIds),
 * 这里只解决历史气泡如何还原「文字 + chip」的原始位置。旧消息没有该字段时,
 * 气泡按原有分组方式展示(附件/引用在前,正文在后)。
 */
export type AiUserSegment =
  | { type: 'text'; text: string }
  | { type: 'ref'; refType: 'attachment' | 'mention'; key: string }
  | { type: 'skill'; id: string }

/**
 * 附件上限。
 * 不是防呆:图片/文本会随消息落进会话 JSON,并在之后每一轮被重放;
 * 保留策略见 main/ai/attachments.ts(最近 3 条用户消息 + 全局硬上限)。
 */
export const MAX_ATTACHMENTS = 6
export const MAX_IMAGE_ATTACHMENTS = 4
export const MAX_TEXT_ATTACHMENTS = 4
/** 单张图片 base64(编码后)上限 */
export const MAX_IMAGE_BASE64_BYTES = 1.5 * 1024 * 1024
/** 单个文本文件落库上限 */
export const MAX_TEXT_ATTACHMENT_BYTES = 32 * 1024
/** 单条消息内文本附件合计上限 */
export const MAX_TEXT_ATTACHMENTS_TOTAL_BYTES = 64 * 1024
/** 保留完整附件负载的最近用户消息条数 */
export const KEEP_ATTACHMENT_TURNS = 3
/** 全部会话附件负载的全局上限 */
export const MAX_STORE_ATTACHMENT_BYTES = 32 * 1024 * 1024

export interface AiUserMessage {
  role: 'user'
  id: string
  blocks: AiContentBlock[]
  mentions?: AiMention[]
  /** 图片/文本文件快照;正文由 main 在发送时拼进模型上下文 */
  attachments?: AiAttachment[]
  /** 本次发送选中的内置技能(与 AiSendInput.skillIds 对应;顺序即视觉/选择顺序) */
  skillIds?: string[]
  /**
   * 旧的单技能字段。新消息仍写首个技能以兼容旧读取方;
   * 读取请用 skillIdsOf(),不要只读这一个字段。
   */
  skillId?: string
  /** 输入框里的内联排版(仅用于气泡还原;旧的纯文本消息没有该字段) */
  segments?: AiUserSegment[]
  /**
   * 宿主注入的内部消息(自动验证轮),不是用户实际发送的内容。
   * 这类消息不能作为「撤回并编辑」的目标,否则用户会把宿主的验证轮误当成自己发的。
   */
  internal?: boolean
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
  /** 本条回复完成时间(message_end 时写入) */
  finishedAt?: number
  /** 整轮耗时,仅该轮最后一条助手消息携带(含工具调用/授权等待) */
  durationMs?: number
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
  /** 内置聊天只展示领域卡，不在通用工具步骤中重复展示该调用 */
  cardOnly?: boolean
  timestamp: number
}

export type AiMessage = AiUserMessage | AiAssistantMessage | AiToolResultMessage

// ── 会话 ──

/** 会话分支来源(仅作溯源,不要求来源会话仍存在) */
export interface AiSessionBranch {
  /** 来源会话 id */
  sessionId: string
  /** 分叉点的助手消息 id */
  messageId: string
  /** 分叉时来源会话标题快照 */
  title: string
}

export interface AiSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /**
   * 当前应用运行期内的「普通写操作自动允许」状态。
   * 只由 main 在 listSessions 时算出来,**不落盘**;重启应用后恢复逐条确认。
   */
  autoApprove?: boolean
  /** 由某会话的某条助手回复分叉而来 */
  branch?: AiSessionBranch
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
      finishedAt?: number
    })
  | (AiRunEventBase & { type: 'approval_request'; toolCallId: string; toolName: string; detail: string; command: string; dangerous: boolean })
  /** 宿主注入的用户消息(如载入后的自动验证轮)—— main 已落库,renderer 只需补进列表 */
  | (AiRunEventBase & { type: 'user_message'; messageId: string; text: string })
  | (AiRunEventBase & {
      type: 'run_end'
      stopReason: AiStopReason
      /** 本轮最后一条助手消息;无助手消息时省略 */
      messageId?: string
      durationMs?: number
      finishedAt?: number
    })
  | (AiRunEventBase & {
      type: 'run_error'
      message: string
      messageId?: string
      durationMs?: number
      finishedAt?: number
    })

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
  /** 当前模型的上下文窗口(token);目录内取真实值,目录外按端点配置/估算兜底 */
  contextWindow: number
  /** 单次输出上限(token);用于区分「上下文将满」与「输出配额」两种限制 */
  maxTokens: number
}

// ── 技能(内置任务模板) ──

export interface AiSkillInfo {
  id: string
  nameKey: string
  descKey: string
  tag: string
  icon: string
}
