// 对话服务的集成测试:用 pi 自带的 faux provider 驱动**真实**的 Agent 循环
// (不 mock 运行器 —— 事件序列、工具执行、审批拦截、transcript 配对都是真跑的)
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  Type,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  getCurrentSystemMessage,
  type TranscriptContext
} from '@earendil-works/pi-ai'
import type { StreamFn } from '@earendil-works/pi-agent-core'
import { DEFAULT_SETTINGS, type LauncherSettings } from '../../shared/settings'
import type { AiRunEvent } from '../../shared/ai'
import { createChatService, type ChatService } from './chat-service'
import type { LlmClient } from './llm'
import type { NotesService } from '../services/notes-service'
import type { SecretStore } from './secret-store'
import type { ToolDef, ToolRegistry } from './tool-types'

let dir: string
const events: AiRunEvent[] = []

function stubSecrets(keys: string[] = ['anthropic']): SecretStore {
  const m = new Map(keys.map((k) => [k, 'sk-test']))
  return {
    get: (id) => m.get(id) ?? null,
    set: (id, v) => void m.set(id, v),
    clear: (id) => void m.delete(id),
    has: (id) => m.has(id)
  }
}

function stubRegistry(tools: ToolDef[]): ToolRegistry {
  return {
    all: () => tools,
    get: (n) => tools.find((t) => t.name === n),
    readOnly: () => tools.filter((t) => !t.write),
    writable: () => tools.filter((t) => t.write)
  }
}

/** 内存版笔记读取(chat-service 只用得到 readBodyForAi) */
function stubNotes(bodies: Record<string, { title: string; body: string }> = {}): NotesService {
  return {
    readBodyForAi: async (id: string) => {
      const n = bodies[id]
      if (!n) return null
      return {
        note: {
          id,
          title: n.title,
          body: n.body,
          tags: [],
          refs: [],
          created: '',
          updated: '',
          pinned: false,
          excerpt: '',
          mtimeMs: 0,
          size: n.body.length,
          frontmatterIssues: [],
          refsUnparsed: false,
          opaque: false,
          revision: 'r1'
        },
        body: n.body,
        truncated: false
      }
    }
  } as unknown as NotesService
}

function build(opts: {
  faux: ReturnType<typeof fauxProvider>
  tools: ToolDef[]
  settings?: Partial<LauncherSettings>
  secrets?: SecretStore
  notes?: Record<string, { title: string; body: string }>
}): ChatService {
  const settings: LauncherSettings = { ...DEFAULT_SETTINGS, ...opts.settings }
  const secrets = opts.secrets ?? stubSecrets()
  const llm: LlmClient = {
    // 与真实实现同语义:没有 Key 就 resolve 失败(界面据此进引导态)
    resolve: () =>
      secrets.has(settings.aiProviderId)
        ? { ok: true, value: { model: opts.faux.getModel(), providerId: 'anthropic', providerName: 'Anthropic', modelLabel: 'faux' } }
        : { ok: false, reason: 'missing-key' },
    streamFn: (() => opts.faux.provider.streamSimple.bind(opts.faux.provider)) as unknown as () => StreamFn,
    providerName: () => 'Anthropic',
    catalog: () => [],
    modelMeta: () => ({
      modelId: settings.aiProviders[settings.aiProviderId]?.modelId ?? '',
      modelLabel: 'faux',
      contextWindow: 128_000,
      maxTokens: 8_192
    }),
    testConnection: async () => ({ ok: true, message: 'ok' })
  }
  return createChatService({
    llm,
    secrets,
    registry: stubRegistry(opts.tools),
    notes: stubNotes(opts.notes),
    getSettings: () => settings,
    storePath: join(dir, 'ai-sessions.json'),
    emit: (e) => events.push(e)
  })
}

const readonlyTool: ToolDef = {
  name: 'list_services',
  label: '列出服务',
  description: '列出服务',
  parameters: Type.Object({}),
  write: false,
  execute: async () => ({ lines: [{ level: 'ok', text: '服务 3 项' }] })
}

/** 取一条 transcript 消息的文本(内容可能是字符串,也可能是块数组) */
function transcriptText(m: { content: unknown }): string {
  if (typeof m.content === 'string') return m.content
  if (!Array.isArray(m.content)) return ''
  return m.content.map((c) => (c?.type === 'text' ? String(c.text) : '')).join('')
}

type ApprovalEvent = Extract<AiRunEvent, { type: 'approval_request' }>

