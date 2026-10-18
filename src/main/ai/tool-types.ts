// ToolRegistry 契约:内置聊天与 MCP 服务共用的唯一工具来源(单一工具源)
//
// schema 用 **typebox**(pi 的 `Tool.parameters` 就是 typebox/JSON Schema 本身)——不另用 zod:
// MCP 侧走低层 Server 直接把同一份 JSON Schema 交给 tools/list,零转换、零重复定义。

import type { TSchema } from '@earendil-works/pi-ai'
import type { AiDomainCard, AiImageBlock } from '../../shared/ai'

/** 工具输出的一行(与 demo 的 [level, text] 行同形;渲染层复用 log-line 族) */
export interface ToolOutputLine {
  level: 'info' | 'ok' | 'warn' | 'err' | ''
  text: string
}

export interface ToolExecResult {
  /** 面向模型与用户的文本行 */
  lines: ToolOutputLine[]
  /**
   * 图片(可选;如「读取笔记里的截图」)。
   * **只在当轮进模型上下文,不落库** —— 会话文件是明文 JSON,一张 2 MB 截图
   * base64 后 2.7 MB,且之后每一轮都会重发。MCP 侧原样透传为 image 内容块。
   */
  images?: AiImageBlock[]
  /** 领域卡(可选;内置聊天渲染成卡片,MCP 侧只取 lines 的文本) */
  card?: AiDomainCard
  /** 内置聊天只展示领域卡，不在通用工具步骤中重复展示该调用 */
  cardOnly?: boolean
  /** 是否调用失败(pi 约定:抛异常 → isError=true;此处用于不需要抛的"软失败") */
  isError?: boolean
}

export interface ToolContext {
  sessionId: string
  signal: AbortSignal
  /**
   * 是否允许 tail_log 按任意路径读取日志文件。
   * 内置聊天为 true(用户能看见对话与路径);MCP 外部 Agent 为 false ——
   * 避免只读 MCP 变成任意文件读取器。
   */
  allowCustomLogPath?: boolean
}

export interface ToolDef {
  /** 工具 id(模型看到的 name) */
  name: string
  /** 人类可读名(pi 的 AgentTool.label;界面展示用,不再拿 id 当显示名) */
  label: string
  description: string
  parameters: TSchema
  /** 写操作:内置聊天执行前弹授权卡;MCP 侧仅在 mcpPermission=full 时暴露 */
  write: boolean
  /**
   * 写操作的授权卡文案(命令 + 说明)。写工具必填 —— 授权卡要展示"待执行什么",
   * 拿不到摘要就等于让用户盲签。
   */
  summarize?: (args: Record<string, unknown>) => { detail: string; command: string; dangerous?: boolean }
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolExecResult>
}

/** 只读工具与写工具分组(状态栏「只读工具 9 / 写工具 5」与 MCP 白名单都按它取) */
export interface ToolRegistry {
  all(): ToolDef[]
  get(name: string): ToolDef | undefined
  readOnly(): ToolDef[]
  writable(): ToolDef[]
}
