// 混合引用的顺序:界面里图片、文本文件、@ 引用可以交替添加。
// order 是跨类别的唯一顺序来源;这里钉住「模型看到的总顺序」与「各类正文仍在」。
import { describe, expect, it } from 'vitest'
import type { AiUserMessage } from '../../shared/ai'
import { userMessageContext } from './user-context'

function userMsg(patch: Partial<AiUserMessage> = {}): AiUserMessage {
  return {
    role: 'user',
    id: 'u1',
    timestamp: 1,
    blocks: [{ type: 'text', text: '按顺序看' }],
    ...patch
  }
}

describe('userMessageContext 混合引用顺序', () => {
  it('引用与附件按共用的 order 输出一行总顺序', () => {
    const m = userMsg({
      mentions: [
        { key: 'agent:x', type: 'agent', id: 'x', label: 'X', order: 10 },
        { key: 'note:a', type: 'note', id: 'a', label: 'A', order: 30 }
      ],
      attachments: [
        { type: 'text', key: 'f1', name: 'b.md', content: 'b', bytes: 1, order: 20 }
      ]
    })
    const text = userMessageContext(m, new Map())
    expect(text).toContain('[本条消息的引用顺序：任务「X」 → 文件「b.md」 → 笔记「A」]')
    // 总顺序行不能替代各类正文
    expect(text).toContain('本机任务：X')
    expect(text).toContain('文本文件：b.md')
    expect(text).toContain('按顺序看')
  })

  it('只有一类引用时不写总顺序行(类别内数组顺序已经代表添加顺序)', () => {
    const onlyFiles = userMessageContext(
      userMsg({
        attachments: [
          { type: 'text', key: 'f1', name: 'a.md', content: 'a', bytes: 1, order: 0 }
        ]
      }),
      new Map()
    )
    expect(onlyFiles).not.toContain('引用顺序')
    const onlyMentions = userMessageContext(
      userMsg({ mentions: [{ key: 'agent:x', type: 'agent', id: 'x', label: 'X', order: 0 }] }),
      new Map()
    )
    expect(onlyMentions).not.toContain('引用顺序')
  })

  it('旧数据没有 order 时按旧版视觉顺序:附件在前、引用在后', () => {
    const text = userMessageContext(
      userMsg({
        mentions: [{ key: 'note:a', type: 'note', id: 'a', label: 'A' }],
        attachments: [{ type: 'text', key: 'f1', name: 'b.md', content: 'b', bytes: 1 }]
      }),
      new Map()
    )
    expect(text).toContain('引用顺序：文件「b.md」 → 笔记「A」')
  })
})

describe('userMessageContext 空文本兜底', () => {
  it('纯技能发送必须给模型一个非空 user turn(Anthropic 会丢弃空 user 消息)', () => {
    const text = userMessageContext(
      userMsg({ blocks: [{ type: 'text', text: '' }], skillIds: ['sk-plist'], skillId: 'sk-plist' }),
      new Map()
    )
    expect(text.trim()).not.toBe('')
    expect(text).toContain('技能')
  })

  it('完全空的历史脏数据也不返回空串', () => {
    const text = userMessageContext(userMsg({ blocks: [{ type: 'text', text: '' }] }), new Map())
    expect(text.trim()).not.toBe('')
  })
})