/** 等到第 n 个授权请求出现(测试里的运行是异步的,不能直接读事件数组) */
async function waitApprovalCount(n: number): Promise<ApprovalEvent> {
  for (let i = 0; i < 300; i += 1) {
    const list = events.filter((e): e is ApprovalEvent => e.type === 'approval_request')
    if (list.length >= n) return list[n - 1]
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('approval timeout')
}

let ran = 0
const writeTool: ToolDef = {
  name: 'write_plist',
  label: '写入 plist',
  description: '写入 plist',
  parameters: Type.Object({ label: Type.String() }),
  write: true,
  summarize: (a) => ({ detail: `写入 ${a['label']}`, command: `plutil -lint ${a['label']}.plist` }),
  execute: async () => {
    ran++
    return { lines: [{ level: 'ok', text: '已写入' }], card: { kind: 'plist', xml: '<plist/>' } }
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'launcher-ai-'))
  events.length = 0
  ran = 0
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('ChatService 运行链路', () => {
  it('未配置 Key 时拒绝发送(界面据此进引导态)', async () => {
    const svc = build({ faux: fauxProvider(), tools: [readonlyTool], secrets: stubSecrets([]) })
    const s = svc.createSession()
    await expect(svc.send({ sessionId: s.id, text: '你好' })).rejects.toThrow(/AI_NOT_CONFIGURED/)
  })

  it('多轮:文本块流式落地,usage 与 stopReason 回填', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('第一点'), fauxText('第二点')])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: '看下本机' })

    const msgs = svc.getMessages(s.id)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    const a = msgs[1]
    expect(a.role).toBe('assistant')
    if (a.role !== 'assistant') throw new Error('unreachable')
    expect(a.blocks.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')).join('')).toBe('第一点第二点')
    expect(a.stopReason).not.toBe('pending')
    expect(events.some((e) => e.type === 'run_start')).toBe(true)
    expect(events.some((e) => e.type === 'run_end')).toBe(true)
    expect(events.some((e) => e.type === 'text_delta')).toBe(true)
  })

  it('只读工具直接执行:toolCall 进助手消息、结果是独立的 toolResult 消息(按 id 配对)', async () => {
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('list_services', {})]),
      fauxAssistantMessage([fauxText('好了')])
    ])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: '查' })

    const msgs = svc.getMessages(s.id)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'toolResult', 'assistant'])
    const call = msgs[1].role === 'assistant' ? msgs[1].blocks.find((b) => b.type === 'toolCall') : undefined
    expect(call).toBeTruthy()
    const tr = msgs[2]
    if (tr.role !== 'toolResult') throw new Error('unreachable')
    expect(tr.toolCallId).toBe(call && 'id' in call ? call.id : '')
    expect(tr.status).toBe('ok')
    expect(tr.isError).toBe(false)
    expect(tr.label).toBe('列出服务')
    expect(tr.blocks.some((b) => b.type === 'text' && b.text.includes('服务 3 项'))).toBe(true)
  })

  it('prepare_agent 是卡片专用只读结果:不申请授权也不排入自动验证', async () => {
    const prepareTool: ToolDef = {
      name: 'prepare_agent',
      label: '准备 Agent 创建计划',
      description: '只读计划',
      parameters: Type.Object({}),
      write: false,
      execute: async () => ({
        lines: [{ level: 'ok', text: '计划已就绪' }],
        cardOnly: true,
        card: {
          kind: 'agentPreparation', readiness: 'ready', label: 'com.user.plan', scope: 'user',
          command: '/bin/echo hello', trigger: '仅手动启动', logs: [], risks: [], questions: [], verification: []
        }
      })
    }
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('prepare_agent', {})]),
      fauxAssistantMessage([fauxText('请确认后再应用')])
    ])
    const svc = build({ faux, tools: [prepareTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: '准备一个任务' })
    const result = svc.getMessages(s.id).find((m) => m.role === 'toolResult')
    expect(result).toMatchObject({ role: 'toolResult', toolName: 'prepare_agent', cardOnly: true, status: 'ok' })
    expect(events.some((e) => e.type === 'approval_request')).toBe(false)
    expect(events.some((e) => e.type === 'user_message')).toBe(false)
  })

  it('同一轮 generate 后 write 漏传 xml 时，宿主复用草稿补齐并允许写入', async () => {
    let receivedXml = ''
    const generateTool: ToolDef = {
      name: 'generate_plist', label: '生成', description: '生成', parameters: Type.Object({ label: Type.String() }), write: false,
      execute: async () => ({ lines: [{ level: 'ok', text: 'draft' }], card: { kind: 'plist', xml: '<plist>draft</plist>' } })
    }
    const writeTool: ToolDef = {
      name: 'write_plist', label: '写入', description: '写入', parameters: Type.Object({ label: Type.String(), xml: Type.Optional(Type.String()) }), write: false,
      execute: async (args) => {
        receivedXml = String(args['xml'] ?? '')
        return { lines: [{ level: 'ok', text: 'written' }] }
      }
    }
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('generate_plist', { label: 'com.user.draft', scope: 'user' })]),
      fauxAssistantMessage([fauxToolCall('write_plist', { label: 'com.user.draft' })]),
      fauxAssistantMessage([fauxText('done')])
    ])
    const svc = build({ faux, tools: [generateTool, writeTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: 'draft then write' })
    expect(receivedXml).toBe('<plist>draft</plist>')
  })

  it('准备计划后直接 load 被宿主拦下，直到 write 成功', async () => {
    const prepareTool: ToolDef = {
      name: 'prepare_agent', label: '准备计划', description: '准备', parameters: Type.Object({ label: Type.String() }), write: false,
      execute: async () => ({
        lines: [{ level: 'ok', text: 'ready' }],
        card: { kind: 'agentPreparation', readiness: 'ready', label: 'com.user.guard', scope: 'user', command: '/bin/echo', trigger: 'manual', logs: [], risks: [], questions: [], verification: [] }
      })
    }
    const loadTool: ToolDef = {
      name: 'load_plist', label: '载入', description: '载入', parameters: Type.Object({ label: Type.String() }), write: false,
      execute: async () => ({ lines: [{ level: 'ok', text: 'loaded' }] })
    }
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('prepare_agent', { label: 'com.user.guard' })]),
      fauxAssistantMessage([fauxToolCall('load_plist', { label: 'com.user.guard' })]),
      fauxAssistantMessage([fauxText('done')])
    ])
    const svc = build({ faux, tools: [prepareTool, loadTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: 'prepare then load' })
    const result = svc.getMessages(s.id).filter((m) => m.role === 'toolResult').at(-1)
    expect(result).toMatchObject({ role: 'toolResult', toolName: 'load_plist', isError: true })
    if (result?.role !== 'toolResult') throw new Error('unreachable')
    expect(result.blocks.map((b) => b.type === 'text' ? b.text : '').join('\n')).toContain('尚未成功写入')
  })

  it('写工具先挂起等授权:授权后执行,并把授权卡状态改成 approved', async () => {
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('write_plist', { label: 'com.user.x' })]),
      fauxAssistantMessage([fauxText('done')])
    ])
    const svc = build({ faux, tools: [readonlyTool, writeTool] })
    const s = svc.createSession()

    const sending = svc.send({ sessionId: s.id, text: '写一个' })
    // 等 approval_request 出现后再应答
    await new Promise<void>((r) => {
      const t = setInterval(() => {
        const req = events.find((e) => e.type === 'approval_request')
        if (req) {
          clearInterval(t)
          r()
        }
      }, 10)
    })
    const req = events.find((e) => e.type === 'approval_request')
    if (!req || req.type !== 'approval_request') throw new Error('unreachable')
    expect(req.toolName).toBe('write_plist')
    expect(req.detail).toContain('com.user.x')
    expect(req.command).toContain('plutil -lint')
    expect(ran).toBe(0) // 授权前不得执行

    svc.respondApproval({ runId: req.runId, toolCallId: req.toolCallId, decision: 'approve' })
    await sending
    expect(ran).toBe(1)

    const card = svc
      .getMessages(s.id)
      .flatMap((m) => (m.role === 'assistant' ? m.blocks : []))
      .find((b) => b.type === 'card' && b.card.kind === 'approve')
    expect(card && card.type === 'card' && card.card.kind === 'approve' ? card.card.state : null).toBe('approved')
  })

  it('取消授权:工具不执行,结果标 warn(而非 err),卡片状态 cancelled', async () => {
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('write_plist', { label: 'com.user.y' })]),
      fauxAssistantMessage([fauxText('好的,已取消')])
    ])
    const svc = build({ faux, tools: [readonlyTool, writeTool] })
    const s = svc.createSession()

    const sending = svc.send({ sessionId: s.id, text: '写一个' })
    await new Promise<void>((r) => {
      const t = setInterval(() => {
        const req = events.find((e) => e.type === 'approval_request')
        if (req) {
          clearInterval(t)
          r()
        }
      }, 10)
    })
    const req = events.find((e) => e.type === 'approval_request')
    if (!req || req.type !== 'approval_request') throw new Error('unreachable')
    svc.respondApproval({ runId: req.runId, toolCallId: req.toolCallId, decision: 'cancel' })
    await sending

    expect(ran).toBe(0)
    const tr = svc.getMessages(s.id).find((m) => m.role === 'toolResult')
    expect(tr?.role).toBe('toolResult')
    if (tr?.role !== 'toolResult') throw new Error('unreachable')
    // 被拦下的调用不会走 execute —— 结果必须由 pi 的 tool_execution_end 补记,否则这一步会永远转圈
    expect(tr.status).toBe('warn')
    expect(tr.isError).toBe(true)

    const card = svc
      .getMessages(s.id)
      .flatMap((m) => (m.role === 'assistant' ? m.blocks : []))
      .find((b) => b.type === 'card' && b.card.kind === 'approve')
    expect(card && card.type === 'card' && card.card.kind === 'approve' ? card.card.state : null).toBe('cancelled')
  })

  it('本会话自动允许普通写操作:一次授权后后续写入不再逐条询问', async () => {
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('write_plist', { label: 'com.user.a' })]),
      fauxAssistantMessage([fauxText('first done')]),
      fauxAssistantMessage([fauxToolCall('write_plist', { label: 'com.user.b' })]),
      fauxAssistantMessage([fauxText('second done')])
    ])
    const svc = build({ faux, tools: [readonlyTool, writeTool] })
    const s = svc.createSession()

    const first = svc.send({ sessionId: s.id, text: 'first' })
    const req = await waitApprovalCount(1)
    const result = svc.respondApproval({
      runId: req.runId,
      toolCallId: req.toolCallId,
      decision: 'approve',
      rememberSession: true
    })
    expect(result.autoApprove).toBe(true)
    await first
    expect(ran).toBe(1)
    expect(svc.listSessions().find((x) => x.id === s.id)?.autoApprove).toBe(true)

    // 第二轮:同一个会话里的普通写入直接执行,不再发 approval_request
    const before = events.filter((e) => e.type === 'approval_request').length
    await svc.send({ sessionId: s.id, text: 'second' })
    expect(ran).toBe(2)
    expect(events.filter((e) => e.type === 'approval_request').length).toBe(before)

    // 自动放行的卡片要留痕,而不是像用户点过一样只显示「已执行」
    const cards = svc.getMessages(s.id).flatMap((m) => (m.role === 'assistant' ? m.blocks : []))
    expect(cards.some((b) => b.type === 'card' && b.card.kind === 'approve' && b.card.auto === true)).toBe(true)
  })

  it('本会话自动允许不覆盖高风险操作:危险写入仍逐条询问', async () => {
    let dangerousRan = 0
    const dangerousWrite: ToolDef = {
      name: 'delete_note',
      label: '删除笔记',
      description: '删除笔记',
      parameters: Type.Object({ id: Type.String() }),
      write: true,
      summarize: (a) => ({
        detail: `删除笔记 ${String(a['id'])}`,
        command: `notes/${String(a['id'])}.md → 废纸篓`,
        dangerous: true
      }),
      execute: async () => {
        dangerousRan += 1
        return { lines: [{ level: 'ok', text: 'deleted' }] }
      }
    }
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('write_plist', { label: 'com.user.a' })]),
      fauxAssistantMessage([fauxText('first done')]),
      fauxAssistantMessage([fauxToolCall('delete_note', { id: 'n1' })]),
      fauxAssistantMessage([fauxText('second done')])
    ])
    const svc = build({ faux, tools: [readonlyTool, writeTool, dangerousWrite] })
    const s = svc.createSession()

    const first = svc.send({ sessionId: s.id, text: 'first' })
    const req1 = await waitApprovalCount(1)
    expect(
      svc.respondApproval({
        runId: req1.runId,
        toolCallId: req1.toolCallId,
        decision: 'approve',
        rememberSession: true
      }).autoApprove
    ).toBe(true)
    await first
    expect(ran).toBe(1)

    const second = svc.send({ sessionId: s.id, text: 'second' })
    const req2 = await waitApprovalCount(2)
    expect(req2.dangerous).toBe(true)
    expect(dangerousRan).toBe(0)
    svc.respondApproval({ runId: req2.runId, toolCallId: req2.toolCallId, decision: 'approve' })
    await second
    expect(dangerousRan).toBe(1)
  })

  it('危险操作即使被误传 rememberSession 也不会开启会话豁免', async () => {
    const dangerousWrite: ToolDef = {
      name: 'delete_note',
      label: '删除笔记',
      description: '删除笔记',
      parameters: Type.Object({ id: Type.String() }),
      write: true,
      summarize: (a) => ({ detail: `删除 ${String(a['id'])}`, command: 'rm', dangerous: true }),
      execute: async () => ({ lines: [{ level: 'ok', text: 'deleted' }] })
    }
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('delete_note', { id: 'n1' })]),
      fauxAssistantMessage([fauxText('done')])
    ])
    const svc = build({ faux, tools: [readonlyTool, dangerousWrite] })
    const s = svc.createSession()

    const sending = svc.send({ sessionId: s.id, text: 'delete' })
    const req = await waitApprovalCount(1)
    const result = svc.respondApproval({
      runId: req.runId,
      toolCallId: req.toolCallId,
      decision: 'approve',
      rememberSession: true
    })
    expect(result.autoApprove).toBe(false)
    await sending
    expect(svc.listSessions().find((x) => x.id === s.id)?.autoApprove).toBe(false)
  })

  it('setAutoApprove 可开关,且只存在于当前服务实例(不跨重启)', () => {
    const svc = build({ faux: fauxProvider(), tools: [readonlyTool] })
    const s = svc.createSession()
    expect(svc.setAutoApprove({ sessionId: s.id, enabled: true }).autoApprove).toBe(true)
    expect(svc.listSessions().find((x) => x.id === s.id)?.autoApprove).toBe(true)
    expect(svc.setAutoApprove({ sessionId: s.id, enabled: false }).autoApprove).toBe(false)
    svc.setAutoApprove({ sessionId: s.id, enabled: true })

    const svc2 = build({ faux: fauxProvider(), tools: [readonlyTool] })
    expect(svc2.listSessions().find((x) => x.id === s.id)?.autoApprove).toBeFalsy()
  })

  it('会话按第一条用户消息起标题并持久化,重开服务后仍在', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('hi')])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: '帮我看看\n第二行不该进标题' })

    const listed = svc.listSessions()
    expect(listed[0].title).toBe('帮我看看')

    // 同一路径重建服务 → 会话与消息都还在
    const faux2 = fauxProvider()
    const svc2 = build({ faux: faux2, tools: [readonlyTool] })
    expect(svc2.listSessions().map((x) => x.id)).toContain(s.id)
    expect(svc2.getMessages(s.id).length).toBe(2)
  })

  it('删除会话后不再列出', async () => {
    const svc = build({ faux: fauxProvider(), tools: [readonlyTool] })
    const s = svc.createSession()
    svc.deleteSession(s.id)
    expect(svc.listSessions()).toHaveLength(0)
  })

  it('运行中再次发送被拒(AI_BUSY)', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('x')]), fauxAssistantMessage([fauxText('y')])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    const first = svc.send({ sessionId: s.id, text: 'a' })
    await expect(svc.send({ sessionId: s.id, text: 'b' })).rejects.toThrow(/AI_BUSY/)
    await first
  })

  it('技能收窄工具面:只把白名单里的工具交给模型', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('ok')])])
    const svc = build({ faux, tools: [readonlyTool, writeTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: '扫描重复配置', skillId: 'sk-refactor' })
    // sk-refactor 是只读技能,工具表里不应出现写工具
    expect(events.some((e) => e.type === 'run_start')).toBe(true)
    expect(faux.state.callCount).toBe(1)
  })

  it('多技能合一:工具白名单取并集,系统提示词包含各技能任务', async () => {
    const checkPortTool: ToolDef = {
      name: 'check_port',
      label: '检查端口',
      description: '检查端口',
      parameters: Type.Object({}),
      write: false,
      execute: async () => ({ lines: [{ level: 'ok', text: '空闲' }] })
    }
    const faux = fauxProvider()
    let seen: TranscriptContext | undefined
    faux.setResponses([
      (context) => {
        seen = context
        return fauxAssistantMessage([fauxText('ok')])
      }
    ])
    const svc = build({ faux, tools: [readonlyTool, checkPortTool, writeTool] })
    const s = svc.createSession()
    await svc.send({
      sessionId: s.id,
      text: '一起看看',
      skillIds: ['sk-refactor', 'sk-import']
    })

    const user = svc.getMessages(s.id)[0]
    if (user.role !== 'user') throw new Error('unreachable')
    expect(user.skillIds).toEqual(['sk-refactor', 'sk-import'])
    expect(user.skillId).toBe('sk-refactor')

    const sys = seen ? getCurrentSystemMessage(seen.messages) : undefined
    expect(sys?.content).toContain('严格只读')
    expect(sys?.content).toContain('一律盘点')
    expect(sys?.content).toContain('同时启用了 2 个技能')
    const names = (sys?.toolsAdded ?? []).map((t) => t.name)
    expect(names).toContain('list_services')
    expect(names).toContain('check_port')
    // sk-refactor 与 sk-import 都不允许写入;并集也不能把写工具放进来
    expect(names).not.toContain('write_plist')
  })

  it('多技能撤回后原样带回,未知/重复技能在发送时收敛', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('ok')])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({
      sessionId: s.id,
      text: '一起看看',
      skillIds: ['sk-import', 'sk-removed', 'sk-refactor', 'sk-import']
    })
    const user = svc.getMessages(s.id).find((m) => m.role === 'user')
    if (!user) throw new Error('unreachable')
    expect(user.skillIds).toEqual(['sk-import', 'sk-refactor'])

    const out = await svc.retract({ sessionId: s.id, messageId: user.id })
    expect(out.skillIds).toEqual(['sk-import', 'sk-refactor'])
    expect(out.skillId).toBe('sk-import')
  })

  it('旧数据的 skillId 在载入时归一成 skillIds', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('ok')])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: '看', skillIds: ['sk-refactor'] })

    const storePath = join(dir, 'ai-sessions.json')
    const store = JSON.parse(readFileSync(storePath, 'utf8')) as {
      sessions: Array<{ messages: Array<Record<string, unknown>> }>
    }
    const user = store.sessions[0]?.messages[0]
    if (!user) throw new Error('unreachable')
    delete user.skillIds
    user.skillId = 'sk-import'
    writeFileSync(storePath, JSON.stringify(store), 'utf8')

    const reloaded = build({ faux: fauxProvider(), tools: [readonlyTool] })
    const msg = reloaded.getMessages(s.id)[0]
    if (msg.role !== 'user') throw new Error('unreachable')
    expect(msg.skillIds).toEqual(['sk-import'])
    expect(msg.skillId).toBe('sk-import')
  })

  /** 轮询应答所有出现的授权卡(自动验证链路里可能连续出现多张) */
  async function approveAll(svc: ChatService, sending: Promise<void>): Promise<void> {
    const responded = new Set<string>()
    const t = setInterval(() => {
      for (const e of events) {
        if (e.type === 'approval_request' && !responded.has(e.toolCallId)) {
          responded.add(e.toolCallId)
          svc.respondApproval({ runId: e.runId, toolCallId: e.toolCallId, decision: 'approve' })
        }
      }
    }, 10)
    try {
      await sending
    } finally {
      clearInterval(t)
    }
  }

  it('load_plist 成功后宿主注入自动验证轮(状态与日志真实读数进消息)', async () => {
    const loadTool: ToolDef = {
      name: 'load_plist',
      label: '载入任务',
      description: '载入任务',
      parameters: Type.Object({ label: Type.String() }),
      write: true,
      summarize: (a) => ({ detail: `载入 ${a['label']}`, command: 'launchctl bootstrap' }),
      execute: async () => ({ lines: [{ level: 'ok', text: '已载入 com.user.x' }] })
    }
    const statusTool: ToolDef = {
      name: 'get_service_status',
      label: '查看状态',
      description: '查看状态',
      parameters: Type.Object({ label: Type.String() }),
      write: false,
      execute: async () => ({ lines: [{ level: '', text: 'pid=456 running' }] })
    }
    const logTool: ToolDef = {
      name: 'tail_log',
      label: '查看日志',
      description: '查看日志',
      parameters: Type.Object({ label: Type.String() }),
      write: false,
      execute: async () => ({ lines: [{ level: '', text: 'Started com.user.x' }] })
    }
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('load_plist', { label: 'com.user.x' })]),
      fauxAssistantMessage([fauxText('已载入 com.user.x')]),
      fauxAssistantMessage([fauxText('验证通过,pid=456,交付完成')])
    ])
    const svc = build({ faux, tools: [loadTool, statusTool, logTool] })
    const s = svc.createSession()
    await approveAll(svc, svc.send({ sessionId: s.id, text: '建个任务并载入' }))

    const injected = events.filter((e) => e.type === 'user_message')
    expect(injected).toHaveLength(1)
    const first = injected[0]
    if (!first || first.type !== 'user_message') throw new Error('unreachable')
    expect(first.text).toContain('【自动验证】')
    expect(first.text).toContain('pid=456 running')
    expect(first.text).toContain('Started com.user.x')
    // 判据必须区分常驻 / 一次性 / 定时任务:未运行不能一律当故障
    expect(first.text).toContain('一次性任务')
    expect(first.text).toContain('exit code 0 即成功')

    // 落库一致:session 里能按 id 找到这条注入消息(重载后不丢)
    const stored = svc.getMessages(s.id).find((m) => m.role === 'user' && m.id === first.messageId)
    expect(stored).toBeTruthy()
    // 模型对注入消息的回复也已落库(排在注入消息之后)
    const msgs = svc.getMessages(s.id)
    expect(msgs[msgs.length - 1]).toMatchObject({ role: 'assistant' })
  })

  it('自动验证最多注入 2 轮(修了又载也不会无限续跑)', async () => {
    const loadTool: ToolDef = {
      name: 'load_plist',
      label: '载入任务',
      description: '载入任务',
      parameters: Type.Object({ label: Type.String() }),
      write: true,
      summarize: (a) => ({ detail: `载入 ${a['label']}`, command: 'launchctl bootstrap' }),
      execute: async () => ({ lines: [{ level: 'ok', text: '已载入' }] })
    }
    const statusTool: ToolDef = {
      name: 'get_service_status',
      label: '查看状态',
      description: '查看状态',
      parameters: Type.Object({ label: Type.String() }),
      write: false,
      execute: async () => ({ lines: [{ level: '', text: 'running' }] })
    }
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('load_plist', { label: 'com.user.a' })]),
      fauxAssistantMessage([fauxToolCall('load_plist', { label: 'com.user.b' })]),
      fauxAssistantMessage([fauxText('两轮载入完成,等待宿主验证')]),
      fauxAssistantMessage([fauxText('第一条注入消息收到,已确认')]),
      fauxAssistantMessage([fauxText('第二条注入消息收到,注入额度已用完,先汇报')])
    ])
    const svc = build({ faux, tools: [loadTool, statusTool] })
    const s = svc.createSession()
    await approveAll(svc, svc.send({ sessionId: s.id, text: '反复载入' }))

    expect(events.filter((e) => e.type === 'user_message')).toHaveLength(2)
  })

  it('只 write 不 load:不注入自动验证(用户可能只要落盘)', async () => {
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('write_plist', { label: 'com.user.y' })]),
      fauxAssistantMessage([fauxText('已写入,未载入')])
    ])
    const svc = build({ faux, tools: [writeTool] })
    const s = svc.createSession()
    await approveAll(svc, svc.send({ sessionId: s.id, text: '只写入' }))
    expect(events.some((e) => e.type === 'user_message')).toBe(false)
  })

  it('load 后又 unload:不注入自动验证(不验证被故意停掉的任务)', async () => {
    const loadTool: ToolDef = {
      name: 'load_plist',
      label: '载入任务',
      description: '载入任务',
      parameters: Type.Object({ label: Type.String() }),
      write: true,
      summarize: (a) => ({ detail: `载入 ${a['label']}`, command: 'launchctl bootstrap' }),
      execute: async () => ({ lines: [{ level: 'ok', text: '已载入' }] })
    }
    const unloadTool: ToolDef = {
      name: 'unload_plist',
      label: '卸载任务',
      description: '卸载任务',
      parameters: Type.Object({ label: Type.String() }),
      write: true,
      summarize: (a) => ({ detail: `卸载 ${a['label']}`, command: 'launchctl bootout' }),
      execute: async () => ({ lines: [{ level: 'ok', text: '已卸载' }] })
    }
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall('load_plist', { label: 'com.user.x' }),
        fauxToolCall('unload_plist', { label: 'com.user.x' })
      ]),
      fauxAssistantMessage([fauxText('已回滚')])
    ])
    const svc = build({ faux, tools: [loadTool, unloadTool] })
    const s = svc.createSession()
    await approveAll(svc, svc.send({ sessionId: s.id, text: '载入后回滚' }))
    expect(events.some((e) => e.type === 'user_message')).toBe(false)
  })

  it('自动验证对刚启动的服务做短轮询(第一次未运行,第二次 running)', async () => {
    let statusCalls = 0
    const loadTool: ToolDef = {
      name: 'load_plist',
      label: '载入任务',
      description: '载入任务',
      parameters: Type.Object({ label: Type.String() }),
      write: true,
      summarize: (a) => ({ detail: `载入 ${a['label']}`, command: 'launchctl bootstrap' }),
      execute: async () => ({ lines: [{ level: 'ok', text: '已载入' }] })
    }
    const statusTool: ToolDef = {
      name: 'get_service_status',
      label: '查看状态',
      description: '查看状态',
      parameters: Type.Object({ label: Type.String() }),
      write: false,
      execute: async () => {
        statusCalls += 1
        return { lines: [{ level: '', text: statusCalls === 1 ? 'pid — · uptime —' : 'pid=999 · uptime 0s' }] }
      }
    }
    const logTool: ToolDef = {
      name: 'tail_log',
      label: '查看日志',
      description: '查看日志',
      parameters: Type.Object({ label: Type.String() }),
      write: false,
      execute: async () => ({ lines: [{ level: '', text: 'starting' }] })
    }
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('load_plist', { label: 'com.user.slow' })]),
      fauxAssistantMessage([fauxText('已载入,等待验证')]),
      fauxAssistantMessage([fauxText('验证通过 pid=999')])
    ])
    const svc = build({ faux, tools: [loadTool, statusTool, logTool] })
    const s = svc.createSession()
    await approveAll(svc, svc.send({ sessionId: s.id, text: '载入慢启动服务' }))
    const injected = events.filter((e) => e.type === 'user_message')
    expect(injected).toHaveLength(1)
    if (injected[0]?.type !== 'user_message') throw new Error('unreachable')
    expect(injected[0].text).toContain('pid=999')
    expect(statusCalls).toBeGreaterThanOrEqual(2)
  })

  it('skill.turnLimit 抬高轮数下限:全局 4 轮时 sk-plist 仍能跑到第 5+ 轮', async () => {
    let listCount = 0
    const listTool: ToolDef = {
      name: 'list_services',
      label: '列出服务',
      description: '列出服务',
      parameters: Type.Object({}),
      write: false,
      execute: async () => {
        listCount++
        return { lines: [{ level: 'ok', text: `第 ${listCount} 次` }] }
      }
    }
    const toolTurn = () => fauxAssistantMessage([fauxToolCall('list_services', {})])
    // sk-plist 白名单里的工具名才可见:list_services 在白名单内
    const tools = [listTool]

    // 对照:无 skill 时 4 轮封顶(第 4 轮工具执行完就 end,第 5 条响应不会被消费)
    const fauxA = fauxProvider()
    fauxA.setResponses([toolTurn(), toolTurn(), toolTurn(), toolTurn(), toolTurn(), fauxAssistantMessage([fauxText('done')])])
    listCount = 0
    const svcA = build({ faux: fauxA, tools, settings: { aiToolCallLimit: 4 } })
    const sA = svcA.createSession()
    await svcA.send({ sessionId: sA.id, text: '跑几轮' })
    expect(listCount).toBe(4)
    expect(fauxA.state.callCount).toBe(4)

    // sk-plist:turnLimit 16 → max(4, 16) = 16,第 5 次工具与收尾文本都能跑完
    const fauxB = fauxProvider()
    fauxB.setResponses([toolTurn(), toolTurn(), toolTurn(), toolTurn(), toolTurn(), fauxAssistantMessage([fauxText('done')])])
    listCount = 0
    const svcB = build({ faux: fauxB, tools, settings: { aiToolCallLimit: 4 } })
    const sB = svcB.createSession()
    await svcB.send({ sessionId: sB.id, text: '跑几轮', skillId: 'sk-plist' })
    expect(listCount).toBe(5)
    expect(fauxB.state.callCount).toBe(6)
  })

  it('环境缺失的会话 id 会拒绝(不静默新建)', async () => {
    const svc = build({ faux: fauxProvider(), tools: [readonlyTool] })
    await expect(svc.send({ sessionId: 'nope', text: 'x' })).rejects.toThrow(/AI_SESSION_MISSING/)
  })

  it('@ 引用的笔记:正文在发送时注入 prompt,但不进落库的消息本身', async () => {
    const faux = fauxProvider()
    let seen = ''
    faux.setResponses([
      (ctx) => {
        seen = transcriptText(ctx.messages[ctx.messages.length - 1])
        return fauxAssistantMessage([fauxText('好的')])
      }
    ])
    const svc = build({
      faux,
      tools: [readonlyTool],
      notes: { '工作/nginx': { title: 'nginx 排障', body: '8080 端口被占用，先 lsof' } }
    })
    const s = svc.createSession()
    await svc.send({
      sessionId: s.id,
      text: '按这篇继续',
      mentions: [{ key: 'note:工作/nginx', type: 'note', id: '工作/nginx', label: 'nginx 排障' }]
    })

    expect(seen).toContain('8080 端口被占用')
    expect(seen).toContain('笔记「nginx 排障」')
    expect(seen).toContain('id=工作/nginx')
    expect(seen).toContain('按这篇继续')

    const user = svc.getMessages(s.id)[0]
    if (user.role !== 'user') throw new Error('unreachable')
    // 引用只是「指路」:正文不落进消息内容(否则会话文件会被笔记正文灌满)
    expect(user.blocks).toEqual([{ type: 'text', text: '按这篇继续' }])
    expect(user.mentions?.[0]?.id).toBe('工作/nginx')
  })

  it('引用的笔记被删掉后仍能发送:注入一行「已不存在」而不是报错', async () => {
    const faux = fauxProvider()
    let seen = ''
    faux.setResponses([
      (ctx) => {
        seen = transcriptText(ctx.messages[ctx.messages.length - 1])
        return fauxAssistantMessage([fauxText('好的')])
      }
    ])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({
      sessionId: s.id,
      text: '看这篇',
      mentions: [{ key: 'note:gone', type: 'note', id: 'gone', label: '没了' }]
    })
    expect(seen).toContain('已不存在')
  })

  it('工具返回的图片只进当轮上下文,落库换成一行说明(会话文件不会被 base64 灌满)', async () => {
    const faux = fauxProvider()
    let sawImage = false
    const imageTool: ToolDef = {
      name: 'read_note_image',
      label: '查看笔记里的图片',
      description: '看图',
      parameters: Type.Object({}),
      write: false,
      execute: async () => ({
        lines: [{ level: 'ok', text: '已读取图片 assets/a.png' }],
        images: [{ type: 'image', data: 'QUJD', mimeType: 'image/png' }]
      })
    }
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('read_note_image', {})]),
      (ctx) => {
        sawImage = ctx.messages.some(
          (m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'image')
        )
        return fauxAssistantMessage([fauxText('看到了')])
      }
    ])
    const svc = build({ faux, tools: [imageTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: '看看图' })

    expect(sawImage).toBe(true)
    const tr = svc.getMessages(s.id).find((m) => m.role === 'toolResult')
    if (tr?.role !== 'toolResult') throw new Error('unreachable')
    expect(tr.blocks.some((b) => b.type === 'image')).toBe(false)
    expect(tr.blocks.some((b) => b.type === 'text' && b.text.includes('未存入历史'))).toBe(true)
  })

  it('撤回最后一条用户消息:删除其后的回复,并原样返回文本与引用', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('回复')])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    const mention = { key: 'cron:backup', type: 'cron' as const, id: 'backup', label: '每日备份' }
    await svc.send({
      sessionId: s.id,
      text: '误发的消息',
      mentions: [mention],
      clientMessageId: 'local-u-1'
    })

    const user = svc.getMessages(s.id).find((m) => m.role === 'user')
    if (!user) throw new Error('unreachable')
    expect(user.id).toBe('local-u-1')
    await expect(svc.retract({ sessionId: s.id, messageId: user.id })).resolves.toEqual({
      text: '误发的消息',
      mentions: [mention]
    })

    expect(svc.getMessages(s.id)).toHaveLength(0)
    expect(svc.listSessions()[0]?.title).toBe('')
    // 重载后仍是撤回后的状态(main 已落盘,不只是内存)
    const reloaded = build({ faux: fauxProvider(), tools: [readonlyTool] })
    expect(reloaded.getMessages(s.id)).toHaveLength(0)
  })

  it('撤回历史用户消息:删除该条及其后的所有轮次,保留更早的对话', async () => {
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxText('第一条回复')]),
      fauxAssistantMessage([fauxText('第二条回复')]),
      fauxAssistantMessage([fauxText('第三条回复')])
    ])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: '第一条' })
    await svc.send({ sessionId: s.id, text: '第二条' })
    await svc.send({ sessionId: s.id, text: '第三条' })
    const users = svc.getMessages(s.id).filter((m) => m.role === 'user')
    const second = users[1]
    if (!second) throw new Error('unreachable')

    await expect(svc.retract({ sessionId: s.id, messageId: second.id })).resolves.toMatchObject({
      text: '第二条'
    })
    expect(svc.getMessages(s.id).map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(svc.getMessages(s.id)[0]?.blocks).toMatchObject([{ type: 'text', text: '第一条' }])
    expect(svc.listSessions()[0]?.title).toBe('第一条')

    // 再撤回剩下的第一条(此时它是历史消息中的第一条):整段清空,标题复位
    const first = svc.getMessages(s.id).find((m) => m.role === 'user')
    if (!first) throw new Error('unreachable')
    await svc.retract({ sessionId: s.id, messageId: first.id })
    expect(svc.getMessages(s.id)).toHaveLength(0)
    expect(svc.listSessions()[0]?.title).toBe('')
  })

  it('运行中撤回:先中止当前 run,再删掉已落库的消息', async () => {
    const faux = fauxProvider({ tokensPerSecond: 10 })
    faux.setResponses([fauxAssistantMessage([fauxText('很长'.repeat(200))])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    const sending = svc.send({
      sessionId: s.id,
      text: '误发后立刻撤回',
      clientMessageId: 'local-u-live'
    })
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (events.some((e) => e.type === 'run_start')) {
          clearInterval(timer)
          resolve()
        }
      }, 5)
    })
    const user = svc.getMessages(s.id).find((m) => m.role === 'user')
    if (!user) throw new Error('unreachable')
    expect(user.id).toBe('local-u-live')

    await expect(svc.retract({ sessionId: s.id, messageId: user.id })).resolves.toMatchObject({
      text: '误发后立刻撤回'
    })
    await sending
    expect(svc.isRunning()).toBe(false)
    expect(svc.getMessages(s.id)).toHaveLength(0)
    expect(events.some((e) => e.type === 'run_end' && e.stopReason === 'aborted')).toBe(true)
  })

  it('run 刚建立就停止:不再发起模型请求', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('不应出现')])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    const sending = svc.send({ sessionId: s.id, text: '立刻停' })
    // send 已同步跑到第一个 await,此时 abort 应能阻止 prompt 发出。
    svc.abort()
    await sending
    expect(faux.state.callCount).toBe(0)
    expect(svc.isRunning()).toBe(false)
  })
})

