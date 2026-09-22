// AI 会话 store(demo ai.js chatState 的 React 版;数据经 dataSource().ai 仓储,main 是事实来源)
//
// 消息模型 = shared/ai.ts 的内容块数组(区别于 demo 的固定槽位):
//  - 运行事件(AiRunEvent)逐条应用到 messages;非当前会话的事件直接忽略 —— 切回时 getMessages 全量重取,
//    main 侧持久化即真相,渲染层不维护离线副本
//  - 工具调用(assistant 消息里的 toolCall 块)与结果(独立 toolResult 消息)按 toolCallId 配对,渲染层归组
import { create } from 'zustand'
import type {
  AiAssistantMessage,
  AiContentBlock,
  AiEngineState,
  AiMention,
  AiMessage,
  AiRunEvent,
  AiSession,
  AiSkillInfo,
  AiToolResultMessage,
  AiUserMessage
} from '@shared/ai'
import { dataSource } from '../data'
import { t, fmt } from '../i18n'
import { showToast, truncate } from '../lib/utils'
import type { AiMcpInfo } from '@shared/ipc'

interface AiState {
  sessions: AiSession[]
  currentId: string | null // null = 欢迎态(demo chatState.currentId)
  messages: AiMessage[] // 仅当前会话(main 持久化为真相)
  /** 会话正文缓存:会话栏搜索要扫消息文本;select/ensureMessages 时填充 */
  msgCache: Record<string, AiMessage[]>
  engine: AiEngineState | null
  skills: AiSkillInfo[]
  runId: string | null // 当前运行(仅一个;main AI_BUSY 兜底)
  runSessionId: string | null
  /** 等待用户应答的授权(toolCallId → runId);卡片状态由 block_end(approve card)驱动落定 */
  pendingApprovals: Record<string, { runId: string; toolName: string }>
  /** 工具执行中的增量输出(toolCallId → 累积文本;tool_end 后清除) */
  toolUpdates: Record<string, string>
  railSearch: string // 会话栏搜索词(选中会话不清,仅新对话清空 —— demo 语义)
  connectPulse: number // 未配置引导卡的脉冲计数(发送/技能卡被拦时 +1;卡片重挂载重启动画)
  mcpOpen: boolean
  mcpInfo: AiMcpInfo | null
  init(): void
  loadEngine(): Promise<void>
  loadSkills(): Promise<void>
  loadSessions(): Promise<void>
  select(id: string | null): Promise<void>
  setRailSearch(q: string): void
  /** 未配置时的统一拦截:toast + 引导卡脉冲;返回是否已配置 */
  guardConfigured(): boolean
  /** 搜索用:按需取会话正文进缓存 */
  ensureMessages(id: string): Promise<void>
  send(text: string, opts?: { skillId?: string; mentions?: AiMention[] }): Promise<void>
  stop(): Promise<void>
  respondApproval(toolCallId: string, decision: 'approve' | 'cancel'): Promise<void>
  openMcp(): Promise<void>
  closeMcp(): void
  /** 安装/修复 PATH 上的 launcher-mcp 链接(用户显式点击才调) */
  installMcpLink(): Promise<void>
  /** 运行事件应用(main → renderer 流式推送的唯一入口) */
  applyEvent(e: AiRunEvent): void
}

let eventInited = false

