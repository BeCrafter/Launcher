// AI 对话服务:会话/运行/授权/持久化(renderer 只发意图,事件经 emit 推回)
//
// 与 pi 的分工:
//  - 运行循环、工具调用、上下文裁剪都交给 pi-agent-core 的 Agent;
//  - **审批是宿主在 beforeToolCall 里拦下的**,不是消息内容里的一种卡 —— AgentEvent 里没有审批事件;
//  - 工具**调用**进 assistant 消息的 content(由 pi 的流事件给出),工具**结果**是独立的 toolResult 消息,
//    二者用 toolCallId 配对(不是数组下标)。
import { Agent, type AgentEvent, type AgentTool } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, AssistantMessageEvent, ToolCall } from '@earendil-works/pi-ai'
import type {
  AiApproveCard,
  AiApprovalDecision,
  AiAssistantMessage,
  AiAttachment,
  AiContentBlock,
  AiEngineState,
  AiMessage,
  AiRunEvent,
  AiSession,
  AiSkillInfo,
  AiToolResultMessage,
  AiUserMessage
} from '../../shared/ai'
import type {
  AiApprovalInput,
  AiApprovalResult,
  AiAutoApproveInput,
  AiAutoApproveResult,
  AiBranchInput,
  AiGetMessagesOpts,
  AiRetractInput,
  AiRetractResult,
  AiSendInput,
  AiTestResult
} from '../../shared/ipc'
import type { AiProviderId, LauncherSettings } from '../../shared/settings'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { expertPrompt } from './prompts/expert'
import { SKILLS, combineSkillTasks, findSkills, toolsForSkills, turnLimitForSkills } from './skills'
import type { LlmClient } from './llm'
import type { SecretStore } from './secret-store'
import type { NotesService } from '../services/notes-service'
import type { ToolDef, ToolExecResult, ToolRegistry } from './tool-types'
import { fromPiContent, fromPiToolResult, fromPiUsage, toPiMessages, IMAGE_NOT_STORED } from './message-map'
import { resolveNoteContexts, sanitizeMentions } from './note-context'
import {
  pruneSessionAttachments,
  pruneStoreAttachments,
  sanitizeIncomingAttachments,
  sanitizeStoredAttachments,
  sessionHasImages
} from './attachments'
import { lastUserImages, lastUserMessage, userMessageContext } from './user-context'
import { sanitizeUserSegments, skillIdsOf, uniqueSkillIds } from '../../shared/ai-inline'

/** 会话与消息的存储上限:对话是只增不减的产物,不设界迟早把 userData 撑爆 */
const MAX_SESSIONS = 100
const MAX_MESSAGES_PER_SESSION = 400
const TITLE_MAX = 24

interface StoredSession extends AiSession {
  messages: AiMessage[]
}

interface StoreFile {
  version: 1
  sessions: StoredSession[]
}

export interface ChatService {
  getEngineState(): AiEngineState
  /** 读回已存的明文 Key(仅供设置页显示) */
  revealKey(providerId: AiProviderId): string
  setKey(providerId: AiProviderId, apiKey: string): AiEngineState
  clearKey(providerId: AiProviderId): AiEngineState
  testConnection(providerId: AiProviderId): Promise<AiTestResult>
  listSessions(): AiSession[]
  createSession(): AiSession
  deleteSession(id: string): void
  /** light = 只取正文,剥离附件负载(会话搜索缓存用) */
  getMessages(sessionId: string, opts?: AiGetMessagesOpts): AiMessage[]
  send(input: AiSendInput): Promise<void>
  /** 撤回最后一条用户消息及其之后的全部回复;运行中会先中止并等运行收尾 */
  retract(input: AiRetractInput): Promise<AiRetractResult>
  /** 基于某条助手回复创建分支会话(复制该节点及之前的上下文) */
  branch(input: AiBranchInput): AiSession
  abort(): void
  respondApproval(input: AiApprovalInput): AiApprovalResult
  /** 开启/关闭某会话的普通写入自动允许(仅当前应用运行期) */
  setAutoApprove(input: AiAutoApproveInput): AiAutoApproveResult
  skills(): AiSkillInfo[]
  catalog(providerId: AiProviderId): { id: string; name: string }[]
  /** 运行中?renderer 重连时据此恢复「停止」按钮态 */
  isRunning(): boolean
}

interface RunState {
  runId: string
  sessionId: string
  agent: Agent
  abort: AbortController
  /** 整轮起点(含工具调用/授权等待,run_end 时算总耗时) */
  startedAt: number
  /** 本轮最后创建的助手消息;整轮耗时只落在这一条上 */
  lastAssistantId: string | null
  /** 计时是否已落定(成功/失败/finally 可能都会走到,幂等) */
  timingFinalized: boolean
  /** 正在流式的助手消息(每条 turn 一条) */
  live: AiAssistantMessage | null
  /** pi 的 contentIndex → 我们在 live.blocks 里的下标(宿主扩展块会让两者错位) */
  contentIndexMap: number[]
  /** toolCallId → 持有它的助手消息(审批卡要插回那条消息) */
  toolCallOwner: Map<string, string>
  /** 等待用户授权的那些 toolCall(toolCallId → 应答器 + 风险标记) */
  approvals: Map<
    string,
    { done: (d: AiApprovalDecision) => void; toolName: string; dangerous: boolean }
  >
  /** 已落库的 toolCallId(被 beforeToolCall 拦下的调用不会走 execute,需从 pi 事件补记) */
  finalized: Set<string>
  turnCount: number
  /** 本轮 load_plist 成功的 {label, scope} —— agent 自然停止时宿主据此注入自动验证轮 */
  verifyQueue: { label: string; scope?: string }[]
  /** 已注入的自动验证轮数(封顶 2,防止「修了又坏、坏了又修」无限续跑) */
  verifyRound: number
  /** prepare_agent 产出的就绪计划;对应 scope+label 必须先有成功 write 才能 load */
  preparedAgentKeys: Set<string>
  /** 本轮由 write_plist 成功落盘的计划身份 */
  writtenAgentKeys: Set<string>
  /** generate_plist 成功产出的 XML 草稿;写入时可安全补回模型遗漏的 xml 参数 */
  generatedAgentDrafts: Map<string, { scope: string; xml: string }>
}

