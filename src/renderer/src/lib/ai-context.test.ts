import { describe, expect, it } from 'vitest'
import type {
  AiAssistantMessage,
  AiAttachment,
  AiMessage,
  AiMention,
  AiUsage,
  AiUserMessage
} from '@shared/ai'
import {
  IMAGE_TOKEN_ESTIMATE,
  contextBreakdown,
  contextPercentLabel,
  contextRatio,
  draftBreakdown,
  estimateDraftTokens,
  estimateMessageTokens,
  estimateTokens,
  formatTokenCount,
  usageBaseBreakdown,
  usageBaseTokens
} from './ai-context'

const user = (id: string, text: string, extra: Partial<AiUserMessage> = {}): AiUserMessage => ({
  role: 'user',
  id,
  blocks: text === '' ? [] : [{ type: 'text', text }],
  timestamp: 0,
  ...extra
})

const assistant = (
  id: string,
  text: string,
  usage?: Partial<AiUsage>
): AiAssistantMessage => ({
  role: 'assistant',
  id,
  blocks: text === '' ? [] : [{ type: 'text', text }],
  stopReason: 'stop',
  timestamp: 0,
  ...(usage
    ? {
        usage: {
          input: usage.input ?? usage.totalTokens ?? 0,
          output: usage.output ?? 0,
          cacheRead: usage.cacheRead ?? 0,
          cacheWrite: usage.cacheWrite ?? 0,
          totalTokens: usage.totalTokens ?? 0
        }
      }
    : {})
})

describe('estimateTokens', () => {
  it('CJK 约一字一 token,拉丁按四字符一 token', () => {
    expect(estimateTokens('你好世界')).toBe(4)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('')).toBe(0)
  })

  it('中英混排分别计算', () => {
    expect(estimateTokens('你好 abcd')).toBe(4)
  })
})

describe('usageBaseTokens', () => {
  it('没有带 usage 的助手消息时返回 0,不假装知道系统提示词大小', () => {
    expect(usageBaseTokens([user('u1', '你好')])).toBe(0)
    expect(usageBaseTokens([assistant('a1', '回复')])).toBe(0)
  })

  it('以最近一次 usage 为锚点,只叠加它之后的消息', () => {
    const msgs: AiMessage[] = [
      user('u1', '第一轮'),
      assistant('a1', '回复', { totalTokens: 1000 }),
      user('u2', 'abcd'),
      assistant('a2', '后续回复', { totalTokens: 2000 }),
      user('u3', 'abcd')
    ]
    // 锚点是 a2(2000),它前面的 a1/user2 已经包含在服务端读数里
    expect(usageBaseTokens(msgs)).toBe(2001)
  })

  it('工具结果与图片附件按估算叠加', () => {
    const msgs: AiMessage[] = [
      assistant('a1', '', { totalTokens: 500 }),
      {
        role: 'toolResult',
        id: 'tr1',
        toolCallId: 'tc1',
        toolName: 'list_services',
        blocks: [{ type: 'text', text: 'abcd' }],
        isError: false,
        status: 'ok',
        durationMs: 5,
        timestamp: 0
      }
    ]
    expect(usageBaseTokens(msgs)).toBe(501)
  })
})