export const useAiStore = create<AiState>((set, get) => ({
  sessions: [],
  currentId: null,
  messages: [],
  msgCache: {},
  engine: null,
  skills: [],
  runId: null,
  runSessionId: null,
  pendingApprovals: {},
  toolUpdates: {},
  railSearch: '',
  connectPulse: 0,
  mcpOpen: false,
  mcpInfo: null,

  // 未配置拦截(demo aiSend 分支:toast + 引导卡脉冲;技能卡/体检卡同样走这里 —— demo 场景不需要
  // 引擎、真实运行需要,故收敛为同一闸门)
  guardConfigured() {
    if (get().engine?.configured) return true
    showToast(t('ai.connect.toast'), '#eec04d', 'fa-key')
    set((sw) => ({ connectPulse: sw.connectPulse + 1 }))
    return false
  },

  // 运行事件订阅(模块级幂等;StrictMode 双跑安全)。订阅常驻:离开 AI 页后运行仍继续,
  // 事件持续写入本 store,回到页面即见最新状态
  init() {
    if (eventInited) return
    eventInited = true
    dataSource().ai.onRunEvent((e) => get().applyEvent(e))
    void get().loadEngine()
    void get().loadSkills()
    void get().loadSessions()
  },

  async loadEngine() {
    try {
      const engine = await dataSource().ai.getState()
      set({ engine })
    } catch {
      /* 引擎状态取不到时按未配置呈现 */
    }
  },

  async loadSkills() {
    try {
      const skills = await dataSource().ai.skills()
      set({ skills })
    } catch {
      /* 技能取不到 → 欢迎态空网格,不阻断 */
    }
  },

  async loadSessions() {
    try {
      const sessions = await dataSource().ai.listSessions()
      set({ sessions })
    } catch {
      /* 会话列表取不到 → 空栏,不阻断 */
    }
  },

  // 切会话:null = 欢迎态。不中止 main 侧运行(demo 中止的是本地脚本播放;真实运行归 main 管)
  async select(id) {
    set({ currentId: id, messages: [], pendingApprovals: {}, toolUpdates: {} })
    if (!id) return
    try {
      const messages = await dataSource().ai.getMessages(id)
      set({ messages, msgCache: { ...get().msgCache, [id]: messages } })
    } catch {
      /* 取不到消息 → 空会话态 */
    }
  },

  setRailSearch(q) {
    set({ railSearch: q })
  },

  async ensureMessages(id) {
    if (get().msgCache[id]) return
    try {
      const messages = await dataSource().ai.getMessages(id)
      set({ msgCache: { ...get().msgCache, [id]: messages } })
    } catch {
      /* 单个会话正文取不到 → 该会话不参与正文搜索 */
    }
  },

  // 发送:无会话先建(demo aiStartLive 的 live 会话等价物);用户消息乐观上屏,
  // main 侧 send 成功后其持久化与流式事件同形 —— 失败时回滚乐观消息
  async send(text, opts) {
    const st = get()
    let sessionId = st.currentId
    if (!sessionId) {
      try {
        const s = await dataSource().ai.createSession()
        set({
          sessions: [s, ...get().sessions.filter((x) => x.id !== s.id)],
          currentId: s.id,
          messages: []
        })
        sessionId = s.id
      } catch {
        showToast(t('ai.connect.toast'), '#f87171', 'fa-circle-exclamation')
        return
      }
    }
    const sid = sessionId
    const userMsg: AiUserMessage = {
      role: 'user',
      id: `local-u-${Date.now()}`,
      blocks: [{ type: 'text', text }],
      ...(opts?.mentions?.length ? { mentions: opts.mentions } : {}),
      timestamp: Date.now()
    }
    set((sw) => ({
      messages: [...sw.messages, userMsg],
      msgCache: { ...sw.msgCache, [sid]: [...(sw.msgCache[sid] ?? []), userMsg] },
      // 首条消息定会话标题(本地先行;run 结束后 loadSessions 以 main 为准)
      sessions: sw.sessions.map((s) =>
        s.id === sid && s.title === ''
          ? { ...s, title: truncate(text.split('\n')[0]?.trim() || '新对话', 24), updatedAt: Date.now() }
          : s
      )
    }))
    try {
      await dataSource().ai.send({ sessionId: sid, text, mentions: opts?.mentions, skillId: opts?.skillId })
      // send 在整轮运行结束后 resolve:标题/时间戳可能已变
      void get().loadSessions()
    } catch (err) {
      // main 未入库(校验失败/已有运行),乐观消息回滚;已知错误码换成人话
      set((sw) => ({
        messages: sw.messages.filter((m) => m.id !== userMsg.id),
        msgCache: { ...sw.msgCache, [sid]: (sw.msgCache[sid] ?? []).filter((m) => m.id !== userMsg.id) }
      }))
      const raw = err instanceof Error ? err.message : String(err)
      const msg =
        raw === 'AI_NOT_CONFIGURED'
          ? t('ai.connect.toast')
          : fmt(t('ai.notice.error'), { M: raw === 'AI_BUSY' ? t('ai.input.stop') : raw })
      showToast(msg, '#f87171', 'fa-circle-exclamation')
    }
  },

  async stop() {
    await dataSource().ai.abort().catch(() => {})
  },

  async respondApproval(toolCallId, decision) {
    const entry = get().pendingApprovals[toolCallId]
    if (!entry) return
    set((sw) => {
      const pending = { ...sw.pendingApprovals }
      delete pending[toolCallId]
      return { pendingApprovals: pending }
    })
    await dataSource().ai.respondApproval({ runId: entry.runId, toolCallId, decision }).catch(() => {})
    // 卡片状态由 main 的 block_end(approve card)事件驱动落定
  },

  async openMcp() {
    set({ mcpOpen: true })
    if (!get().mcpInfo) {
      try {
        const info = await dataSource().ai.mcpInfo()
        set({ mcpInfo: info })
      } catch {
        /* 打不开就只显示权限行 */
      }
    }
  },

  closeMcp() {
    set({ mcpOpen: false })
  },

  async installMcpLink() {
    try {
      const { info, error } = await dataSource().ai.installMcpLink()
      set({ mcpInfo: info })
      if (error) {
        showToast(fmt(t('ai.mcp.link.failed'), { R: error }), '#f87171', 'fa-triangle-exclamation')
      } else if (info.link.foundAt) {
        showToast(fmt(t('ai.mcp.link.done'), { P: info.link.foundAt }), '#4ade80', 'fa-link')
      }
    } catch (err) {
      showToast(fmt(t('ai.mcp.link.failed'), { R: err instanceof Error ? err.message : String(err) }), '#f87171', 'fa-triangle-exclamation')
    }
  },

  // ── 运行事件应用 ──

  applyEvent(e: AiRunEvent) {
    if (e.sessionId !== get().currentId) return
    switch (e.type) {
      case 'run_start':
        set({ runId: e.runId, runSessionId: e.sessionId })
        break
      case 'message_start': {
        const exists = get().messages.some((m) => m.role === 'assistant' && m.id === e.messageId)
        if (exists) break
        const msg: AiAssistantMessage = {
          role: 'assistant',
          id: e.messageId,
          blocks: [],
          stopReason: 'pending',
          timestamp: Date.now()
        }
        set((sw) => ({ messages: [...sw.messages, msg] }))
        break
      }
      case 'block_start':
        set((sw) => ({ messages: sw.messages.map((m) => patchBlocks(m, e.messageId, (bs) => setAt(bs, e.index, e.block))) }))
        break
      case 'text_delta':
        set((sw) => ({
          messages: sw.messages.map((m) =>
            patchBlocks(m, e.messageId, (bs) => appendDelta(bs, e.index, 'text', e.delta))
          )
        }))
        break
      case 'thinking_delta':
        set((sw) => ({
          messages: sw.messages.map((m) =>
            patchBlocks(m, e.messageId, (bs) => appendDelta(bs, e.index, 'thinking', e.delta))
          )
        }))
        break
      case 'block_end':
        set((sw) => ({
          messages: sw.messages.map((m) => patchBlocks(m, e.messageId, (bs) => setAt(bs, e.index, e.block)))
        }))
        // 授权卡落定(状态不再 pending)→ 清对应的等待项
        if (e.block.type === 'card' && e.block.card.kind === 'approve' && e.block.card.state !== 'pending') {
          const tid = cardToolCallId(e.block.card)
          if (tid) {
            set((sw) => {
              if (!sw.pendingApprovals[tid]) return sw
              const pending = { ...sw.pendingApprovals }
              delete pending[tid]
              return { pendingApprovals: pending }
            })
          }
        }
        break
      case 'tool_start':
        set((sw) => ({ messages: sw.messages.map((m) => patchBlocks(m, e.messageId, (bs) => setAt(bs, e.index, e.block))) }))
        break
      case 'tool_update':
        set((sw) => ({ toolUpdates: { ...sw.toolUpdates, [e.toolCallId]: (sw.toolUpdates[e.toolCallId] ?? '') + e.partial } }))
        break
      case 'tool_end': {
        set((sw) => ({
          messages: [...sw.messages, e.result],
          toolUpdates: Object.fromEntries(Object.entries(sw.toolUpdates).filter(([k]) => k !== e.result.toolCallId))
        }))
        break
      }
      case 'message_end':
        set((sw) => ({
          messages: sw.messages.map((m) =>
            m.id === e.messageId && m.role === 'assistant'
              ? {
                  ...m,
                  stopReason: e.stopReason,
                  usage: e.usage ?? null,
                  model: e.model ?? m.model,
                  provider: e.provider ?? m.provider,
                  ...(e.errorMessage ? { errorMessage: e.errorMessage } : {})
                }
              : m
          )
        }))
        break
      case 'approval_request':
        set((sw) => ({
          pendingApprovals: { ...sw.pendingApprovals, [e.toolCallId]: { runId: e.runId, toolName: e.toolName } }
        }))
        break
      case 'run_end':
        if (e.runId === get().runId) set({ runId: null, runSessionId: null })
        break
      case 'run_error': {
        if (e.runId === get().runId) set({ runId: null, runSessionId: null })
        // 已知错误码换成人话(端点/Key 没配好是最常见情形)
        const msg = e.message === 'AI_NOT_CONFIGURED' ? t('ai.connect.toast') : e.message
        showToast(msg, '#f87171', 'fa-circle-exclamation')
        break
      }
    }
  }
}))

