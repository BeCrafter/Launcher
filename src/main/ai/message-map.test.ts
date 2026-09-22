// 消息映射的回归:这一层错了会以「端点 400 + 难懂报错」的形式在真机上暴露,
// 而单测能把它钉死在本地(尤其是中断后半截 transcript 的补全)
import { describe, expect, it } from 'vitest'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { AiAssistantMessage, AiMessage, AiToolResultMessage, AiUserMessage } from '../../shared/ai'
import { fromPiContent, fromPiToolResult, fromPiUsage, toPiMessages } from './message-map'

const userMsg = (text: string): AiUserMessage => ({
  role: 'user',
  id: 'u1',
  blocks: [{ type: 'text', text }],
  timestamp: 1
})

const assistant = (blocks: AiAssistantMessage['blocks'], extra: Partial<AiAssistantMessage> = {}): AiAssistantMessage => ({
  role: 'assistant',
  id: 'a1',
  blocks,
  stopReason: 'toolUse',
  model: 'claude-opus-5',
  provider: 'anthropic',
  timestamp: 2,
  ...extra
})

const toolResult = (toolCallId: string, isError = false): AiToolResultMessage => ({
  role: 'toolResult',
  id: 'tr1',
  toolCallId,
  toolName: 'list_services',
  blocks: [{ type: 'text', text: 'ok' }],
  isError,
  status: isError ? 'err' : 'ok',
  durationMs: 5,
  timestamp: 3
})

describe('toPiMessages', () => {
  it('用户消息与助手文本按序映射', () => {
    const msgs: AiMessage[] = [userMsg('你好'), assistant([{ type: 'text', text: '在的' }], { stopReason: 'stop' })]
    const out = toPiMessages(msgs)
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect((out[0] as { content: string }).content).toBe('你好')
  })

  it('@引用作为上下文行前置给模型,但不进 blocks 本身', () => {
    const m: AiUserMessage = {
      ...userMsg('它怎么挂了'),
      mentions: [{ key: 'agent:1', type: 'agent', id: 'user:com.foo', label: 'com.foo', scope: 'user' }]
    }
    const out = toPiMessages([m])
    expect((out[0] as { content: string }).content).toContain('[用户引用了本机任务')
    expect((out[0] as { content: string }).content).toContain('com.foo')
    expect((out[0] as { content: string }).content).toContain('LaunchAgent · user')
    expect(m.blocks).toHaveLength(1) // 引用不污染落库的消息内容
  })

  it('cron 引用不带作用域后缀', () => {
    const m: AiUserMessage = {
      ...userMsg('x'),
      mentions: [{ key: 'cron:1', type: 'cron', id: 'c1', label: '每日备份' }]
    }
    expect((toPiMessages([m])[0] as { content: string }).content).toContain('每日备份（定时任务）')
  })

  it('已配对的 toolCall 不会被重复补合成结果', () => {
    const msgs: AiMessage[] = [
      userMsg('查一下'),
      assistant([{ type: 'toolCall', id: 'tc1', name: 'list_services', args: {} }]),
      toolResult('tc1')
    ]
    const out = toPiMessages(msgs)
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'toolResult'])
    // 合成结果会以 isError 的形式出现;这里必须是真实结果,数量为 1
    expect(out).toHaveLength(3)
    expect((out[2] as { isError: boolean }).isError).toBe(false)
  })

  it('中断留下的半截 toolCall 会被补上合成结果(否则下一轮必 400)', () => {
    const msgs: AiMessage[] = [
      userMsg('查一下'),
      assistant([{ type: 'text', text: '我先看看' }, { type: 'toolCall', id: 'tc9', name: 'tail_log', args: {} }])
    ]
    const out = toPiMessages(msgs)
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'toolResult'])
    const tr = out[2] as { toolCallId: string; isError: boolean; content: { text: string }[] }
    expect(tr.toolCallId).toBe('tc9')
    expect(tr.isError).toBe(true)
    expect(tr.content[0].text).toContain('中断')
  })

  it('同一轮里多个 toolCall 各自补齐', () => {
    const msgs: AiMessage[] = [
      userMsg('x'),
      assistant([
        { type: 'toolCall', id: 'a', name: 't1', args: {} },
        { type: 'toolCall', id: 'b', name: 't2', args: {} }
      ])
    ]
    const out = toPiMessages(msgs)
    expect(out.filter((m) => m.role === 'toolResult')).toHaveLength(2)
  })

  it('工具结果先于助手消息出现时也算已应答(顺序无关)', () => {
    // 真实顺序里 result 在 assistant 之后,这里刻意反过来验证 answered 是全局收集的
    const msgs: AiMessage[] = [
      userMsg('x'),
      toolResult('tc1'),
      assistant([{ type: 'toolCall', id: 'tc1', name: 'list_services', args: {} }])
    ]
    const out = toPiMessages(msgs)
    expect(out.filter((m) => m.role === 'toolResult')).toHaveLength(1)
  })

  it('thinking 的签名与 redacted 标记被保真回传', () => {
    const msgs: AiMessage[] = [
      userMsg('x'),
      assistant(
        [
          { type: 'thinking', thinking: '推理', thinkingSignature: 'sig-1' },
          { type: 'thinking', thinking: '', redacted: true, thinkingSignature: 'sig-redacted' },
          { type: 'text', text: '结论' }
        ],
        { stopReason: 'stop' }
      )
    ]
    const content = (toPiMessages(msgs)[1] as AssistantMessage).content
    const thinking = content.filter((c) => c.type === 'thinking')
    // 空正文但带密文的 redacted 块必须保留 —— 丢了会破坏多轮推理连续性
    expect(thinking).toHaveLength(2)
    expect(thinking[0]).toMatchObject({ thinkingSignature: 'sig-1' })
    expect(thinking[1]).toMatchObject({ redacted: true, thinkingSignature: 'sig-redacted' })
  })

  it('空白文本块不进 transcript(省 token 且避免空 content 报错)', () => {
    const msgs: AiMessage[] = [userMsg('x'), assistant([{ type: 'text', text: '   ' }], { stopReason: 'stop' })]
    const out = toPiMessages(msgs)
    // 内容全空且没有 errorMessage 时整条助手消息被略过
    expect(out).toHaveLength(1)
  })

  it('带 errorMessage 的空助手消息保留(模型需要知道上一轮失败了)', () => {
    const withErr = assistant([], { stopReason: 'error', errorMessage: 'boom' })
    const out = toPiMessages([userMsg('x'), withErr])
    expect(out).toHaveLength(2)
    expect((out[1] as { errorMessage?: string }).errorMessage).toBe('boom')
  })

  it('card / suggest 扩展块不进模型上下文', () => {
    const msgs: AiMessage[] = [
      userMsg('x'),
      assistant([
        { type: 'text', text: '看报告' },
        { type: 'card', card: { kind: 'report', items: [{ level: 'ok', text: 'fine' }] } },
        { type: 'suggest', items: ['再来一次'] }
      ], { stopReason: 'stop' })
    ]
    const content = (toPiMessages(msgs)[1] as AssistantMessage).content
    expect(content.map((c) => c.type)).toEqual(['text'])
  })

  it('未知/缺失 provider 回退到 anthropic-messages(stopReason=pending 归一为 stop)', () => {
    const m = assistant([{ type: 'text', text: 'hi' }], { stopReason: 'pending', provider: undefined })
    const out = toPiMessages([m])[0] as AssistantMessage
    expect(out.api).toBe('anthropic-messages')
    expect(out.stopReason).toBe('stop')
  })

  it('openai-compatible 的历史消息按原协议标注', () => {
    const m = assistant([{ type: 'text', text: 'hi' }], { provider: 'openai-compatible' })
    const out = toPiMessages([m])[0] as AssistantMessage
    expect(out.api).toBe('openai-completions')
    expect(out.provider).toBe('openai-compatible')
  })
})