export function createChatService(deps: {
  llm: LlmClient
  secrets: SecretStore
  registry: ToolRegistry
  /** 引用的笔记正文在这里现读(只在送模型时读,不落库) */
  notes: NotesService
  getSettings(): LauncherSettings
  /** 会话存储路径(生产:${userData}/ai-sessions.json) */
  storePath: string
  /** 把运行事件推给所有窗口 */
  emit(ev: AiRunEvent): void
}): ChatService {
  let store: StoreFile = loadStore(deps.storePath)
  let run: RunState | null = null
  /** 等待当前运行收尾的调用方(撤回要先 abort,再等 finally 把消息落定) */
  let runIdleWaiters: Array<() => void> = []
  /**
   * 仅当前应用运行期:这些会话的**普通**写操作不再逐条确认。
   * 刻意不落盘 —— 重启应用后回到逐条确认,避免一个旧会话在用户不知情时继续自动执行。
   * 危险操作(覆盖/删除/系统级等)永远不走这个豁免。
   */
  const autoApproveSessions = new Set<string>()
  let seq = 0

  const uid = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(++seq).toString(36)}`

  function waitForRunIdle(): Promise<void> {
    if (!run) return Promise.resolve()
    return new Promise<void>((resolve) => {
      runIdleWaiters.push(resolve)
    })
  }

  function notifyRunIdle(): void {
    const waiters = runIdleWaiters
    runIdleWaiters = []
    for (const resolve of waiters) resolve()
  }

  function abortRun(): void {
    if (!run) return
    // pi Agent 的模型流有自己的 AbortSignal;只 abort 宿主的 controller 不会中断
    // 正在流式生成的回答(它只覆盖工具执行),所以两处都要停。
    run.abort.abort()
    run.agent?.abort()
    for (const [, entry] of run.approvals) entry.done('cancel')
    run.approvals.clear()
  }

  // ── 持久化 ──

  function loadStore(path: string): StoreFile {
    if (!existsSync(path)) return { version: 1, sessions: [] }
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
      const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
      const list = Array.isArray(o.sessions) ? o.sessions : []
      const sessions = list
        .filter((s): s is StoredSession => isSessionLike(s))
        .map((s) => ({ ...s, messages: Array.isArray(s.messages) ? s.messages : [] }))
        .slice(0, MAX_SESSIONS)
      // 历史 JSON 可能来自旧版本/外部编辑:附件与分支元数据都要逐项收敛,
      // 坏数据绝不能进渲染层(渲染层会 map 附件,形态不对会直接崩)
      for (const s of sessions) {
        for (const m of s.messages) {
          if (m.role !== 'user') continue
          const attachments = sanitizeStoredAttachments(m.attachments)
          if (attachments.length > 0) m.attachments = attachments
          else delete m.attachments
          const mentions = sanitizeMentions(m.mentions)
          if (mentions.length > 0) m.mentions = mentions
          else delete m.mentions
          // 技能 id 只认当前仍存在的内置技能;历史版本删掉的技能就当没选过。
          // 新旧字段都读:旧数据只有 skillId,新数据是 skillIds(首个仍镜像进 skillId)。
          const skillIds = findSkills(skillIdsOf(m)).map((s) => s.id)
          if (skillIds.length > 0) {
            m.skillIds = skillIds
            m.skillId = skillIds[0]
          } else {
            delete m.skillIds
            delete m.skillId
          }
          const segments = sanitizeUserSegments(m.segments, attachments, mentions, skillIds)
          if (segments.length > 0) m.segments = segments
          else delete m.segments
        }
        const b = s.branch as unknown
        if (typeof b === 'object' && b !== null) {
          const o = b as Record<string, unknown>
          if (
            typeof o.sessionId === 'string' &&
            typeof o.messageId === 'string' &&
            typeof o.title === 'string'
          ) {
            s.branch = { sessionId: o.sessionId, messageId: o.messageId, title: o.title }
          } else {
            delete s.branch
          }
        } else {
          delete s.branch
        }
      }
      pruneStoreAttachments(sessions)
      return { version: 1, sessions }
    } catch {
      // 损坏回空:对话不是关键数据,不能因为它坏掉而让整个应用起不来
      return { version: 1, sessions: [] }
    }
  }

  function isSessionLike(v: unknown): v is StoredSession {
    if (typeof v !== 'object' || v === null) return false
    const o = v as Record<string, unknown>
    return typeof o.id === 'string' && typeof o.title === 'string'
  }

  function save(): void {
    // 会话数超限时丢最旧的(按 updatedAt);消息数超限时丢最旧的整轮 ->
    // 直接从头截断会切断「toolCall 与其结果」的配对,截断前先对齐到用户消息边界
    store.sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    if (store.sessions.length > MAX_SESSIONS) store.sessions = store.sessions.slice(0, MAX_SESSIONS)
    // 自动允许状态只跟活着的会话走:被裁剪/删除的会话不能留下悬挂的豁免
    const alive = new Set(store.sessions.map((s) => s.id))
    for (const id of autoApproveSessions) if (!alive.has(id)) autoApproveSessions.delete(id)
    for (const s of store.sessions) {
      if (s.messages.length > MAX_MESSAGES_PER_SESSION) {
        s.messages = s.messages.slice(s.messages.length - MAX_MESSAGES_PER_SESSION)
        const firstUser = s.messages.findIndex((m) => m.role === 'user')
        if (firstUser > 0) s.messages = s.messages.slice(firstUser)
      }
      // 截断可能把更早的消息带走;保留下来的旧附件也不能继续膨胀
      pruneSessionAttachments(s)
    }
    mkdirSync(dirname(deps.storePath), { recursive: true })
    // 原子写:流式期间 save() 会被频繁调用,写到一半崩溃/断电不能留下半截 JSON
    const tmp = `${deps.storePath}.tmp`
    writeFileSync(tmp, JSON.stringify(store), 'utf8')
    renameSync(tmp, deps.storePath)
  }

  const findSession = (id: string): StoredSession | undefined => store.sessions.find((s) => s.id === id)

  // ── 引擎状态 ──

  function engineState(): AiEngineState {
    const s = deps.getSettings()
    const hasKey = deps.secrets.has(s.aiProviderId)
    const meta = deps.llm.modelMeta(s.aiProviderId)
    return {
      providerId: s.aiProviderId,
      providerName: deps.llm.providerName(s.aiProviderId),
      modelId: meta.modelId,
      modelLabel: meta.modelLabel,
      hasKey,
      configured: hasKey,
      contextWindow: meta.contextWindow,
      maxTokens: meta.maxTokens
    }
  }

  // ── 工具桥接(宿主 ToolDef → pi AgentTool) ──
  //
  // 包装层而不是 pi 事件层来落结果,是因为只有这里拿得到结构化的 lines/card
  // (pi 的 tool_execution_end 只给 content 文本,领域卡会丢)。

  function buildAgentTools(r: RunState, defs: ToolDef[], sessionId: string): AgentTool[] {
    return defs.map((d) => ({
      name: d.name,
      label: d.label,
      description: d.description,
      parameters: d.parameters,
      execute: async (toolCallId, params, signal) => {
        const started = Date.now()
        const ctx = { sessionId, signal: signal ?? new AbortController().signal, allowCustomLogPath: true }
        let result: ToolExecResult
        try {
          result = await d.execute(params as Record<string, unknown>, ctx)
        } catch (err) {
          // 工具内的意外异常:转成可读结果,不要让它变成模型看不懂的栈
          result = {
            lines: [{ level: 'err', text: err instanceof Error ? err.message : String(err) }],
            isError: true
          }
        }
        finalizeToolResult(r, toolCallId, d, result, Date.now() - started)
        if (d.name === 'prepare_agent' && !result.isError) {
          const label = String((params as Record<string, unknown>)['label'] ?? '').trim()
          // blocked 计划不应解锁后续执行;准备卡的首行是宿主可控的 ok/warn 结果
          const ready = result.card?.kind === 'agentPreparation' && result.card.readiness === 'ready'
          const scopeRaw = (params as Record<string, unknown>)['scope']
          const scope = typeof scopeRaw === 'string' ? scopeRaw : 'user'
          if (label !== '' && ready) r.preparedAgentKeys.add(agentKey(label, scope))
        }
        if (d.name === 'generate_plist' && !result.isError && result.card?.kind === 'plist') {
          const label = String((params as Record<string, unknown>)['label'] ?? '').trim()
          const scopeRaw = (params as Record<string, unknown>)['scope']
          const scope = typeof scopeRaw === 'string' ? scopeRaw : 'user'
          if (label !== '') r.generatedAgentDrafts.set(agentKey(label, scope), { scope, xml: result.card.xml })
        }
        if (d.name === 'write_plist' && !result.isError) {
          const label = String((params as Record<string, unknown>)['label'] ?? '').trim()
          const scopeRaw = (params as Record<string, unknown>)['scope']
          const scope = typeof scopeRaw === 'string' ? scopeRaw : 'user'
          if (label !== '') r.writtenAgentKeys.add(agentKey(label, scope))
        }
        // load_plist 成功 → 记入自动验证队列(agent 自然停止时宿主注入验证轮)
        if (d.name === 'load_plist' && !result.isError) {
          const label = String((params as Record<string, unknown>)['label'] ?? '').trim()
          const scopeRaw = (params as Record<string, unknown>)['scope']
          const scope = typeof scopeRaw === 'string' ? scopeRaw : undefined
          if (label !== '' && !r.verifyQueue.some((t) => t.label === label && t.scope === scope)) {
            r.verifyQueue.push({ label, ...(scope ? { scope } : {}) })
          }
        }
        // 载入后又卸载(失败回滚 / 用户改主意):从验证队列移除,别在收尾时验证一个被故意停掉的任务
        if (d.name === 'unload_plist' && !result.isError) {
          const label = String((params as Record<string, unknown>)['label'] ?? '').trim()
          const scopeRaw = (params as Record<string, unknown>)['scope']
          const scope = typeof scopeRaw === 'string' ? scopeRaw : undefined
          if (label !== '') {
            r.verifyQueue = r.verifyQueue.filter(
              (t) => !(t.label === label && (scope === undefined || t.scope === undefined || t.scope === scope))
            )
          }
        }
        // 图片块直接进 pi 的 transcript(模型当轮看得到);落库那一路由 finalizeToolResult
        // 换成一行说明 —— 图片不进会话文件(理由见 message-map 的 IMAGE_NOT_STORED)
        return {
          content: [
            { type: 'text' as const, text: linesToText(result.lines) },
            ...(result.images ?? []).map((i) => ({
              type: 'image' as const,
              data: i.data,
              mimeType: i.mimeType
            }))
          ],
          details: { toolCallId }
        }
      }
    }))
  }

  /** 工具输出 → 模型可读文本(级别前缀只在非中性时加,省 token) */
  function linesToText(lines: ToolExecResult['lines']): string {
    return lines
      .map((l) => (l.level === '' || l.level === 'info' ? l.text : `[${l.level}] ${l.text}`))
      .join('\n')
  }

  /** 状态输出里是否已经有 pid / running:自动验证的短轮询用 */
  function statusLooksRunning(res: ToolExecResult): boolean {
    return res.lines.some((l) => /\bpid\s*[:=]?\s*\d+|\brunning\b/i.test(l.text))
  }

  // ── 运行事件应用 ──

  const emit = (ev: AiRunEvent): void => deps.emit(ev)

  function currentSession(): StoredSession | null {
    if (!run) return null
    return findSession(run.sessionId) ?? null
  }

  /** contentIndex → 宿主 blocks 下标;越界时回退到最后一块(容错,不抛) */
  function blockAt(r: RunState, contentIndex: number): AiContentBlock | null {
    if (!r.live) return null
    const idx = r.contentIndexMap[contentIndex]
    return idx == null ? null : (r.live.blocks[idx] ?? null)
  }

  function applyBlockEvent(r: RunState, ev: AssistantMessageEvent): void {
    const s = currentSession()
    if (!s || !r.live) return
    const send = (e: AiRunEvent): void => emit(e)
    switch (ev.type) {
      case 'text_start': {
        const index = r.live.blocks.length
        r.live.blocks.push({ type: 'text', text: '' })
        r.contentIndexMap[ev.contentIndex] = index
        send({ type: 'block_start', sessionId: r.sessionId, runId: r.runId, messageId: r.live.id, index, block: { type: 'text', text: '' } })
        break
      }
      case 'text_delta': {
        const b = blockAt(r, ev.contentIndex)
        if (b && b.type === 'text') {
          b.text += ev.delta
          send({ type: 'text_delta', sessionId: r.sessionId, runId: r.runId, messageId: r.live.id, index: r.contentIndexMap[ev.contentIndex]!, delta: ev.delta })
        }
        break
      }
      case 'text_end': {
        const b = blockAt(r, ev.contentIndex)
        if (b && b.type === 'text') {
          b.text = ev.content
          send({ type: 'block_end', sessionId: r.sessionId, runId: r.runId, messageId: r.live.id, index: r.contentIndexMap[ev.contentIndex]!, block: b })
        }
        break
      }
      case 'thinking_start': {
        const index = r.live.blocks.length
        r.live.blocks.push({ type: 'thinking', thinking: '' })
        r.contentIndexMap[ev.contentIndex] = index
        send({ type: 'block_start', sessionId: r.sessionId, runId: r.runId, messageId: r.live.id, index, block: { type: 'thinking', thinking: '' } })
        break
      }
      case 'thinking_delta': {
        const b = blockAt(r, ev.contentIndex)
        if (b && b.type === 'thinking') {
          b.thinking += ev.delta
          send({ type: 'thinking_delta', sessionId: r.sessionId, runId: r.runId, messageId: r.live.id, index: r.contentIndexMap[ev.contentIndex]!, delta: ev.delta })
        }
        break
      }
      case 'thinking_end': {
        const b = blockAt(r, ev.contentIndex)
        if (b && b.type === 'thinking') {
          b.thinking = ev.content
          // 签名必须留住:redacted 推理的密文载荷在这里,回放时缺了会破坏多轮连续性
          const src = ev.partial.content[ev.contentIndex]
          if (src && src.type === 'thinking') {
            if (src.thinkingSignature) b.thinkingSignature = src.thinkingSignature
            if (src.redacted) b.redacted = true
          }
          send({ type: 'block_end', sessionId: r.sessionId, runId: r.runId, messageId: r.live.id, index: r.contentIndexMap[ev.contentIndex]!, block: b })
        }
        break
      }
      case 'toolcall_end': {
        // 以 toolcall_end 的 toolCall 为准:toolcall_start 时的参数是半截 JSON,不能存
        const index = r.live.blocks.length
        const block: AiContentBlock = {
          type: 'toolCall',
          id: ev.toolCall.id,
          name: ev.toolCall.name,
          args: (ev.toolCall.arguments ?? {}) as Record<string, unknown>,
          ...(toolLabel(ev.toolCall) ? { label: toolLabel(ev.toolCall) } : {}),
          ...(ev.toolCall.thoughtSignature ? { thoughtSignature: ev.toolCall.thoughtSignature } : {})
        }
        r.live.blocks.push(block)
        r.contentIndexMap[ev.contentIndex] = index
        r.toolCallOwner.set(ev.toolCall.id, r.live.id)
        send({ type: 'tool_start', sessionId: r.sessionId, runId: r.runId, messageId: r.live.id, index, block })
        break
      }
      // start / toolcall_start / toolcall_delta / done / error 不产生宿主侧块
      default:
        break
    }
  }

  const toolLabel = (call: ToolCall): string | undefined => deps.registry.get(call.name)?.label

  function handleAgentEvent(ev: AgentEvent): void {
    const r = run
    if (!r) return
    switch (ev.type) {
      case 'message_start': {
        if (ev.message.role !== 'assistant') return
        const m = ev.message as AssistantMessage
        const msg: AiAssistantMessage = {
          role: 'assistant',
          id: uid('m'),
          blocks: [],
          stopReason: 'pending',
          model: m.model,
          provider: String(m.provider ?? ''),
          timestamp: m.timestamp ?? Date.now()
        }
        currentSession()?.messages.push(msg)
        r.live = msg
        r.lastAssistantId = msg.id
        r.contentIndexMap = []
        emit({ type: 'message_start', sessionId: r.sessionId, runId: r.runId, messageId: msg.id })
        break
      }
      case 'message_update': {
        if (ev.message.role !== 'assistant') return
        applyBlockEvent(r, ev.assistantMessageEvent)
        break
      }
      case 'message_end': {
        if (ev.message.role !== 'assistant' || !r.live) return
        const m = ev.message as AssistantMessage
        r.live.usage = fromPiUsage(m.usage)
        r.live.stopReason = m.stopReason
        if (m.errorMessage) r.live.errorMessage = m.errorMessage
        r.live.model = m.model || r.live.model
        r.live.provider = String(m.provider ?? r.live.provider ?? '')
        r.live.finishedAt = Date.now()
        emit({
          type: 'message_end',
          sessionId: r.sessionId,
          runId: r.runId,
          messageId: r.live.id,
          usage: r.live.usage,
          stopReason: r.live.stopReason,
          ...(r.live.errorMessage ? { errorMessage: r.live.errorMessage } : {}),
          model: r.live.model,
          provider: r.live.provider,
          finishedAt: r.live.finishedAt
        })
        r.live = null
        r.contentIndexMap = []
        save()
        break
      }
      case 'tool_execution_end': {
        // 工具正常执行时结果已由包装层落库(那里才拿得到结构化 lines/card);
        // 但**被 beforeToolCall 拦下的调用根本不会走 execute** —— pi 仍会发一对
        // tool_execution_start/end,这里必须把那条 error 结果补记,否则界面上那一步会永远转圈。
        if (r.finalized.has(ev.toolCallId)) break
        const text = extractText(ev.result)
        finalizeToolResult(
          r,
          ev.toolCallId,
          deps.registry.get(ev.toolName) ?? { name: ev.toolName, label: ev.toolName, write: false } as ToolDef,
          {
            lines: [{ level: cancelledReason(text) ? 'warn' : 'err', text }],
            isError: true
          },
          0
        )
        break
      }
      default:
        break
    }
  }

  /** 工具执行完成 → 落库 + 推送 */
  function finalizeToolResult(
    r: RunState,
    toolCallId: string,
    def: ToolDef,
    result: ToolExecResult,
    durationMs: number
  ): void {
    const s = currentSession()
    if (!s) return
    const msg: AiToolResultMessage = {
      role: 'toolResult',
      id: uid('tr'),
      toolCallId,
      toolName: def.name,
      label: def.label,
      blocks: [
        ...result.lines.map((l) => ({ type: 'text' as const, text: l.text })),
        ...(result.card ? [{ type: 'card' as const, card: result.card }] : []),
        // 图片只进当轮的模型上下文,不落库(见 IMAGE_NOT_STORED 的理由);
        // 这里补一行说明,界面与下一轮的历史都还知道「它看过一张图」
        ...(result.images?.length
          ? [{ type: 'text' as const, text: `${IMAGE_NOT_STORED}（${result.images.length} 张）` }]
          : [])
      ],
      isError: !!result.isError,
      // 用户取消不是故障:标 warn 而不是 err,与真正失败在视觉上区分开
      status: result.isError ? (isCancelled(result) ? 'warn' : 'err') : 'ok',
      durationMs,
      ...(def.write ? { write: true } : {}),
      ...(result.cardOnly ? { cardOnly: true } : {}),
      timestamp: Date.now()
    }
    if (msg.blocks.length === 0) msg.blocks = [{ type: 'text', text: '（无输出）' }]
    r.finalized.add(toolCallId)
    s.messages.push(msg)
    emit({ type: 'tool_end', sessionId: r.sessionId, runId: r.runId, result: msg })
    save()
  }

  // ── 审批 ──

  /** 在持有该工具调用的助手消息里追加/更新一张授权卡(按 toolCallId 认卡,同名工具并发也不会串) */
  function upsertApproveCard(r: RunState, s: StoredSession, card: AiApproveCard): void {
    const msgId = r.toolCallOwner.get(card.toolCallId)
    const msg = s.messages.find((m) => m.role === 'assistant' && m.id === msgId) as AiAssistantMessage | undefined
    if (!msg) return
    const idx = msg.blocks.findIndex(
      (b) => b.type === 'card' && b.card.kind === 'approve' && b.card.toolCallId === card.toolCallId
    )
    if (idx >= 0) {
      msg.blocks[idx] = { type: 'card', card }
      emit({ type: 'block_end', sessionId: r.sessionId, runId: r.runId, messageId: msg.id, index: idx, block: { type: 'card', card } })
    } else {
      const index = msg.blocks.length
      msg.blocks.push({ type: 'card', card })
      emit({ type: 'block_start', sessionId: r.sessionId, runId: r.runId, messageId: msg.id, index, block: { type: 'card', card } })
    }
  }

  function waitApproval(
    r: RunState,
    toolCallId: string,
    info: { toolName: string; dangerous: boolean },
    signal?: AbortSignal
  ): Promise<AiApprovalDecision> {
    return new Promise<AiApprovalDecision>((resolve) => {
      const done = (d: AiApprovalDecision): void => {
        r.approvals.delete(toolCallId)
        signal?.removeEventListener('abort', onAbort)
        resolve(d)
      }
      const onAbort = (): void => done('cancel')
      // 必须跟着 abort 走:否则用户中止运行后这里永远挂着,run 泄漏不结束
      if (signal?.aborted) return done('cancel')
      signal?.addEventListener('abort', onAbort, { once: true })
      r.approvals.set(toolCallId, { done, ...info })
    })
  }

  async function beforeToolCall(
    r: RunState,
    toolName: string,
    toolCallId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<{ block: true; reason: string } | undefined> {
    const def = deps.registry.get(toolName)
    if (!def?.write) return undefined
    const s = currentSession()
    const sum = def.summarize?.(args) ?? { detail: def.label, command: '' }
    const card: AiApproveCard = {
      kind: 'approve',
      tool: toolName,
      toolCallId,
      detail: sum.detail,
      command: sum.command,
      ...(sum.dangerous ? { dangerous: true } : {}),
      state: 'pending'
    }
    // 本会话已开启「普通写操作自动允许」:直接放行,不再打断对话。
    // 危险操作不在豁免范围内,继续走下面的逐条确认。
    if (s && !card.dangerous && autoApproveSessions.has(r.sessionId)) {
      upsertApproveCard(r, s, { ...card, state: 'approved', auto: true })
      save()
      return undefined
    }
    if (s) upsertApproveCard(r, s, card)
    emit({
      type: 'approval_request',
      sessionId: r.sessionId,
      runId: r.runId,
      toolCallId,
      toolName,
      detail: card.detail,
      command: card.command,
      dangerous: !!card.dangerous
    })
    const decision = await waitApproval(
      r,
      toolCallId,
      { toolName, dangerous: !!card.dangerous },
      signal
    )
    const settled: AiApproveCard = { ...card, state: decision === 'approve' ? 'approved' : 'cancelled' }
    if (s) upsertApproveCard(r, s, settled)
    save()
    if (decision !== 'approve') return { block: true, reason: '用户取消了本次操作' }
    return undefined
  }

  /**
   * 框架层自动验证兜底:模型收尾(本轮无工具调用)且本轮 load 过任务时,
   * 宿主查完状态与日志,把读数经 agent.followUp() 注入下一轮 ——
   * pi 的 Agent 会用自己的 followUpQueue.drain() 覆盖配置里的 getFollowUpMessages,
   * 唯一的注入入口是公开的 followUp();且 finishTurn 返回 end 会短路 follow-up 检查,
   * 所以刚注入过的这轮不能返回 end。注入轮同样计 turn,靠 verifyRound < 2 封顶。
   */
  async function maybeInjectVerify(r: RunState): Promise<boolean> {
    if (r.abort.signal.aborted) return false
    if (r.verifyRound >= 2 || r.verifyQueue.length === 0) return false
    const targets = [...r.verifyQueue]
    r.verifyQueue = []
    r.verifyRound += 1
    const ctx = { sessionId: r.sessionId, signal: r.abort.signal }
    const sections: string[] = []
    for (const target of targets) {
      const status = deps.registry.get('get_service_status')
      const logs = deps.registry.get('tail_log')
      const runStatus = (): Promise<ToolExecResult> =>
        status
          ? status.execute({ label: target.label, ...(target.scope ? { scope: target.scope } : {}) }, ctx)
          : Promise.resolve({ lines: [{ level: 'err' as const, text: 'get_service_status 工具不存在' }] })
      let statusRes = await runStatus()
      // 刚 bootstrap 的常驻服务可能还没产生 pid(冷启动/重启窗口);再等约 1.5s,
      // 避免宿主把「还在启动」误报成「没跑起来」。
      for (let i = 0; i < 2; i += 1) {
        if (r.abort.signal.aborted || statusLooksRunning(statusRes)) break
        await new Promise((resolve) => setTimeout(resolve, 700))
        statusRes = await runStatus()
      }
      const logRes = logs
        ? await logs.execute({ label: target.label, ...(target.scope ? { scope: target.scope } : {}), lines: 50 }, ctx)
        : { lines: [{ level: 'err' as const, text: 'tail_log 工具不存在' }] }
      sections.push(
        `### ${target.label}\n` +
          `【状态】\n${linesToText(statusRes.lines)}\n\n` +
          `【日志】\n${linesToText(logRes.lines)}`
      )
    }
    const text =
      `【自动验证】你刚载入了下面这些任务,宿主已代你查过状态与日志。请核对读数:\n\n` +
      `${sections.join('\n\n')}\n\n` +
      `判据(先看上面【状态】里的「触发」行):\n` +
      `- 常驻服务(KeepAlive):running=false、exit code 非 0 或日志有报错 → 诊断根因并修复(可再 write_plist / load_plist),修复后会再次自动验证(最多 2 轮);\n` +
      `- 一次性任务(有 RunAtLoad、无 KeepAlive/定时/监视):exit code 0 即成功,未在运行是正常终态,不要为此加 KeepAlive;\n` +
      `- 定时/监视任务(StartInterval / StartCalendarInterval / WatchPaths):两次触发之间未在运行正常,重点看 last exit code 与日志;\n` +
      `- 仅手动启动(无任何触发条件):载入后会立即运行一次,之后未运行是正常终态。\n` +
      `- 一切正常 → 给出最终交付说明,引用上面的真实读数(pid / exit code / 日志行),不要凭印象写。`
    const s = currentSession()
    if (!s) return false
    const msg: AiUserMessage = {
      role: 'user',
      id: uid('u'),
      blocks: [{ type: 'text', text }],
      internal: true,
      timestamp: Date.now()
    }
    s.messages.push(msg)
    save()
    emit({ type: 'user_message', sessionId: r.sessionId, runId: r.runId, messageId: msg.id, text })
    r.agent.followUp({ role: 'user', content: text, timestamp: msg.timestamp })
    return true
  }

  // ── 运行 ──

  const agentKey = (label: string, scope: string | undefined): string => `${scope ?? 'user'}:${label}`

  /** 跨消息回合查找成功的 prepare_agent 计划:用户先看计划、下一条才确认应用也必须受此顺序保护。 */
  function hasReadyPreparation(session: StoredSession, label: string, scope: string | undefined): boolean {
    return session.messages.some(
      (m) =>
        m.role === 'toolResult' &&
        m.toolName === 'prepare_agent' &&
        !m.isError &&
        m.blocks.some(
          (b) =>
            b.type === 'card' &&
            b.card.kind === 'agentPreparation' &&
            b.card.readiness === 'ready' &&
            b.card.label === label &&
            b.card.scope === (scope ?? 'user')
        )
    )
  }

  async function runAgent(r: RunState, skillIds: readonly string[] = []): Promise<void> {
    // 可能在 run 刚建立、agent 还没造出来时就被撤回/停止:直接收尾,别把请求发出去。
    if (r.abort.signal.aborted) return
    const settings = deps.getSettings()
    const skills = findSkills(skillIds)
    const allTools = deps.registry.all()
    const allowed = toolsForSkills(allTools, skills)
    const agentTools = buildAgentTools(r, allowed, r.sessionId).map((tool) => {
      if (tool.name === 'write_plist') {
        const execute = tool.execute
        return {
          ...tool,
          execute: async (toolCallId: string, params: unknown, signal?: AbortSignal) => {
            const raw = (params ?? {}) as Record<string, unknown>
            const label = String(raw['label'] ?? '').trim()
            const scopeRaw = raw['scope']
            const scope = typeof scopeRaw === 'string' ? scopeRaw : undefined
            const key = agentKey(label, scope)
            const draft = label === '' ? undefined : r.generatedAgentDrafts.get(key)
            const session = currentSession()
            const planned = label !== '' && session !== null && hasReadyPreparation(session, label, scope)
            // 模型经常把 XML 只展示在草稿卡、却漏传到 write_plist 参数；宿主已有本轮生成的
            // 完整草稿时安全补齐。scope 必须一致，避免把 user 草稿写进 daemon 目录。
            const xml = String(raw['xml'] ?? '').trim()
            if (planned && xml === '' && draft === undefined) {
              const result: ToolExecResult = {
                lines: [{ level: 'err', text: `${label} 有已确认的创建计划，但本回合还没有生成 XML；请先调用 generate_plist` }],
                isError: true
              }
              finalizeToolResult(r, toolCallId, deps.registry.get('write_plist')!, result, 0)
              return { content: [{ type: 'text' as const, text: linesToText(result.lines) }], details: { toolCallId } }
            }
            const normalized =
              xml === '' && draft !== undefined && (scope === undefined || scope === draft.scope)
                ? { ...raw, xml: draft.xml, ...(scope === undefined ? { scope: draft.scope } : {}) }
                : raw
            return execute(toolCallId, normalized, signal)
          }
        }
      }
      if (tool.name === 'load_plist') {
        const execute = tool.execute
        return {
          ...tool,
          execute: async (toolCallId: string, params: unknown, signal?: AbortSignal) => {
            const raw = (params ?? {}) as Record<string, unknown>
            const label = String(raw['label'] ?? '').trim()
            const scopeRaw = raw['scope']
            const scope = typeof scopeRaw === 'string' ? scopeRaw : undefined
            const key = agentKey(label, scope)
            // 新建流程必须先有就绪计划和成功写入。既有任务仍可直接 load/reload，
            // 不能因此挡住诊断/修复路径。
            const session = currentSession()
            const planned = label !== '' && ((session !== null && hasReadyPreparation(session, label, scope)) || r.preparedAgentKeys.has(key))
            if (planned && !r.writtenAgentKeys.has(key)) {
              const result: ToolExecResult = {
                lines: [
                  { level: 'err', text: `${label} 只有创建计划，尚未成功写入 plist；请先带完整 XML 调用 write_plist` }
                ],
                isError: true
              }
              finalizeToolResult(r, toolCallId, deps.registry.get('load_plist')!, result, 0)
              return { content: [{ type: 'text' as const, text: linesToText(result.lines) }], details: { toolCallId } }
            }
            return execute(toolCallId, params, signal)
          }
        }
      }
      return tool
    })

    const session = currentSession()
    if (!session) throw new Error('AI_SESSION_MISSING')
    // 图片能力要在看到会话之后判断:历史里可能还有旧图,模型能力声明漏了会让 pi 静默丢图
    const resolved = deps.llm.resolve(undefined, { images: sessionHasImages(session.messages) })
    if (!resolved.ok) throw new Error('AI_NOT_CONFIGURED')
    const last = lastUserMessage(session)
    if (!last) throw new Error('AI_SESSION_MISSING')
    // 最后一条用户消息已入库;送进 agent 的历史不含它(prompt() 会追加)
    const history = session.messages.slice(0, -1)
    // 引用的笔记正文在这里**一次性**读齐:历史与本轮共用同一份,
    // 分两处各解析一次的话,同一条消息在历史里和在本轮里会长得不一样
    const noteCtx = await resolveNoteContexts((id) => deps.notes.readBodyForAi(id), session.messages)
    if (r.abort.signal.aborted) return
    // 输出语言跟随应用语言(用户要求)
    const base = expertPrompt(settings.language)
    const systemPrompt = combineSkillTasks(base, skills)

    const agent = new Agent({
      initialState: {
        systemPrompt,
        model: resolved.value.model,
        tools: agentTools,
        messages: toPiMessages(history, noteCtx)
      },
      streamFn: deps.llm.streamFn(),
      toolExecution: 'sequential',
      beforeToolCall: async (ctx, signal) =>
        beforeToolCall(
          r,
          ctx.toolCall.name,
          ctx.toolCall.id,
          (ctx.args ?? {}) as Record<string, unknown>,
          signal
        ),
      // pi 没有内置轮数上限:超出设置的上限就结束本轮,把控制权交回用户。
      // 闭环类技能(生成→写入→载入→验证)需要更多轮:取各技能 turnLimit 与全局设置的最大值,
      // 只抬高下限,不压过用户更高的全局设置。
      //
      // 框架层自动验证兜底也挂在这里:模型收尾(本轮无工具调用)且本轮 load 过任务时,
      // 宿主查完状态与日志,把读数经 agent.followUp() 注入下一轮 ——
      // pi 的 Agent 会用自己的 followUpQueue.drain() 覆盖配置里的 getFollowUpMessages,
      // 唯一的注入入口是公开的 followUp();且 finishTurn 返回 end 会短路 follow-up 检查,
      // 所以刚注入过的这轮不能返回 end。注入轮同样计 turn,靠 verifyRound < 2 封顶。
      finishTurn: async (turn) => {
        r.turnCount += 1
        const limit = turnLimitForSkills(settings.aiToolCallLimit, skills)
        const injected = await maybeInjectVerify(r)
        if (r.turnCount >= limit && !injected) return { action: 'end' }
        return undefined
      }
    })
    r.agent = agent
    // abort 可能发生在 agent 赋值之前,那时 abortRun 只能停宿主 controller;
    // 补一次 agent.abort,模型流才不会继续跑完。
    if (r.abort.signal.aborted) agent.abort()

    const unsubscribe = agent.subscribe((ev) => handleAgentEvent(ev))
    try {
      // 当前轮:文本走与历史回放相同的 userMessageContext;图片单独交给 prompt
      await agent.prompt(userMessageContext(last, noteCtx), lastUserImages(last))
      await agent.waitForIdle()
    } finally {
      unsubscribe()
    }
  }

  /**
   * 整轮计时落定:只写在本轮最后一条助手消息上。
   * 成功/失败/finally 都可能调用;第二次调用从已落定的消息读回同一份结果。
   */
  function finalizeRunTiming(r: RunState): {
    messageId?: string
    durationMs?: number
    finishedAt?: number
  } {
    const id = r.lastAssistantId
    if (!id) return {}
    const msg = currentSession()?.messages.find((m) => m.id === id)
    if (!msg || msg.role !== 'assistant') return {}
    if (r.timingFinalized) {
      return {
        messageId: msg.id,
        ...(msg.durationMs !== undefined ? { durationMs: msg.durationMs } : {}),
        ...(msg.finishedAt !== undefined ? { finishedAt: msg.finishedAt } : {})
      }
    }
    r.timingFinalized = true
    const finishedAt = Date.now()
    msg.finishedAt = finishedAt
    msg.durationMs = Math.max(0, finishedAt - r.startedAt)
    return { messageId: msg.id, durationMs: msg.durationMs, finishedAt }
  }

  return {
    getEngineState: engineState,

    revealKey: (providerId) => deps.secrets.get(providerId) ?? '',

    setKey(providerId, apiKey) {
      deps.secrets.set(providerId, apiKey)
      return engineState()
    },

    clearKey(providerId) {
      deps.secrets.clear(providerId)
      return engineState()
    },

    testConnection: (providerId) => deps.llm.testConnection(providerId),

    listSessions: () =>
      [...store.sessions]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(({ id, title, createdAt, updatedAt, branch }) => ({
          id,
          title,
          createdAt,
          updatedAt,
          ...(branch ? { branch } : {}),
          autoApprove: autoApproveSessions.has(id)
        })),

    createSession() {
      const now = Date.now()
      const s: StoredSession = { id: uid('s'), title: '', createdAt: now, updatedAt: now, messages: [] }
      store.sessions.unshift(s)
      save()
      return {
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        autoApprove: false
      }
    },

    deleteSession(id) {
      if (run?.sessionId === id) abortRun()
      autoApproveSessions.delete(id)
      store.sessions = store.sessions.filter((s) => s.id !== id)
      save()
    },

    getMessages: (sessionId, opts) => {
      const messages = findSession(sessionId)?.messages ?? []
      if (!opts?.light) return messages
      // 搜索缓存只需要正文;base64 图片/文本附件不能整份留在 renderer 内存里
      return messages.map((m) => {
        if (m.role !== 'user' || !m.attachments?.length) return m
        return {
          ...m,
          attachments: m.attachments.map((a) =>
            a.type === 'image'
              ? { ...a, data: '', trimmed: true as const }
              : { ...a, content: '', bytes: 0, trimmed: true as const }
          )
        }
      })
    },

    skills: () =>
      SKILLS.map((s) => ({ id: s.id, nameKey: s.nameKey, descKey: s.descKey, tag: s.tag, icon: s.icon })),

    catalog: (providerId) => deps.llm.catalog(providerId),

    isRunning: () => run !== null,

    async send(input) {
      if (run) throw new Error('AI_BUSY')
      const session = findSession(input.sessionId)
      if (!session) throw new Error('AI_SESSION_MISSING')
      // 唯一的"能否开跑"判据:引擎层解析得出模型(缺 Key / 缺端点 / 缺模型名都在这里挡下)
      const resolved = deps.llm.resolve()
      if (!resolved.ok) throw new Error('AI_NOT_CONFIGURED')

      // 引用/附件跨 IPC 进来、还要落进会话文件:在这里收敛一次(条数 / 字段形态 / 长度)
      const mentions = sanitizeMentions(input.mentions)
      const attachments = sanitizeIncomingAttachments(input.attachments)
      // 新字段 skillIds 为主,旧字段 skillId 只做兼容;未知/重复的技能在这里收敛掉。
      const skillIds = findSkills(
        uniqueSkillIds([
          ...(Array.isArray(input.skillIds) ? input.skillIds : []),
          ...(typeof input.skillId === 'string' ? [input.skillId] : [])
        ])
      ).map((s) => s.id)
      // 只选了技能、还没写任务描述也可以发:技能提示词会先向用户确认目标。
      if (input.text.trim() === '' && attachments.length === 0 && skillIds.length === 0) {
        throw new Error('AI_EMPTY_MESSAGE')
      }
      // 内联排版只用于回显;main 只保留确实存在于本次引用/附件/技能里的 key。
      const segments = sanitizeUserSegments(input.segments, attachments, mentions, skillIds)
      const requestedId =
        typeof input.clientMessageId === 'string' ? input.clientMessageId.trim().slice(0, 120) : ''
      const user: AiUserMessage = {
        role: 'user',
        // 复用渲染层的乐观消息 id,撤回/重取时两边指向同一条消息。
        id:
          requestedId !== '' && !session.messages.some((m) => m.id === requestedId)
            ? requestedId
            : uid('u'),
        blocks: [{ type: 'text', text: input.text }],
        ...(mentions.length ? { mentions } : {}),
        ...(attachments.length ? { attachments } : {}),
        ...(segments.length ? { segments } : {}),
        ...(skillIds.length ? { skillIds, skillId: skillIds[0] } : {}),
        timestamp: Date.now()
      }
      const isFirst = session.messages.length === 0
      session.messages.push(user)
      if (isFirst) {
        session.title = compactTitle(titleSeed(input.text, attachments, skillIds.length ? '技能任务' : ''))
      }
      session.updatedAt = Date.now()
      // 新消息进来后,更早的附件负载先裁掉,别让它跟着本轮事件反复写盘
      pruneSessionAttachments(session)
      pruneStoreAttachments(store.sessions)
      save()

      const r: RunState = {
        runId: uid('run'),
        sessionId: session.id,
        agent: null as unknown as Agent,
        abort: new AbortController(),
        startedAt: Date.now(),
        lastAssistantId: null,
        timingFinalized: false,
        live: null,
        contentIndexMap: [],
        toolCallOwner: new Map(),
        approvals: new Map(),
        finalized: new Set(),
        turnCount: 0,
        verifyQueue: [],
        verifyRound: 0,
        preparedAgentKeys: new Set(),
        writtenAgentKeys: new Set(),
        generatedAgentDrafts: new Map()
      }
      run = r
      emit({ type: 'run_start', sessionId: r.sessionId, runId: r.runId })

      try {
        await runAgent(r, skillIds)
        const timing = finalizeRunTiming(r)
        emit({
          type: 'run_end',
          sessionId: r.sessionId,
          runId: r.runId,
          stopReason: r.abort.signal.aborted ? 'aborted' : 'stop',
          ...timing
        })
      } catch (err) {
        // 中止不算错误(用户主动停止),只有真失败才报
        const timing = finalizeRunTiming(r)
        if (r.abort.signal.aborted) {
          emit({
            type: 'run_end',
            sessionId: r.sessionId,
            runId: r.runId,
            stopReason: 'aborted',
            ...timing
          })
        } else {
          emit({
            type: 'run_error',
            sessionId: r.sessionId,
            runId: r.runId,
            message: err instanceof Error ? err.message : String(err),
            ...timing
          })
        }
      } finally {
        // 未决的授权要显式放行,否则 promise 永远挂着(包装层已随之返回 block)
        for (const [, entry] of r.approvals) entry.done('cancel')
        r.approvals.clear()
        // 收尾:把流式态落定,避免留下 stopReason=pending 的消息
        if (r.live) {
          r.live.stopReason = r.abort.signal.aborted ? 'aborted' : r.live.stopReason
          if (r.live.stopReason === 'pending') r.live.stopReason = 'stop'
          r.live = null
        }
        // 正常路径已在 try/catch 落定;这里兜底(例如 emit 抛错/极端中断)
        finalizeRunTiming(r)
        run = null
        try {
          pruneStoreAttachments(store.sessions)
          save()
        } finally {
          // 即使落盘失败也要放行撤回等待者,否则它会一直挂着。
          notifyRunIdle()
        }
      }
    },

    async retract(input) {
      const sessionId = String(input.sessionId ?? '')
      const messageId = String(input.messageId ?? '')
      const findTarget = (): { session: StoredSession; index: number; msg: AiUserMessage } => {
        const session = findSession(sessionId)
        if (!session) throw new Error('AI_SESSION_MISSING')
        const index = session.messages.findIndex(
          (m) => m.role === 'user' && m.id === messageId && !m.internal
        )
        const msg = index >= 0 ? session.messages[index] : undefined
        if (!msg || msg.role !== 'user') throw new Error('AI_RETRACT_NOT_FOUND')
        // 任意一条用户消息都可撤回:从该点起整段删除,相当于回到那一轮重新编辑。
        // 历史消息之后的轮次都建立在它之上,删除后模型不会再看到无源头的对话。
        return { session, index, msg }
      }

      // 先校验目标再中止:目标不存在时不应该误伤正在跑的那轮。
      let target = findTarget()
      if (run?.sessionId === sessionId) {
        abortRun()
        await waitForRunIdle()
        // 运行期间可能有事件落库/收尾;收尾后按最新存储重新定位。
        target = findTarget()
      }

      const { session, index, msg } = target
      const text = msg.blocks
        .filter((b): b is Extract<AiContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
      const mentions = msg.mentions
      // trimmed 的附件已经是空占位,带回输入框只会被当成"空附件"再发一次
      const attachments = (msg.attachments ?? []).filter((a) => !a.trimmed)
      // 被裁掉的附件不能留在内联排版里(否则草稿里会出现一颗找不到数据的 chip)
      const skillIds = findSkills(skillIdsOf(msg)).map((s) => s.id)
      const segments = sanitizeUserSegments(msg.segments, attachments, mentions ?? [], skillIds)
      // 从目标消息起整段删除:其后的 assistant / toolResult / 自动验证轮
      // 都是基于这条消息产生的,留着会让下一轮模型看到一段无源头的对话。
      session.messages.splice(index)
      if (!session.messages.some((m) => m.role === 'user' && !m.internal)) session.title = ''
      session.updatedAt = Date.now()
      save()
      return {
        text,
        ...(mentions && mentions.length > 0 ? { mentions } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(segments.length > 0 ? { segments } : {}),
        ...(skillIds.length > 0 ? { skillIds, skillId: skillIds[0] } : {})
      }
    },

    branch(input) {
      const sessionId = String(input.sessionId ?? '')
      const messageId = String(input.messageId ?? '')
      const source = findSession(sessionId)
      if (!source) throw new Error('AI_SESSION_MISSING')
      // 运行中的消息还在增长,复制出来的上下文可能缺块/半截;让用户等本轮收尾
      if (run?.sessionId === sessionId) throw new Error('AI_BRANCH_RUNNING')
      const index = source.messages.findIndex(
        (m) => m.role === 'assistant' && m.id === messageId
      )
      const target = index >= 0 ? source.messages[index] : undefined
      if (!target || target.role !== 'assistant') throw new Error('AI_BRANCH_NOT_FOUND')
      if (target.stopReason === 'pending') throw new Error('AI_BRANCH_PENDING')

      // 目标回复 + 紧随其后的 toolResult:少了结果会破坏 toolCall/toolResult 配对。
      // 再往后的 assistant/user 属于分叉点之后的对话,全部排除。
      let end = index + 1
      while (end < source.messages.length && source.messages[end].role === 'toolResult') end++
      // 保留原消息 id / toolCallId:它们只在会话内寻址,深拷贝到新会话不会冲突
      const messages = structuredClone(source.messages.slice(0, end))
      const now = Date.now()
      const branch = { sessionId: source.id, messageId: target.id, title: source.title }
      const s: StoredSession = {
        id: uid('s'),
        title: branchTitle(source.title),
        createdAt: now,
        updatedAt: now,
        messages,
        branch
      }
      store.sessions.unshift(s)
      pruneSessionAttachments(s)
      pruneStoreAttachments(store.sessions)
      save()
      return {
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        branch,
        autoApprove: false
      }
    },

    abort() {
      abortRun()
    },

    respondApproval(input) {
      const r = run
      if (!r || r.runId !== input.runId) return { autoApprove: false }
      const entry = r.approvals.get(input.toolCallId)
      if (!entry) return { autoApprove: autoApproveSessions.has(r.sessionId) }
      // 只有普通写操作才能把「本会话自动允许」打开;危险操作上的标志一律忽略,
      // 避免 renderer 误传或被绕过时把高风险操作也纳入豁免。
      if (input.decision === 'approve' && input.rememberSession === true && !entry.dangerous) {
        autoApproveSessions.add(r.sessionId)
      }
      entry.done(input.decision)
      return { autoApprove: autoApproveSessions.has(r.sessionId) }
    },

    setAutoApprove(input) {
      const sessionId = String(input.sessionId ?? '')
      if (!findSession(sessionId)) throw new Error('AI_SESSION_MISSING')
      if (input.enabled) autoApproveSessions.add(sessionId)
      else autoApproveSessions.delete(sessionId)
      return { autoApprove: autoApproveSessions.has(sessionId) }
    }
  }
}

/** pi 的工具结果 content 是 (Text|Image)[];这里只要文本 */
function extractText(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] } | undefined)?.content
  if (!Array.isArray(content)) return '（工具未返回内容）'
  const text = content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n')
  return text === '' ? '（工具未返回内容）' : text
}