describe('ChatService 附件', () => {
  const image = {
    type: 'image' as const,
    key: 'i1',
    name: 'shot.png',
    mimeType: 'image/png',
    data: 'iVBORw0KGgo='
  }
  const textFile = {
    type: 'text' as const,
    key: 't1',
    name: 'notes.md',
    content: '8080 被占用',
    bytes: 12
  }

  it('附件随消息入库,当前轮只送一张图且文本进入上下文', async () => {
    const faux = fauxProvider()
    let imageCount = -1
    let userText = ''
    faux.setResponses([
      (ctx) => {
        const users = ctx.messages.filter((m) => m.role === 'user')
        const last = users[users.length - 1] as { content: unknown }
        const parts = Array.isArray(last.content)
          ? (last.content as Array<{ type: string; text?: string }>)
          : []
        imageCount = parts.filter((p) => p.type === 'image').length
        userText = parts.map((p) => (p.type === 'text' ? p.text ?? '' : '')).join('')
        return fauxAssistantMessage([fauxText('ok')])
      }
    ])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: '看看这些', attachments: [image, textFile] })

    const user = svc.getMessages(s.id)[0]
    if (user.role !== 'user') throw new Error('unreachable')
    expect(user.attachments).toHaveLength(2)
    expect(user.attachments?.[0]).toMatchObject({ type: 'image', name: 'shot.png' })
    expect(imageCount).toBe(1)
    expect(userText).toContain('8080 被占用')
    expect(userText).toContain('看看这些')
  })

  it('下一轮历史回放仍带上一轮图片,且不会重复', async () => {
    const faux = fauxProvider()
    const counts: number[] = []
    faux.setResponses([
      fauxAssistantMessage([fauxText('收到')]),
      (ctx) => {
        let n = 0
        for (const m of ctx.messages) {
          if (!Array.isArray(m.content)) continue
          n += m.content.filter((c) => c.type === 'image').length
        }
        counts.push(n)
        return fauxAssistantMessage([fauxText('继续')])
      }
    ])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: '第一轮', attachments: [image] })
    await svc.send({ sessionId: s.id, text: '第二轮' })
    expect(counts).toEqual([1])
  })

  it('拒绝空消息;纯附件可发送并用文件名作标题', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('ok')])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await expect(svc.send({ sessionId: s.id, text: '   ' })).rejects.toThrow(/AI_EMPTY_MESSAGE/)
    expect(svc.getMessages(s.id)).toHaveLength(0)

    await svc.send({ sessionId: s.id, text: '   ', attachments: [textFile] })
    const listed = svc.listSessions().find((x) => x.id === s.id)
    expect(listed?.title).toBe('notes.md')
    expect(svc.getMessages(s.id).map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('非法附件拒绝发送,且不落库', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('不应出现')])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await expect(
      svc.send({
        sessionId: s.id,
        text: 'x',
        attachments: [{ ...image, mimeType: 'image/svg+xml', name: 'x.svg' }]
      })
    ).rejects.toThrow(/AI_ATTACHMENT_INVALID/)
    expect(svc.getMessages(s.id)).toHaveLength(0)
    expect(faux.state.callCount).toBe(0)
  })

  it('撤回带回未裁剪的附件', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('ok')])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: '带着文件', attachments: [image, textFile] })
    const user = svc.getMessages(s.id).find((m) => m.role === 'user')
    if (!user) throw new Error('unreachable')
    const out = await svc.retract({ sessionId: s.id, messageId: user.id })
    expect(out.attachments).toHaveLength(2)
    expect(out.attachments?.[0]).toMatchObject({ key: 'i1', type: 'image' })
  })

  it('每一轮的附件按添加顺序绑定在该条用户消息上', async () => {
    const faux = fauxProvider()
    const seen: string[] = []
    faux.setResponses([
      (ctx) => {
        seen.push(transcriptText(ctx.messages[ctx.messages.length - 1]))
        return fauxAssistantMessage([fauxText('收到')])
      },
      (ctx) => {
        const users = ctx.messages.filter((m) => m.role === 'user')
        seen.push(users.map((m) => transcriptText(m)).join('\n===\n'))
        return fauxAssistantMessage([fauxText('继续')])
      }
    ])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    const first = { type: 'text' as const, key: 't-first', name: 'first.md', content: 'FIRST', bytes: 5 }
    const third = { type: 'text' as const, key: 't-third', name: 'third.log', content: 'THIRD', bytes: 5 }
    const second = {
      type: 'text' as const,
      key: 't-second',
      name: 'second.json',
      content: 'SECOND',
      bytes: 6
    }

    await svc.send({ sessionId: s.id, text: '第一轮', attachments: [first, image, third] })
    await svc.send({ sessionId: s.id, text: '第二轮', attachments: [second] })

    const users = svc.getMessages(s.id).filter((m) => m.role === 'user')
    expect(users[0].attachments?.map((a) => a.key)).toEqual(['t-first', 'i1', 't-third'])
    expect(users[1].attachments?.map((a) => a.key)).toEqual(['t-second'])

    // 第二轮请求回放历史时,第一轮仍保持「文本 → 图片 → 文本」的添加顺序;
    // 第二轮的上下文只出现自己的附件,不串到别的节点。
    const historical = seen[1].split('\n===\n')
    expect(historical).toHaveLength(2)
    expect(historical[0].indexOf('first.md')).toBeLessThan(historical[0].indexOf('shot.png'))
    expect(historical[0].indexOf('shot.png')).toBeLessThan(historical[0].indexOf('third.log'))
    expect(historical[1]).toContain('second.json')
    expect(historical[1]).not.toContain('first.md')
    expect(historical[1]).not.toContain('third.log')

    // 重新载入会话文件后,节点归属与顺序仍在
    const reloaded = build({ faux, tools: [readonlyTool] })
    const reloadedUsers = reloaded.getMessages(s.id).filter((m) => m.role === 'user')
    expect(reloadedUsers[0].attachments?.map((a) => a.key)).toEqual(['t-first', 'i1', 't-third'])
    expect(reloadedUsers[1].attachments?.map((a) => a.key)).toEqual(['t-second'])
  })

  it('引用与附件混排:按共用 order 落库,并在上下文里声明总顺序', async () => {
    const faux = fauxProvider()
    let seen = ''
    faux.setResponses([
      (ctx) => {
        seen = transcriptText(ctx.messages[ctx.messages.length - 1])
        return fauxAssistantMessage([fauxText('ok')])
      }
    ])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({
      sessionId: s.id,
      text: '按顺序看',
      mentions: [
        {
          key: 'agent:user:com.foo',
          type: 'agent',
          id: 'user:com.foo',
          label: 'com.foo',
          scope: 'user',
          order: 30
        }
      ],
      attachments: [
        { ...textFile, key: 't-mixed', name: 'first.md', order: 0 },
        { ...image, key: 'i-mixed', name: 'shot.png', order: 20 }
      ]
    })

    // 跨类别的总顺序必须显式写给模型:分类正文仍按各自的数组顺序成块。
    expect(seen).toContain(
      '[本条消息的引用顺序：文件「first.md」 → 图片「shot.png」 → 任务「com.foo」]'
    )
    const user = svc.getMessages(s.id)[0]
    if (user.role !== 'user') throw new Error('unreachable')
    expect(user.attachments?.map((a) => a.order)).toEqual([0, 20])
    expect(user.mentions?.[0]?.order).toBe(30)
  })

  it('light 模式剥离附件负载,完整模式保留', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('ok')])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: 'x', attachments: [image, textFile] })

    const full = svc.getMessages(s.id)[0]
    if (full.role !== 'user') throw new Error('unreachable')
    expect(full.attachments?.[0]).toMatchObject({ data: image.data })
    expect(full.attachments?.[1]).toMatchObject({ content: textFile.content })

    const light = svc.getMessages(s.id, { light: true })[0]
    if (light.role !== 'user') throw new Error('unreachable')
    expect(light.attachments?.every((a) => a.trimmed)).toBe(true)
    for (const a of light.attachments ?? []) {
      if (a.type === 'image') expect(a.data).toBe('')
      else expect(a.content).toBe('')
    }
  })

  it('落盘后不残留 .tmp 文件', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('ok')])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: 'x', attachments: [image] })
    expect(existsSync(join(dir, 'ai-sessions.json'))).toBe(true)
    expect(existsSync(join(dir, 'ai-sessions.json.tmp'))).toBe(false)
  })
})