describe('fromPi*', () => {
  it('fromPiContent 保留 thinking 签名并丢弃空文本块', () => {
    const blocks = fromPiContent([
      { type: 'text', text: '' },
      { type: 'thinking', thinking: 't', thinkingSignature: 's' },
      { type: 'text', text: '正文' },
      { type: 'toolCall', id: 'x', name: 'list_services', arguments: { a: 1 } }
    ] as AssistantMessage['content'])
    expect(blocks.map((b) => b.type)).toEqual(['thinking', 'text', 'toolCall'])
    expect(blocks[0]).toMatchObject({ thinkingSignature: 's' })
    expect(blocks[2]).toMatchObject({ args: { a: 1 } })
  })

  it('fromPiToolResult 把 isError 映射成 err,中断提示映射成 warn', () => {
    const mk = (text: string, isError: boolean) =>
      fromPiToolResult(
        {
          role: 'toolResult',
          toolCallId: 'tc',
          toolName: 'list_services',
          content: [{ type: 'text', text }],
          isError,
          timestamp: 1
        } as never,
        { durationMs: 10 }
      )
    expect(mk('ok', false).status).toBe('ok')
    expect(mk('boom', true).status).toBe('err')
    expect(mk('（本轮已中断，该调用未执行）', true).status).toBe('warn')
  })

  it('fromPiUsage 缺失时返回 null,存在时补全 cost', () => {
    expect(fromPiUsage(undefined)).toBeNull()
    const u = fromPiUsage({
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 }
    } as AssistantMessage['usage'])
    expect(u).toMatchObject({ totalTokens: 3, cost: { total: 0.3 } })
  })
})
