// AI 会话 store(demo ai.js chatState 的 React 版;数据经 dataSource().ai 仓储,main 是事实来源)
//
// 消息模型 = shared/ai.ts 的内容块数组(区别于 demo 的固定槽位):
//  - 运行事件(AiRunEvent)逐条应用到 messages;非当前会话的事件直接忽略 —— 切回时 getMessages 全量重取,
//    main 侧持久化即真相,渲染层不维护离线副本
//  - 工具调用(assistant 消息里的 toolCall 块)与结果(独立 toolResult 消息)按 toolCallId 配对,渲染层归组
import { create } from 'zustand'
import type {
  AiAssistantMessage,
  AiAttachment,
  AiContentBlock,
  AiEngineState,
  AiMention,
  AiMessage,
  AiRunEvent,
  AiSession,
  AiSkillInfo,
  AiToolResultMessage,
  AiUserMessage,
  AiUserSegment
} from '@shared/ai'
import { MAX_MENTIONS } from '@shared/ai'
import { skillIdsOf, uniqueSkillIds } from '@shared/ai-inline'
import { dataSource } from '../data'
import { t, fmt } from '../i18n'
import { showToast, truncate } from '../lib/utils'
import { selectableIds } from '../lib/ai-transcript'
import type { AiMcpInfo } from '@shared/ipc'