describe('ChatService 计时', () => {
  it('run_end 带 messageId/durationMs/finishedAt,只有最后一条助手消息带整轮耗时', async () => {
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('list_services', {})]),
      fauxAssistantMessage([fauxText('完成')])
    ])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: '跑一下' })

    const assistants = svc
      .getMessages(s.id)
      .filter((m): m is Extract<typeof m, { role: 'assistant' }> => m.role === 'assistant')
    expect(assistants).toHaveLength(2)
    expect(assistants[0].finishedAt).toBeGreaterThan(0)
    expect(assistants[0].durationMs).toBeUndefined()
    expect(assistants[1].finishedAt).toBeGreaterThan(0)
    expect(assistants[1].durationMs).toBeGreaterThanOrEqual(0)

    const end = events.find((e) => e.type === 'run_end')
    if (end?.type !== 'run_end') throw new Error('unreachable')
    expect(end.messageId).toBe(assistants[1].id)
    expect(end.durationMs).toBe(assistants[1].durationMs)
    expect(end.finishedAt).toBe(assistants[1].finishedAt)
  })

  it('重载会话文件后计时字段仍在', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('ok')])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: 'hi' })
    const before = svc.getMessages(s.id).find((m) => m.role === 'assistant')
    if (!before || before.role !== 'assistant') throw new Error('unreachable')

    const reloaded = build({ faux: fauxProvider(), tools: [readonlyTool] })
    const after = reloaded.getMessages(s.id).find((m) => m.role === 'assistant')
    if (!after || after.role !== 'assistant') throw new Error('unreachable')
    expect(after.finishedAt).toBe(before.finishedAt)
    expect(after.durationMs).toBe(before.durationMs)
  })
})

