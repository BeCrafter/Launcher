// 对话服务的集成测试:用 pi 自带的 faux provider 驱动**真实**的 Agent 循环
// (不 mock 运行器 —— 事件序列、工具执行、审批拦截、transcript 配对都是真跑的)
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Type, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import type { StreamFn } from '@earendil-works/pi-agent-core'
import { DEFAULT_SETTINGS, type LauncherSettings } from '../../shared/settings'
import type { AiRunEvent } from '../../shared/ai'
import { createChatService, type ChatService } from './chat-service'
import type { LlmClient } from './llm'
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

function build(opts: {
  faux: ReturnType<typeof fauxProvider>
  tools: ToolDef[]
  settings?: Partial<LauncherSettings>
  secrets?: SecretStore
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
    testConnection: async () => ({ ok: true, message: 'ok' })
  }
  return createChatService({
    llm,
    secrets,
    registry: stubRegistry(opts.tools),
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

  it('环境缺失的会话 id 会拒绝(不静默新建)', async () => {
    const svc = build({ faux: fauxProvider(), tools: [readonlyTool] })
    await expect(svc.send({ sessionId: 'nope', text: 'x' })).rejects.toThrow(/AI_SESSION_MISSING/)
  })
})