describe('usageBaseBreakdown', () => {
  it('锚点取最近一次 usage,之后新增的消息单独计数', () => {
    const msgs: AiMessage[] = [
      user('u1', '第一轮'),
      assistant('a1', '回复', { totalTokens: 1000 }),
      user('u2', 'abcd'),
      assistant('a2', '后续回复', { totalTokens: 2000, input: 1800, output: 200 }),
      user('u3', 'abcd')
    ]
    const b = usageBaseBreakdown(msgs)
    expect(b.anchorIndex).toBe(3)
    expect(b.anchorTokens).toBe(2000)
    expect(b.anchorUsage).toMatchObject({ input: 1800, output: 200, totalTokens: 2000 })
    expect(b.trailingCount).toBe(1)
    expect(b.trailingTokens).toBe(1)
    expect(b.baseTokens).toBe(2001)
    expect(b.unanchoredMessageCount).toBe(0)
    expect(usageBaseTokens(msgs)).toBe(b.baseTokens)
  })

  it('锚点在最后一条时没有之后新增', () => {
    const b = usageBaseBreakdown([
      user('u1', ''),
      assistant('a1', '回复', { totalTokens: 500 })
    ])
    expect(b.anchorIndex).toBe(1)
    expect(b.trailingCount).toBe(0)
    expect(b.baseTokens).toBe(500)
  })

  it('totalTokens === 0 的助手消息不会顶掉锚点,只作为之后新增估算', () => {
    const b = usageBaseBreakdown([
      assistant('a1', '', { totalTokens: 500 }),
      assistant('a2', 'abcd', { totalTokens: 0 })
    ])
    expect(b.anchorIndex).toBe(0)
    expect(b.trailingCount).toBe(1)
    expect(b.trailingTokens).toBe(1)
    expect(b.baseTokens).toBe(501)
  })

  it('无锚点但有历史消息时,基数仍为 0,并给出未覆盖的消息数', () => {
    const msgs: AiMessage[] = [user('u1', 'abcd'), assistant('a1', '回复')]
    const b = usageBaseBreakdown(msgs)
    expect(b.anchorIndex).toBe(-1)
    expect(b.baseTokens).toBe(0)
    expect(b.trailingCount).toBe(0)
    expect(b.unanchoredMessageCount).toBe(2)
    expect(usageBaseTokens(msgs)).toBe(0)
  })
})

describe('estimateMessageTokens', () => {
  it('图片按固定量估算,文本附件按正文估算', () => {
    const image: AiAttachment = {
      type: 'image',
      key: 'i1',
      name: 'a.png',
      mimeType: 'image/png',
      data: 'AAAA'
    }
    const text: AiAttachment = {
      type: 'text',
      key: 't1',
      name: 'a.md',
      content: 'abcd',
      bytes: 4
    }
    const m = user('u1', 'abcd', { attachments: [image, text] })
    expect(estimateMessageTokens(m)).toBe(1 + IMAGE_TOKEN_ESTIMATE + 1 + 12)
  })

  it('trimmed 图片只按占位说明估算', () => {
    const image: AiAttachment = {
      type: 'image',
      key: 'i1',
      name: 'a.png',
      mimeType: 'image/png',
      data: '',
      trimmed: true
    }
    expect(estimateMessageTokens(user('u1', '', { attachments: [image] }))).toBe(4)
  })
})

describe('estimateDraftTokens', () => {
  it('草稿 = 文字 + 附件 + 引用标签', () => {
    const mention: AiMention = {
      key: 'note:a',
      type: 'note',
      id: 'a',
      label: 'abcd'
    }
    const textAttachment: AiAttachment = {
      type: 'text',
      key: 't1',
      name: 'a.md',
      content: 'abcd',
      bytes: 4
    }
    expect(estimateDraftTokens('abcd', [textAttachment], [mention])).toBe(1 + 1 + 12 + 12 + 1)
  })

  it('空草稿为 0', () => {
    expect(estimateDraftTokens('', [], [])).toBe(0)
  })
})

describe('draftBreakdown', () => {
  it('文字/文本附件/图片/引用分别计数,总量与 estimateDraftTokens 一致', () => {
    const image: AiAttachment = {
      type: 'image',
      key: 'i1',
      name: 'a.png',
      mimeType: 'image/png',
      data: 'AAAA'
    }
    const textAtt: AiAttachment = {
      type: 'text',
      key: 't1',
      name: 'a.md',
      content: 'abcd',
      bytes: 4
    }
    const mention: AiMention = { key: 'note:a', type: 'note', id: 'a', label: 'abcd' }
    const quoted: AiMention = {
      key: 'note:b',
      type: 'note',
      id: 'b',
      label: 'abcd',
      quote: '你好'
    }
    const b = draftBreakdown('abcd', [image, textAtt], [mention, quoted])
    expect(b.textTokens).toBe(1)
    expect(b.attachmentTokens).toBe(IMAGE_TOKEN_ESTIMATE + 1 + 12)
    expect(b.mentionTokens).toBe(12 + 1 + (12 + 1 + 2))
    expect(b.draftTokens).toBe(b.textTokens + b.attachmentTokens + b.mentionTokens)
    expect(b.chars).toBe(4)
    expect(b.attachmentCount).toBe(2)
    expect(b.textCount).toBe(1)
    expect(b.imageCount).toBe(1)
    expect(b.mentionCount).toBe(2)
    expect(b.quotedMentionCount).toBe(1)
    expect(estimateDraftTokens('abcd', [image, textAtt], [mention, quoted])).toBe(b.draftTokens)
  })

  it('trimmed 图片按占位 4 计,空草稿全为 0', () => {
    const trimmed: AiAttachment = {
      type: 'image',
      key: 'i1',
      name: 'a.png',
      mimeType: 'image/png',
      data: '',
      trimmed: true
    }
    const b = draftBreakdown('', [trimmed], [])
    expect(b.imageCount).toBe(1)
    expect(b.attachmentTokens).toBe(4)
    expect(b.draftTokens).toBe(4)
    expect(draftBreakdown('', [], [])).toMatchObject({
      draftTokens: 0,
      chars: 0,
      attachmentCount: 0,
      mentionCount: 0
    })
  })
})

