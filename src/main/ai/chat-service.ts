// AI 对话服务:会话/运行/授权/持久化(renderer 只发意图,事件经 emit 推回)
//
// 与 pi 的分工(见 docs/design/ai-message-model-gap.md §3):
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
  AiContentBlock,
  AiEngineState,
  AiMessage,
  AiRunEvent,
  AiSession,
  AiSkillInfo,
  AiToolResultMessage,
  AiUserMessage
} from '../../shared/ai'
import type { AiApprovalInput, AiSendInput, AiTestResult } from '../../shared/ipc'
import type { AiProviderId, LauncherSettings } from '../../shared/settings'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { EXPERT_PROMPT } from './prompts/expert'
import { SKILLS, findSkill } from './skills'
import type { LlmClient } from './llm'
import type { SecretStore } from './secret-store'
import type { ToolDef, ToolExecResult, ToolRegistry } from './tool-types'
import { fromPiContent, fromPiToolResult, fromPiUsage, toPiMessages } from './message-map'

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
  getMessages(sessionId: string): AiMessage[]
  send(input: AiSendInput): Promise<void>
  abort(): void
  respondApproval(input: AiApprovalInput): void
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
  /** 正在流式的助手消息(每条 turn 一条) */
  live: AiAssistantMessage | null
  /** pi 的 contentIndex → 我们在 live.blocks 里的下标(宿主扩展块会让两者错位) */
  contentIndexMap: number[]
  /** toolCallId → 持有它的助手消息(审批卡要插回那条消息) */
  toolCallOwner: Map<string, string>
  /** 等待用户授权的那些 toolCall */
  approvals: Map<string, (d: AiApprovalDecision) => void>
  /** 已落库的 toolCallId(被 beforeToolCall 拦下的调用不会走 execute,需从 pi 事件补记) */
  finalized: Set<string>
  turnCount: number
}