describe('ChatService 分支', () => {
  async function twoTurns(): Promise<{
    svc: ChatService
    ids: { session: string; firstUser: string; firstFinal: string; toolCall: string }
  }> {
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('list_services', {})]),
      fauxAssistantMessage([fauxText('第一轮结论')]),
      fauxAssistantMessage([fauxText('第二轮结论')])
    ])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: '第一轮' })
    await svc.send({ sessionId: s.id, text: '第二轮' })
    const msgs = svc.getMessages(s.id)
    const firstUser = msgs.find((m) => m.role === 'user')
    const assistants = msgs.filter(
      (m): m is Extract<typeof m, { role: 'assistant' }> => m.role === 'assistant'
    )
    if (!firstUser) throw new Error('unreachable')
    return {
      svc,
      ids: {
        session: s.id,
        firstUser: firstUser.id,
        firstFinal: assistants[1].id,
        toolCall: assistants[0].id
      }
    }
  }

  it('复制分叉点之前的上下文,排除之后的对话', async () => {
    const { svc, ids } = await twoTurns()
    const b = svc.branch({ sessionId: ids.session, messageId: ids.firstFinal })
    expect(b.title).toBe('第一轮 · 分支')
    expect(b.branch).toEqual({
      sessionId: ids.session,
      messageId: ids.firstFinal,
      title: '第一轮'
    })
    expect(b.autoApprove).toBe(false)
    const copied = svc.getMessages(b.id)
    expect(copied.map((m) => m.role)).toEqual(['user', 'assistant', 'toolResult', 'assistant'])
    expect(copied.map((m) => m.id)).toEqual([
      ids.firstUser,
      ids.toolCall,
      expect.any(String),
      ids.firstFinal
    ])
    expect(svc.listSessions().find((x) => x.id === b.id)?.branch).toEqual(b.branch)
  })

  it('从带工具调用的回复分叉时把紧随的 toolResult 一并复制', async () => {
    const { svc, ids } = await twoTurns()
    const b = svc.branch({ sessionId: ids.session, messageId: ids.toolCall })
    expect(svc.getMessages(b.id).map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'toolResult'
    ])
  })

  it('分支后可以继续发送', async () => {
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([fauxText('第一轮结论')]),
      fauxAssistantMessage([fauxText('分叉后续写')])
    ])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: '第一轮' })
    const a = svc.getMessages(s.id).find((m) => m.role === 'assistant')
    if (!a) throw new Error('unreachable')
    const b = svc.branch({ sessionId: s.id, messageId: a.id })
    await svc.send({ sessionId: b.id, text: '继续' })
    expect(svc.getMessages(b.id).map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant'
    ])
  })

  it('目标不是助手回复时拒绝', async () => {
    const { svc, ids } = await twoTurns()
    expect(() => svc.branch({ sessionId: ids.session, messageId: ids.firstUser })).toThrow(
      /AI_BRANCH_NOT_FOUND/
    )
    expect(() =>
      svc.branch({ sessionId: 'missing', messageId: ids.firstFinal })
    ).toThrow(/AI_SESSION_MISSING/)
  })
})


