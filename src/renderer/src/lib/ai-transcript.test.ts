import { describe, expect, it } from 'vitest'
import type { AiAssistantMessage, AiToolResultMessage, AiUserMessage } from '@shared/ai'
import {
  buildTranscript,
  hasCopyableText,
  messageText,
  selectableIds,
  singleMessageCopy,
  transcriptFileName,
  type TranscriptLabels
} from './ai-transcript'

const labels: TranscriptLabels = {
  user: '用户',
  assistant: '助手',
  completedAt: '完成于',
  duration: '整轮',
  attachments: '附件'
}

const stamp = (h: number, m: number, s: number): number =>
  new Date(2026, 0, 2, h, m, s).getTime()

const userMsg = (id: string, text: string, extra: Partial<AiUserMessage> = {}): AiUserMessage => ({
  role: 'user',
  id,
  blocks: text === '' ? [] : [{ type: 'text', text }],
  timestamp: stamp(3, 4, 5),
  ...extra
})

const assistantMsg = (
  id: string,
  blocks: AiAssistantMessage['blocks'],
  extra: Partial<AiAssistantMessage> = {}
): AiAssistantMessage => ({
  role: 'assistant',
  id,
  blocks,
  stopReason: 'stop',
  timestamp: stamp(3, 4, 5),
  ...extra
})

const toolResult = (id: string): AiToolResultMessage => ({
  role: 'toolResult',
  id,
  toolCallId: 'tc1',
  toolName: 'list_services',
  blocks: [{ type: 'text', text: '工具输出不应进转录' }],
  isError: false,
  status: 'ok',
  durationMs: 5,
  timestamp: stamp(3, 4, 6)
})

describe('messageText', () => {
  it('只拼接 text 块,跳过 thinking/toolCall/card/suggest', () => {
    const m = assistantMsg('a1', [
      { type: 'thinking', thinking: '内部推理' },
      { type: 'text', text: '第一段' },
      { type: 'toolCall', id: 'tc1', name: 'list_services', args: {} },
      { type: 'card', card: { kind: 'report', items: [] } },
      { type: 'suggest', items: ['继续'] },
      { type: 'text', text: '第二段' }
    ])
    expect(messageText(m)).toBe('第一段\n\n第二段')
    expect(hasCopyableText(m)).toBe(true)
  })

  it('只有 thinking 时没有可复制文本', () => {
    const m = assistantMsg('a1', [{ type: 'thinking', thinking: '推理' }])
    expect(messageText(m)).toBe('')
    expect(hasCopyableText(m)).toBe(false)
  })

  it('toolResult 不产生文本', () => {
    expect(messageText(toolResult('tr1'))).toBe('')
  })
})

describe('selectableIds', () => {
  it('只包含用户消息与助手消息', () => {
    const ids = selectableIds([userMsg('u1', 'hi'), assistantMsg('a1', []), toolResult('tr1')])
    expect(ids).toEqual(['u1', 'a1'])
  })
})

describe('buildTranscript', () => {
  const messages = [
    userMsg('u1', '看一下服务', {
      mentions: [{ key: 'agent:1', type: 'agent', id: 'com.foo', label: 'com.foo', scope: 'user' }],
      attachments: [
        { type: 'text', key: 't1', name: 'notes.md', content: '内部正文', bytes: 12 },
        { type: 'image', key: 'i1', name: 'shot.png', mimeType: 'image/png', data: 'AAAA' }
      ]
    }),
    assistantMsg(
      'a1',
      [
        { type: 'thinking', thinking: '推理' },
        { type: 'toolCall', id: 'tc1', name: 'list_services', args: {} },
        { type: 'text', text: '服务正常' }
      ],
      { finishedAt: stamp(3, 4, 6), durationMs: 2000 }
    ),
    toolResult('tr1'),
    assistantMsg('a2', [{ type: 'text', text: '补充一句' }], { finishedAt: stamp(3, 4, 7) })
  ]

  it('按原消息顺序输出 Markdown,并带完成时间、整轮耗时与附件名', () => {
    expect(buildTranscript(messages, ['a1', 'u1'], labels)).toBe(
      [
        '## 用户 · 03:04:05',
        '附件: notes.md, shot.png',
        '看一下服务',
        '## 助手 · 完成于 03:04:06 · 整轮 2.0s',
        '服务正常'
      ].join('\n\n')
    )
  })

  it('未选中的消息不出现,toolResult 永不出现', () => {
    const text = buildTranscript(messages, ['a2'], labels)
    expect(text).toContain('补充一句')
    expect(text).not.toContain('看一下服务')
    expect(text).not.toContain('服务正常')
    expect(text).not.toContain('工具输出')
  })

  it('重复 id 只输出一次,空选择返回空串', () => {
    expect(buildTranscript(messages, ['a2', 'a2'], labels).match(/补充一句/g)).toHaveLength(1)
    expect(buildTranscript(messages, [], labels)).toBe('')
  })

  it('只有附件没有正文的用户消息也保留', () => {
    const onlyFile = userMsg('u2', '', {
      attachments: [{ type: 'text', key: 't2', name: 'a.log', content: 'x', bytes: 1 }]
    })
    const text = buildTranscript([onlyFile], ['u2'], labels)
    expect(text).toContain('## 用户')
    expect(text).toContain('附件: a.log')
  })

  it('没有文本也没有附件的消息被跳过', () => {
    const empty = assistantMsg('a3', [{ type: 'thinking', thinking: 'x' }])
    expect(buildTranscript([empty], ['a3'], labels)).toBe('')
  })
})

describe('singleMessageCopy', () => {
  it('助手只复制正文', () => {
    const m = assistantMsg('a1', [
      { type: 'thinking', thinking: 'x' },
      { type: 'text', text: '结论' },
      { type: 'card', card: { kind: 'report', items: [] } }
    ])
    expect(singleMessageCopy(m, labels)).toBe('结论')
  })

  it('用户消息带附件文件名,不展开附件正文', () => {
    const m = userMsg('u1', '看看', {
      attachments: [{ type: 'text', key: 't1', name: 'a.md', content: '秘密', bytes: 6 }]
    })
    expect(singleMessageCopy(m, labels)).toBe('附件: a.md\n\n看看')
    expect(singleMessageCopy(m, labels)).not.toContain('秘密')
  })
})

describe('transcriptFileName', () => {
  it('按本地时间生成 launcher-ai-YYYYMMDD-HHmm.md', () => {
    expect(transcriptFileName(new Date(2026, 9, 25, 9, 7, 30))).toBe(
      'launcher-ai-20261025-0907.md'
    )
  })
})