export function createChatService(deps: {
  llm: LlmClient
  secrets: SecretStore
  registry: ToolRegistry
  getSettings(): LauncherSettings
  /** 会话存储路径(生产:${userData}/ai-sessions.json) */
  storePath: string
  /** 把运行事件推给所有窗口 */
  emit(ev: AiRunEvent): void
}): ChatService {
  let store: StoreFile = loadStore(deps.storePath)
  let run: RunState | null = null
  let seq = 0

  const uid = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(++seq).toString(36)}`

  // ── 持久化 ──

  function loadStore(path: string): StoreFile {
    if (!existsSync(path)) return { version: 1, sessions: [] }
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
      const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
      const list = Array.isArray(o.sessions) ? o.sessions : []
      return {
        version: 1,
        sessions: list
          .filter((s): s is StoredSession => isSessionLike(s))
          .map((s) => ({ ...s, messages: Array.isArray(s.messages) ? s.messages : [] }))
          .slice(0, MAX_SESSIONS)
      }
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
    for (const s of store.sessions) {
      if (s.messages.length > MAX_MESSAGES_PER_SESSION) {
        s.messages = s.messages.slice(s.messages.length - MAX_MESSAGES_PER_SESSION)
        const firstUser = s.messages.findIndex((m) => m.role === 'user')
        if (firstUser > 0) s.messages = s.messages.slice(firstUser)
      }
    }
    mkdirSync(dirname(deps.storePath), { recursive: true })
    writeFileSync(deps.storePath, JSON.stringify(store), 'utf8')
  }

  const findSession = (id: string): StoredSession | undefined => store.sessions.find((s) => s.id === id)

  // ── 引擎状态 ──

  function engineState(): AiEngineState {
    const s = deps.getSettings()
    const hasKey = deps.secrets.has(s.aiProviderId)
    const resolved = deps.llm.resolve()
    // 模型 id 属于「当前协议」,不在全局
    const modelId = (s.aiProviders[s.aiProviderId]?.modelId ?? '').trim()
    return {
      providerId: s.aiProviderId,
      providerName: deps.llm.providerName(s.aiProviderId),
      modelId,
      // 未配置时 resolve 会失败,此时回退到 id 本身(界面只在已配置时展示模型名)
      modelLabel: resolved.ok ? resolved.value.modelLabel : modelId,
      hasKey,
      configured: hasKey
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
        const ctx = { sessionId, signal: signal ?? new AbortController().signal }
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
        return {
          content: [{ type: 'text' as const, text: linesToText(result.lines) }],
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
        emit({
          type: 'message_end',
          sessionId: r.sessionId,
          runId: r.runId,
          messageId: r.live.id,
          usage: r.live.usage,
          stopReason: r.live.stopReason,
          ...(r.live.errorMessage ? { errorMessage: r.live.errorMessage } : {}),
          model: r.live.model,
          provider: r.live.provider
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
        ...(result.card ? [{ type: 'card' as const, card: result.card }] : [])
      ],
      isError: !!result.isError,
      // 用户取消不是故障:标 warn 而不是 err,与真正失败在视觉上区分开
      status: result.isError ? (isCancelled(result) ? 'warn' : 'err') : 'ok',
      durationMs,
      ...(def.write ? { write: true } : {}),
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

  function waitApproval(r: RunState, toolCallId: string, signal?: AbortSignal): Promise<AiApprovalDecision> {
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
      r.approvals.set(toolCallId, done)
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
    const decision = await waitApproval(r, toolCallId, signal)
    const settled: AiApproveCard = { ...card, state: decision === 'approve' ? 'approved' : 'cancelled' }
    if (s) upsertApproveCard(r, s, settled)
    save()
    if (decision !== 'approve') return { block: true, reason: '用户取消了本次操作' }
    return undefined
  }

  // ── 运行 ──

  async function runAgent(r: RunState, skillId?: string): Promise<void> {
    const settings = deps.getSettings()
    const skill = findSkill(skillId)
    const allTools = deps.registry.all()
    const allowed = skill?.tools ? allTools.filter((t) => skill.tools!.includes(t.name)) : allTools
    const agentTools = buildAgentTools(r, allowed, r.sessionId)

    const resolved = deps.llm.resolve()
    if (!resolved.ok) throw new Error('AI_NOT_CONFIGURED')

    const session = currentSession()
    if (!session) throw new Error('AI_SESSION_MISSING')
    // 最后一条用户消息已入库;送进 agent 的历史不含它(prompt() 会追加)
    const history = session.messages.slice(0, -1)
    const systemPrompt = skill ? `${EXPERT_PROMPT}\n\n---\n\n${skill.task}` : EXPERT_PROMPT

    const agent = new Agent({
      initialState: {
        systemPrompt,
        model: resolved.value.model,
        tools: agentTools,
        messages: toPiMessages(history)
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
      // pi 没有内置轮数上限:超出设置的上限就结束本轮,把控制权交回用户
      finishTurn: () => {
        r.turnCount += 1
        return r.turnCount >= settings.aiToolCallLimit ? { action: 'end' } : undefined
      }
    })
    r.agent = agent

    const unsubscribe = agent.subscribe((ev) => handleAgentEvent(ev))
    try {
      await agent.prompt(lastUserText(session))
      await agent.waitForIdle()
    } finally {
      unsubscribe()
    }
  }

  /** 取最后一条用户消息的文本(含 @ 引用上下文行) */
  function lastUserText(session: StoredSession): string {
    const last = [...session.messages].reverse().find((m) => m.role === 'user') as AiUserMessage | undefined
    if (!last) return ''
    const text = last.blocks
      .filter((b): b is Extract<AiContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    if (!last.mentions?.length) return text
    const parts = last.mentions.map((m) =>
      m.type === 'agent' ? `${m.label}（LaunchAgent · ${m.scope ?? 'user'}）` : `${m.label}（定时任务）`
    )
    return `[用户引用了本机任务：${parts.join('、')}]\n${text}`
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
        .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt })),

    createSession() {
      const now = Date.now()
      const s: StoredSession = { id: uid('s'), title: '', createdAt: now, updatedAt: now, messages: [] }
      store.sessions.unshift(s)
      save()
      return { id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt }
    },

    deleteSession(id) {
      if (run?.sessionId === id) this.abort()
      store.sessions = store.sessions.filter((s) => s.id !== id)
      save()
    },

    getMessages: (sessionId) => findSession(sessionId)?.messages ?? [],

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

      const user: AiUserMessage = {
        role: 'user',
        id: uid('u'),
        blocks: [{ type: 'text', text: input.text }],
        ...(input.mentions?.length ? { mentions: input.mentions } : {}),
        timestamp: Date.now()
      }
      const isFirst = session.messages.length === 0
      session.messages.push(user)
      if (isFirst) session.title = compactTitle(input.text)
      session.updatedAt = Date.now()
      save()

      const r: RunState = {
        runId: uid('run'),
        sessionId: session.id,
        agent: null as unknown as Agent,
        abort: new AbortController(),
        live: null,
        contentIndexMap: [],
        toolCallOwner: new Map(),
        approvals: new Map(),
        finalized: new Set(),
        turnCount: 0
      }
      run = r
      emit({ type: 'run_start', sessionId: r.sessionId, runId: r.runId })

      try {
        await runAgent(r, input.skillId)
        emit({ type: 'run_end', sessionId: r.sessionId, runId: r.runId, stopReason: r.abort.signal.aborted ? 'aborted' : 'stop' })
      } catch (err) {
        // 中止不算错误(用户主动停止),只有真失败才报
        if (r.abort.signal.aborted) {
          emit({ type: 'run_end', sessionId: r.sessionId, runId: r.runId, stopReason: 'aborted' })
        } else {
          emit({
            type: 'run_error',
            sessionId: r.sessionId,
            runId: r.runId,
            message: err instanceof Error ? err.message : String(err)
          })
        }
      } finally {
        // 未决的授权要显式放行,否则 promise 永远挂着(包装层已随之返回 block)
        for (const [, done] of r.approvals) done('cancel')
        r.approvals.clear()
        // 收尾:把流式态落定,避免留下 stopReason=pending 的消息
        if (r.live) {
          r.live.stopReason = r.abort.signal.aborted ? 'aborted' : r.live.stopReason
          if (r.live.stopReason === 'pending') r.live.stopReason = 'stop'
          r.live = null
        }
        run = null
        save()
      }
    },

    abort() {
      if (!run) return
      run.abort.abort()
      for (const [, done] of run.approvals) done('cancel')
      run.approvals.clear()
    },

    respondApproval(input) {
      const r = run
      if (!r || r.runId !== input.runId) return
      const done = r.approvals.get(input.toolCallId)
      if (done) done(input.decision)
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