interface AiComposerDraft {
  sessionId: string
  text: string
  mentions: AiMention[]
  attachments: AiAttachment[]
  /** 输入框里的内联排版(不传时 composer 按旧版顺序还原) */
  segments?: AiUserSegment[]
  skillIds?: string[]
  nonce: number
}

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
  /** 等待用户应答的授权(toolCallId → runId/sessionId);卡片状态由 block_end(approve card)驱动落定 */
  pendingApprovals: Record<string, { runId: string; sessionId: string; toolName: string }>
  /** 工具执行中的增量输出(toolCallId → 累积文本;tool_end 后清除) */
  toolUpdates: Record<string, string>
  /** 撤回期间忽略该 run 的迟到事件(避免 tool_end 之类把刚删掉的消息又拼回来) */
  ignoredRunId: string | null
  /** 正在撤回的消息 id(按钮 spinner/防重复点击) */
  retractingId: string | null
  /** 正在创建分支的消息 id(按钮 spinner/防重复点击) */
  branchingId: string | null
  /** 消息多选模式;选中项是 user.id / assistant.id */
  selectionMode: boolean
  selectedIds: string[]
  /** 撤回/发送失败后待填回输入框的草稿;composer 消费后清空 */
  composerDraft: AiComposerDraft | null
  /**
   * 当前输入框是否有未发送内容(文字/chip/附件)。
   * 只用于升级自动重启前的保护:有草稿时暂停倒计时,别把用户正在写的内容带走。
   */
  composerHasDraft: boolean
  setComposerHasDraft: (has: boolean) => void
  railSearch: string // 会话栏搜索词(选中会话不清,仅新对话清空 —— demo 语义)
  connectPulse: number // 未配置引导卡的脉冲计数(发送/技能卡被拦时 +1;卡片重挂载重启动画)
  mcpOpen: boolean
  mcpInfo: AiMcpInfo | null
  /**
   * 别处(笔记页)附上的引用,等 composer 挂载时领走。
   *
   * 为什么走队列而不是直接把状态提到 store:composer 的输入框内容与引用是**会话级**的
   * 临时状态,提到 store 会让「新对话清空输入」这类规则散到两个地方。
   * 切模块会卸载 AI 视图(ViewHost 条件渲染),所以进 AI 页时 composer 一定是新挂载的。
   */
  pendingMentions: AiMention[]
  /** 把引用挂到下一次进入 AI 页的输入框上(同 key 去重,超出上限的丢掉并回报数量) */
  attachMentions(ms: AiMention[]): { added: number; dropped: number }
  /** 领走待挂引用(领完即清;composer 挂载时调一次) */
  takePendingMentions(): AiMention[]
  init(): void
  loadEngine(): Promise<void>
  loadSkills(): Promise<void>
  loadSessions(): Promise<void>
  select(id: string | null): Promise<void>
  /** 删除会话(含运行中的会话:main 侧会先 abort);删当前会话则回到欢迎态 */
  removeSession(id: string): Promise<void>
  setRailSearch(q: string): void
  /** 未配置时的统一拦截:toast + 引导卡脉冲;返回是否已配置 */
  guardConfigured(): boolean
  /** 搜索用:按需取会话正文进缓存 */
  ensureMessages(id: string): Promise<void>
  send(
    text: string,
    opts?: {
      /** 本次发送启用的技能(可多个,顺序即选择顺序) */
      skillIds?: string[]
      mentions?: AiMention[]
      attachments?: AiAttachment[]
      segments?: AiUserSegment[]
    }
  ): Promise<void>
  /** 撤回最后一条用户消息及其回复,并把原文/引用/附件交回输入框 */
  retract(messageId: string): Promise<void>
  /** 基于某条助手回复创建分支会话,并切换过去 */
  branchFrom(messageId: string): Promise<void>
  enterSelectionMode(): void
  exitSelectionMode(): void
  toggleSelected(id: string): void
  selectAllMessages(): void
  /** composer 消费撤回草稿后清掉(按 nonce 防止误清新草稿) */
  clearComposerDraft(nonce: number): void
  stop(): Promise<void>
  respondApproval(toolCallId: string, decision: 'approve' | 'cancel', rememberSession?: boolean): Promise<void>
  /** 开启/关闭某会话的普通写入自动允许(仅当前应用运行期) */
  setAutoApprove(sessionId: string, enabled: boolean): Promise<void>
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
  ignoredRunId: null,
  retractingId: null,
  branchingId: null,
  selectionMode: false,
  selectedIds: [],
  composerDraft: null,
  composerHasDraft: false,
  setComposerHasDraft: (has) => {
    if (get().composerHasDraft !== has) set({ composerHasDraft: has })
  },
  railSearch: '',
  connectPulse: 0,
  mcpOpen: false,
  mcpInfo: null,
  pendingMentions: [],

  attachMentions(ms) {
    const cur = get().pendingMentions
    const next = cur.slice()
    let added = 0
    let dropped = 0
    for (const m of ms) {
      if (next.some((x) => x.key === m.key)) continue
      if (next.length >= MAX_MENTIONS) {
        dropped++
        continue
      }
      next.push(m)
      added++
    }
    if (added > 0) set({ pendingMentions: next })
    return { added, dropped }
  },

  takePendingMentions() {
    const cur = get().pendingMentions
    if (cur.length > 0) set({ pendingMentions: [] })
    return cur
  },

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
    set({
      currentId: id,
      messages: [],
      pendingApprovals: {},
      toolUpdates: {},
      selectionMode: false,
      selectedIds: []
    })
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

  // 删除会话:main 是事实来源,删除成功后才动本地状态(失败时列表保持原样并提示)。
  // 删当前会话 → 回欢迎态;删运行中的会话 → 同步清掉 run 状态(main 侧会 abort)
  async removeSession(id) {
    try {
      await dataSource().ai.deleteSession(id)
    } catch {
      showToast(t('ai.rail.deleteFailed'), '#f87171', 'fa-circle-exclamation')
      return
    }
    const st = get()
    const msgCache = { ...st.msgCache }
    delete msgCache[id]
    set({
      sessions: st.sessions.filter((s) => s.id !== id),
      msgCache,
      ...(st.currentId === id
        ? {
            currentId: null,
            messages: [],
            pendingApprovals: {},
            toolUpdates: {},
            selectionMode: false,
            selectedIds: []
          }
        : {}),
      ...(st.runSessionId === id ? { runId: null, runSessionId: null } : {})
    })
  },

  async ensureMessages(id) {
    if (get().msgCache[id]) return
    try {
      // 搜索只需要正文:轻量模式剥离附件 base64/文本,避免搜索一次把所有会话图片读进内存
      const messages = await dataSource().ai.getMessages(id, { light: true })
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
    const attachments = opts?.attachments ?? []
    const skillIds = uniqueSkillIds(opts?.skillIds ?? [])
    const userMsg: AiUserMessage = {
      role: 'user',
      id: `local-u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      blocks: [{ type: 'text', text }],
      ...(opts?.mentions?.length ? { mentions: opts.mentions } : {}),
      ...(attachments.length ? { attachments } : {}),
      ...(opts?.segments?.length ? { segments: opts.segments } : {}),
      ...(skillIds.length ? { skillIds, skillId: skillIds[0] } : {}),
      timestamp: Date.now()
    }
    // 本地标题与 main 的 titleSeed 保持一致:文字 > 文本文件名 > 图片对话
    const firstLine = text.split('\n')[0]?.trim() ?? ''
    const textFileName = attachments.find((a) => a.type === 'text')?.name ?? ''
    const localTitle =
      firstLine ||
      textFileName ||
      (attachments.length > 0 ? t('ai.attach.imageTitle') : skillIds.length ? t('ai.skill.taskTitle') : '')
    set((sw) => ({
      messages: [...sw.messages, userMsg],
      msgCache: { ...sw.msgCache, [sid]: [...(sw.msgCache[sid] ?? []), userMsg] },
      selectionMode: false,
      selectedIds: [],
      // 首条消息定会话标题(本地先行;run 结束后 loadSessions 以 main 为准)
      sessions: sw.sessions.map((s) =>
        s.id === sid && s.title === ''
          ? { ...s, title: truncate(localTitle || '新对话', 24), updatedAt: Date.now() }
          : s
      )
    }))
    try {
      await dataSource().ai.send({
        sessionId: sid,
        text,
        mentions: opts?.mentions,
        attachments,
        segments: opts?.segments,
        skillIds,
        clientMessageId: userMsg.id
      })
      // send 在整轮运行结束后 resolve:标题/时间戳可能已变
      void get().loadSessions()
    } catch (err) {
      // main 未入库(校验失败/已有运行),乐观消息回滚;输入框内容还回草稿
      set((sw) => ({
        messages: sw.messages.filter((m) => m.id !== userMsg.id),
        msgCache: { ...sw.msgCache, [sid]: (sw.msgCache[sid] ?? []).filter((m) => m.id !== userMsg.id) },
        composerDraft: {
          sessionId: sid,
          text,
          mentions: opts?.mentions ?? [],
          attachments,
          ...(opts?.segments?.length ? { segments: opts.segments } : {}),
          ...(skillIds.length ? { skillIds } : {}),
          nonce: Date.now()
        }
      }))
      const raw = err instanceof Error ? err.message : String(err)
      const msg =
        raw === 'AI_NOT_CONFIGURED'
          ? t('ai.connect.toast')
          : raw === 'AI_EMPTY_MESSAGE'
            ? t('ai.input.empty')
            : raw === 'AI_ATTACHMENT_INVALID'
              ? t('ai.attach.invalid')
              : fmt(t('ai.notice.error'), { M: raw === 'AI_BUSY' ? t('ai.input.stop') : raw })
      showToast(msg, '#f87171', 'fa-circle-exclamation')
    }
  },

  async retract(messageId) {
    const st = get()
    const sessionId = st.currentId
    if (!sessionId || st.retractingId) return
    // 运行中的会话:提前记下 runId,撤回期间丢弃它的迟到事件。
    const activeRunId = st.runSessionId === sessionId ? st.runId : null
    set({ retractingId: messageId, ...(activeRunId ? { ignoredRunId: activeRunId } : {}) })
    try {
      const r = await dataSource().ai.retract({ sessionId, messageId })
      // main 是事实来源:撤回后重取,而不是在本地猜哪些消息被删了。
      // 但重取失败不能把「撤回已成功」误报成失败:退回本地缓存,按同一语义
      // 删掉目标消息及其之后的内容,草稿仍然照常还原。
      let messages: AiMessage[]
      try {
        messages = await dataSource().ai.getMessages(sessionId)
      } catch (err) {
        console.error('[ai] retract refresh failed', err)
        const cached = st.msgCache[sessionId] ?? (st.currentId === sessionId ? st.messages : [])
        const index = cached.findIndex((m) => m.id === messageId)
        messages = index >= 0 ? cached.slice(0, index) : cached
      }
      const skillIds = skillIdsOf(r)
      const draft = {
        sessionId,
        text: r.text,
        mentions: r.mentions ?? [],
        attachments: r.attachments ?? [],
        ...(r.segments?.length ? { segments: r.segments } : {}),
        ...(skillIds.length ? { skillIds } : {}),
        nonce: Date.now()
      }
      if (get().currentId === sessionId) {
        set((sw) => ({
          messages,
          msgCache: { ...sw.msgCache, [sessionId]: messages },
          composerDraft: draft,
          // main 侧已 abort 并等运行收尾;这里同步清掉本会话运行态。
          ...(sw.runSessionId === sessionId ? { runId: null, runSessionId: null } : {}),
          pendingApprovals: {},
          toolUpdates: {}
        }))
      } else {
        // 用户切走了也保留草稿;回到这个会话时 composer 会把原文填回去。
        set((sw) => ({ msgCache: { ...sw.msgCache, [sessionId]: messages }, composerDraft: draft }))
      }
      showToast(t('ai.retract.done'), '#4ade80', 'fa-rotate-left')
      void get().loadSessions()
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      // 校验类失败发生在 abort 之前,run 还在跑:恢复事件流,别把后续输出吞掉。
      if (raw === 'AI_RETRACT_NOT_FOUND' || raw === 'AI_SESSION_MISSING') {
        set({ ignoredRunId: null })
      }
      showToast(t('ai.retract.failed'), '#f87171', 'fa-rotate-left')
    } finally {
      set({ retractingId: null })
    }
  },

  async branchFrom(messageId) {
    const st = get()
    const sessionId = st.currentId
    if (!sessionId || st.branchingId) return
    if (st.runSessionId === sessionId) {
      showToast(t('ai.branch.running'), '#eec04d', 'fa-code-branch')
      return
    }
    set({ branchingId: messageId })
    try {
      const session = await dataSource().ai.branch({ sessionId, messageId })
      set((sw) => ({
        sessions: [session, ...sw.sessions.filter((s) => s.id !== session.id)],
        branchingId: null
      }))
      await get().select(session.id)
      showToast(t('ai.branch.created'), '#4ade80', 'fa-code-branch')
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      const msg =
        raw === 'AI_BRANCH_RUNNING'
          ? t('ai.branch.running')
          : raw === 'AI_BRANCH_PENDING'
            ? t('ai.branch.pending')
            : raw === 'AI_BRANCH_NOT_FOUND' || raw === 'AI_SESSION_MISSING'
              ? t('ai.branch.notFound')
              : t('ai.branch.failed')
      showToast(msg, '#f87171', 'fa-code-branch')
    } finally {
      set({ branchingId: null })
    }
  },

  enterSelectionMode() {
    if (get().messages.length === 0) return
    set({ selectionMode: true, selectedIds: [] })
  },

  exitSelectionMode() {
    set({ selectionMode: false, selectedIds: [] })
  },

  toggleSelected(id) {
    set((sw) => ({
      selectedIds: sw.selectedIds.includes(id)
        ? sw.selectedIds.filter((x) => x !== id)
        : [...sw.selectedIds, id]
    }))
  },

  selectAllMessages() {
    set({ selectedIds: selectableIds(get().messages) })
  },

  clearComposerDraft(nonce) {
    if (get().composerDraft?.nonce === nonce) set({ composerDraft: null })
  },

  async stop() {
    await dataSource().ai.abort().catch(() => {})
  },

  async respondApproval(toolCallId, decision, rememberSession = false) {
    const entry = get().pendingApprovals[toolCallId]
    if (!entry) return
    set((sw) => {
      const pending = { ...sw.pendingApprovals }
      delete pending[toolCallId]
      return { pendingApprovals: pending }
    })
    const result = await dataSource()
      .ai.respondApproval({
        runId: entry.runId,
        toolCallId,
        decision,
        ...(rememberSession ? { rememberSession: true } : {})
      })
      .catch(() => null)
    // main 可能因为「危险操作不纳入豁免」而拒绝 remember;以它返回的真实状态为准。
    if (result?.autoApprove) {
      set((sw) => ({
        sessions: sw.sessions.map((s) => (s.id === entry.sessionId ? { ...s, autoApprove: true } : s))
      }))
    }
    // 卡片状态由 main 的 block_end(approve card)事件驱动落定
  },

  async setAutoApprove(sessionId, enabled) {
    try {
      const result = await dataSource().ai.setAutoApprove({ sessionId, enabled })
      set((sw) => ({
        sessions: sw.sessions.map((s) =>
          s.id === sessionId ? { ...s, autoApprove: result.autoApprove } : s
        )
      }))
    } catch {
      showToast(t('ai.appr.sessionFailed'), '#f87171', 'fa-shield-halved')
    }
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
    // 同一会话的新 run 一开始就恢复正常接收;被撤回的旧 run 的迟到事件到此为止。
    // 别的会话开跑不清:旧 run 的迟到事件仍属于当前会话时,必须继续丢。
    if (e.type === 'run_start' && e.sessionId === get().currentId) set({ ignoredRunId: null })
    // run_end / run_error 仍要放行:它们负责把运行态收回,且不会往消息列表里加内容。
    if (
      get().ignoredRunId === e.runId &&
      e.type !== 'run_end' &&
      e.type !== 'run_error'
    ) {
      return
    }
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
                  ...(e.finishedAt !== undefined ? { finishedAt: e.finishedAt } : {}),
                  ...(e.errorMessage ? { errorMessage: e.errorMessage } : {})
                }
              : m
          )
        }))
        break
      case 'approval_request':
        set((sw) => ({
          pendingApprovals: {
            ...sw.pendingApprovals,
            [e.toolCallId]: { runId: e.runId, sessionId: e.sessionId, toolName: e.toolName }
          }
        }))
        break
      case 'user_message': {
        // 宿主注入的用户消息(自动验证轮):main 已落库,这里补进当前列表;重复事件按 id 去重
        const exists = get().messages.some((m) => m.role === 'user' && m.id === e.messageId)
        if (exists) break
        const msg: AiUserMessage = {
          role: 'user',
          id: e.messageId,
          blocks: [{ type: 'text', text: e.text }],
          // user_message 事件目前只由宿主自动验证轮注入;不是用户实际发送的消息。
          internal: true,
          timestamp: Date.now()
        }
        set((sw) => ({ messages: [...sw.messages, msg] }))
        break
      }
      case 'run_end':
        set((sw) => ({
          messages: patchTiming(sw.messages, e.messageId, e.durationMs, e.finishedAt),
          ...(e.runId === sw.runId ? { runId: null, runSessionId: null } : {})
        }))
        break
      case 'run_error': {
        set((sw) => ({
          messages: patchTiming(sw.messages, e.messageId, e.durationMs, e.finishedAt),
          ...(e.runId === sw.runId ? { runId: null, runSessionId: null } : {})
        }))
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

/** run_end / run_error 带回整轮耗时:补到最后一条助手消息 */
function patchTiming(
  messages: AiMessage[],
  messageId: string | undefined,
  durationMs: number | undefined,
  finishedAt: number | undefined
): AiMessage[] {
  if (!messageId) return messages
  return messages.map((m) =>
    m.role === 'assistant' && m.id === messageId
      ? {
          ...m,
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(finishedAt !== undefined ? { finishedAt } : {})
        }
      : m
  )
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