// ── 不可变块操作(下标越界一律容错,不抛) ──

/** shared/ai.ts 的 AiApproveCard 暂无 toolCallId 字段(main 侧已按需附带);读侧用可选访问对齐 */
function cardToolCallId(card: { toolCallId?: string }): string | undefined {
  return card.toolCallId
}

function isAssistant(m: AiMessage): m is AiAssistantMessage {
  return m.role === 'assistant'
}

function patchBlocks(
  m: AiMessage,
  messageId: string,
  fn: (blocks: AiContentBlock[]) => AiContentBlock[]
): AiMessage {
  if (!isAssistant(m) || m.id !== messageId) return m
  return { ...m, blocks: fn(m.blocks) }
}

function setAt(blocks: AiContentBlock[], index: number, block: AiContentBlock): AiContentBlock[] {
  // 事件下标与本地数组失配(中途重取过消息)时退化为追加:宁可位置不对也不丢块
  if (index >= 0 && index < blocks.length) {
    return blocks.map((b, i) => (i === index ? block : b))
  }
  return [...blocks, block]
}

function appendDelta(
  blocks: AiContentBlock[],
  index: number,
  type: 'text' | 'thinking',
  delta: string
): AiContentBlock[] {
  const b = blocks[index]
  if (!b) return blocks
  // 分支写死两种类型,避免对联合变量做类型收窄(TS 收不动 type !== b.type)
  if (type === 'text') {
    if (b.type !== 'text') return blocks
    return blocks.map((x, i) => (i === index ? { ...x, text: b.text + delta } : x))
  }
  if (b.type !== 'thinking') return blocks
  return blocks.map((x, i) => (i === index ? { ...x, thinking: b.thinking + delta } : x))
}