describe('ChatService 内联分段与技能', () => {
  const textAttachment = {
    type: 'text' as const,
    key: 't-seg',
    name: 'seg.md',
    content: 'SEG',
    bytes: 3
  }
  const cronMention = {
    key: 'cron:backup',
    type: 'cron' as const,
    id: 'backup',
    label: '每日备份'
  }
  const segments = [
    { type: 'text' as const, text: '先看 ' },
    { type: 'ref' as const, refType: 'attachment' as const, key: 't-seg' },
    { type: 'text' as const, text: ' 再查 ' },
    { type: 'ref' as const, refType: 'mention' as const, key: 'cron:backup' },
    { type: 'skill' as const, id: 'sk-refactor' }
  ]

  it('按输入时的交错顺序落库,丢弃不存在的引用键', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('ok')])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({
      sessionId: s.id,
      text: '先看 再查',
      attachments: [textAttachment],
      mentions: [cronMention],
      segments: [
        ...segments,
        { type: 'ref', refType: 'attachment', key: 'ghost' },
        { type: 'skill', id: 'sk-not-selected' }
      ],
      skillId: 'sk-refactor'
    })

    const user = svc.getMessages(s.id)[0]
    if (user.role !== 'user') throw new Error('unreachable')
    expect(user.segments).toEqual(segments)
    expect(user.skillId).toBe('sk-refactor')
    // 分段只用于回显;送给模型/写入正文的仍是干净的 text
    expect(user.blocks).toEqual([{ type: 'text', text: '先看 再查' }])
  })

  it('只选技能、没有正文也可以发送(技能会先问目标)', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('你想生成什么任务？')])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({ sessionId: s.id, text: '', skillId: 'sk-refactor' })

    const user = svc.getMessages(s.id)[0]
    if (user.role !== 'user') throw new Error('unreachable')
    expect(user.blocks).toEqual([{ type: 'text', text: '' }])
    expect(user.skillId).toBe('sk-refactor')
    expect(svc.listSessions().find((x) => x.id === s.id)?.title).toBe('技能任务')
  })

  it('撤回带回内联分段与技能;被裁剪的附件不会留下幽灵 chip', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('ok')])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({
      sessionId: s.id,
      text: '先看 再查',
      attachments: [textAttachment],
      mentions: [cronMention],
      segments,
      skillId: 'sk-refactor'
    })
    const user = svc.getMessages(s.id).find((m) => m.role === 'user')
    if (!user) throw new Error('unreachable')
    const out = await svc.retract({ sessionId: s.id, messageId: user.id })
    expect(out).toMatchObject({ text: '先看 再查', skillId: 'sk-refactor', segments })
    expect(out.attachments?.[0]).toMatchObject({ key: 't-seg' })
  })

  it('载入历史数据时剔除已不存在的技能与引用键', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage([fauxText('ok')])])
    const svc = build({ faux, tools: [readonlyTool] })
    const s = svc.createSession()
    await svc.send({
      sessionId: s.id,
      text: '先看',
      attachments: [textAttachment],
      segments: [segments[0]!, segments[1]!, { type: 'skill', id: 'sk-refactor' }],
      skillId: 'sk-refactor'
    })

    const storePath = join(dir, 'ai-sessions.json')
    const store = JSON.parse(readFileSync(storePath, 'utf8')) as {
      sessions: Array<{ messages: Array<Record<string, unknown>> }>
    }
    const user = store.sessions[0]?.messages[0]
    if (!user) throw new Error('unreachable')
    user.segments = [
      { type: 'text', text: '先看 ' },
      { type: 'ref', refType: 'attachment', key: 'ghost' },
      { type: 'skill', id: 'sk-removed-in-new-version' }
    ]
    user.skillIds = ['sk-removed-in-new-version']
    user.skillId = 'sk-removed-in-new-version'
    writeFileSync(storePath, JSON.stringify(store), 'utf8')

    const reloaded = build({ faux: fauxProvider(), tools: [readonlyTool] })
    const msg = reloaded.getMessages(s.id)[0]
    if (msg.role !== 'user') throw new Error('unreachable')
    expect(msg.skillId).toBeUndefined()
    expect(msg.skillIds).toBeUndefined()
    // 只剩文字时没有 ref/skill,分段本身也不再保留
    expect(msg.segments).toBeUndefined()
  })
})