/** 是否是我们自己因为用户取消而拦下的调用 */
const CANCELLED_REASON = '用户取消了本次操作'
function isCancelled(result: ToolExecResult): boolean {
  return result.lines.some((l) => l.text.includes(CANCELLED_REASON))
}
function cancelledReason(text: string): boolean {
  return text.includes(CANCELLED_REASON)
}

/** 会话标题:首行 + 截断(过长标题在 232px 会话栏里会被压成省略号,先截到可辨识长度) */
function compactTitle(text: string): string {
  const first = text.split('\n')[0]?.trim() ?? ''
  const t = first === '' ? '新对话' : first
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX)}…` : t
}

/** 首条消息的标题种子:优先文字,纯附件用文件名/类型兜底(与渲染层乐观标题保持一致) */
function titleSeed(text: string, attachments: AiAttachment[], fallback = '图片对话'): string {
  const first = text.split('\n')[0]?.trim() ?? ''
  if (first !== '') return first
  const textFile = attachments.find((a): a is Extract<AiAttachment, { type: 'text' }> => a.type === 'text')
  if (textFile) return textFile.name
  return fallback
}

/** 分支会话标题:来源标题截断后加后缀,总长仍受 TITLE_MAX 约束 */
function branchTitle(sourceTitle: string): string {
  const suffix = ' · 分支'
  const base = sourceTitle.trim() === '' ? '新对话' : sourceTitle.trim()
  const room = Math.max(1, TITLE_MAX - suffix.length)
  const cut = base.length > room ? `${base.slice(0, Math.max(1, room - 1))}…` : base
  return `${cut}${suffix}`
}