// ── 派生读取(视图/状态栏用) ──

/** 本会话工具调用次数(demo aiCountTools:步骤数合计) */
export function countToolCalls(messages: AiMessage[]): number {
  return messages.reduce((n, m) => (isAssistant(m) ? n + m.blocks.filter((b) => b.type === 'toolCall').length : n), 0)
}

/** toolCallId → toolResult(步骤块配对) */
export function findToolResult(messages: AiMessage[], toolCallId: string): AiToolResultMessage | undefined {
  return messages.find((m): m is AiToolResultMessage => m.role === 'toolResult' && m.toolCallId === toolCallId)
}

/** 运行是否针对当前会话(驱动发送/停止按钮态) */
export function isRunningHere(s: { runSessionId: string | null; currentId: string | null }): boolean {
  return s.runSessionId !== null && s.runSessionId === s.currentId
}

/** 会话时间标签:今天 → 「今天 HH:MM」,更早 → 「M-D HH:MM」(demo 预置会话的 ts 字段等价物) */
export function sessionTsLabel(updatedAt: number): string {
  const d = new Date(updatedAt)
  const p = (n: number): string => String(n).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return fmt(t('ai.rail.today'), { T: hm })
  return `${d.getMonth() + 1}-${d.getDate()} ${hm}`
}