describe('contextBreakdown', () => {
  it('used = 锚点 + 之后新增 + 草稿,remaining/rawRatio 正确', () => {
    const msgs: AiMessage[] = [
      user('u1', '第一轮'),
      assistant('a1', '回复', { totalTokens: 1000 }),
      user('u2', 'abcd')
    ]
    const b = contextBreakdown(msgs, 'abcd', [], [], 2004)
    expect(b.used).toBe(1002)
    expect(b.rawRatio).toBeCloseTo(0.5, 5)
    expect(b.remaining).toBe(1002)
    expect(b.overBy).toBe(0)
    expect(b.pctLabel).toBe('50%')
  })

  it('恰好到上限 / 超限 / 非法上限', () => {
    const msgs: AiMessage[] = [assistant('a1', '', { totalTokens: 1000 })]
    const at = contextBreakdown(msgs, '', [], [], 1000)
    expect(at.remaining).toBe(0)
    expect(at.overBy).toBe(0)
    expect(at.pctLabel).toBe('100%')

    const over = contextBreakdown(msgs, 'abcd', [], [], 1000)
    expect(over.used).toBe(1001)
    expect(over.rawRatio).toBeGreaterThan(1)
    expect(over.remaining).toBe(0)
    expect(over.overBy).toBe(1)
    expect(over.pctLabel).toBe('>100%')

    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const b = contextBreakdown(msgs, '', [], [], bad)
      expect(b.rawRatio).toBe(0)
      expect(b.remaining).toBe(0)
      expect(b.overBy).toBe(0)
      expect(b.pctLabel).toBe('0%')
    }
  })

  it('无锚点但已有消息:基数 0,历史条数单独给出', () => {
    const b = contextBreakdown([user('u1', 'abcd')], 'abcd', [], [], 1000)
    expect(b.anchorIndex).toBe(-1)
    expect(b.baseTokens).toBe(0)
    expect(b.unanchoredMessageCount).toBe(1)
    expect(b.used).toBe(1)
    expect(b.remaining).toBe(999)
    expect(b.pctLabel).toBe('<1%')
  })
})

describe('contextPercentLabel', () => {
  it('0 / <1% / 99% / 100% / >100%,非法上限回落 0%', () => {
    expect(contextPercentLabel(0, 1000)).toBe('0%')
    expect(contextPercentLabel(-1, 1000)).toBe('0%')
    expect(contextPercentLabel(1, 1000)).toBe('<1%')
    expect(contextPercentLabel(990, 1000)).toBe('99%')
    expect(contextPercentLabel(1000, 1000)).toBe('100%')
    expect(contextPercentLabel(1001, 1000)).toBe('>100%')
    expect(contextPercentLabel(10, 0)).toBe('0%')
    expect(contextPercentLabel(10, Number.NaN)).toBe('0%')
    expect(contextPercentLabel(10, Number.POSITIVE_INFINITY)).toBe('0%')
  })
})

describe('contextRatio / formatTokenCount', () => {
  it('比例钳在 0..1,窗口非法时返回 0', () => {
    expect(contextRatio(500, 1000)).toBe(0.5)
    expect(contextRatio(2000, 1000)).toBe(1)
    expect(contextRatio(-1, 1000)).toBe(0)
    expect(contextRatio(10, 0)).toBe(0)
    expect(contextRatio(10, Number.NaN)).toBe(0)
  })

  it('token 数按量级缩写', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(1500)).toBe('1.5k')
    expect(formatTokenCount(2000)).toBe('2k')
    expect(formatTokenCount(128_000)).toBe('128k')
    expect(formatTokenCount(1_000_000)).toBe('1M')
  })
})
