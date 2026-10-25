import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiMessage } from '@shared/ai'
import aiCss from '../../styles/ai.css?raw'
import { AiMessages } from './AiMessages'
import { useAiStore } from '../../state/ai-store'
import { useSettingsNav } from '../../state/settings-nav-store'
import { useUiStore } from '../../state/ui-store'
import {
  makeAssistantMessage,
  makeImageAttachment,
  makeMention,
  makeSession,
  makeSkill,
  makeTextAttachment,
  makeToolResult,
  makeUsage,
  makeUserMessage
} from '../../test/fixtures'
import { mockLauncher } from '../../test/launcher-stub'

function seedMessages(messages: AiMessage[], patch: Partial<ReturnType<typeof useAiStore.getState>> = {}): void {
  useAiStore.setState({
    currentId: 's1',
    sessions: [makeSession()],
    ...patch,
    messages
  })
}

beforeEach(() => {
  useAiStore.setState({
    skills: [makeSkill({ id: 'sk-report', nameKey: 'ai.report.title', descKey: 'ai.cron.title' })]
  })
})

describe('欢迎态', () => {
  it('空消息渲染问候、体检卡与技能卡', () => {
    seedMessages([])
    render(<AiMessages />)

    expect(screen.getByText('有什么可以帮你？')).toBeInTheDocument()
    expect(screen.getByText('一键系统体检')).toBeInTheDocument()
    expect(screen.getByText('系统体检报告')).toBeInTheDocument()
  })

  it('点语言提示跳到设置 › 通用', () => {
    seedMessages([])
    useSettingsNav.setState({ tab: 'ai' })
    render(<AiMessages />)

    fireEvent.click(screen.getByRole('button', { name: /对话语言跟随应用设置/ }))
    expect(useUiStore.getState().module).toBe('settings')
    expect(useSettingsNav.getState().tab).toBe('general')
  })
})

describe('用户消息', () => {
  it('渲染正文、引用与附件', () => {
    seedMessages([
      makeUserMessage({
        id: 'u1',
        blocks: [{ type: 'text', text: '帮我看看这个' }],
        mentions: [makeMention({ label: 'my-agent' })],
        attachments: [makeImageAttachment(), makeTextAttachment({ name: 'notes.txt' })]
      })
    ])
    const { container } = render(<AiMessages />)

    expect(container.querySelector('.ai-msg.user')).not.toBeNull()
    expect(screen.getByText('帮我看看这个')).toBeInTheDocument()
    expect(screen.getByText('my-agent')).toBeInTheDocument()
    expect(screen.getByAltText('pixel.png')).toBeInTheDocument()
    expect(screen.getByText('notes.txt')).toBeInTheDocument()
  })

  it('segments 按发送时的顺序还原文字与引用', () => {
    seedMessages([
      makeUserMessage({
        blocks: [{ type: 'text', text: '前后' }],
        segments: [
          { type: 'text', text: '前' },
          { type: 'ref', refType: 'attachment', key: 'txt1' },
          { type: 'text', text: '后' }
        ],
        attachments: [makeTextAttachment({ key: 'txt1', name: 'a.txt' })]
      })
    ])
    const { container } = render(<AiMessages />)

    expect(container.querySelector('.ai-bubble')?.textContent).toBe('前a.txt后')
  })

  it('trimmed 附件显示清理占位', () => {
    seedMessages([
      makeUserMessage({
        attachments: [makeTextAttachment({ name: 'old.txt', content: '', trimmed: true })]
      })
    ])
    render(<AiMessages />)

    expect(screen.getByText('已清理')).toBeInTheDocument()
  })
})

describe('选择模式与撤回', () => {
  it('勾选切换选中状态并反映 aria-pressed', () => {
    seedMessages([makeUserMessage({ id: 'u1' })])
    useAiStore.setState({ selectionMode: true })
    render(<AiMessages />)

    const check = screen.getByRole('button', { name: '选择这条消息' })
    expect(check).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(check)
    expect(useAiStore.getState().selectedIds).toEqual(['u1'])
    expect(check).toHaveAttribute('aria-pressed', 'true')
  })

  it('用户与助手消息的勾选框结构一致,统一贴整行右侧', () => {
    seedMessages([
      makeUserMessage({ id: 'u1', blocks: [{ type: 'text', text: '短' }] }),
      makeAssistantMessage({ id: 'a1', blocks: [{ type: 'text', text: '回答' }] })
    ])
    useAiStore.setState({ selectionMode: true })
    render(<AiMessages />)

    const checks = screen.getAllByRole('button', { name: '选择这条消息' })
    expect(checks).toHaveLength(2)
    for (const check of checks) {
      // 同一套类名与结构,不做 user/bot 分叉;定位只看行右边缘
      expect(check.className).toBe('ai-msg-check')
      expect(check.getAttribute('style')).toBeNull()
      expect(check.parentElement).toHaveClass('ai-msg')
      expect(check.nextElementSibling?.className).toMatch(/^ai-(bubble|bot-card)$/)
    }

    // CSS 契约:基础规则锚定 right,且不存在按角色改写左右侧的规则
    const base = /\.ai-msg-check\s*\{([^}]*)\}/.exec(aiCss)?.[1] ?? ''
    expect(base).toMatch(/(?:^|\n)\s*right:\s*-?[\d.]+px;/)
    expect(base).not.toMatch(/(?:^|\n)\s*left:/)
    expect(aiCss).not.toMatch(/\.ai-msg\.(?:user|bot)[^{]*\.ai-msg-check/)
  })

  it('internal 消息没有撤回按钮', () => {
    seedMessages([
      makeUserMessage({ id: 'u-internal', internal: true }),
      makeUserMessage({ id: 'u-normal', blocks: [{ type: 'text', text: '普通消息' }] })
    ])
    render(<AiMessages />)

    expect(screen.getAllByRole('button', { name: /撤回并编辑/ })).toHaveLength(1)
  })
})

describe('助手消息', () => {
  it('markdown 渲染与 usage', () => {
    seedMessages([
      makeAssistantMessage({
        blocks: [{ type: 'text', text: '**重点**' }],
        usage: makeUsage({ totalTokens: 1234 })
      })
    ])
    const { container } = render(<AiMessages />)

    expect(container.querySelector('.ai-txt strong')?.textContent).toBe('重点')
    expect(screen.getByText(/1234 tok/)).toBeInTheDocument()
  })

  it.each([
    [makeAssistantMessage({ stopReason: 'aborted' as const }), '已中止生成'],
    [makeAssistantMessage({ stopReason: 'length' as const }), '回复达到长度上限'],
    [
      makeAssistantMessage({ stopReason: 'error' as const, errorMessage: 'boom' }),
      '生成失败:boom'
    ]
  ])('终止原因 notice:%#', (message, expected) => {
    seedMessages([message])
    render(<AiMessages />)
    expect(screen.getByText(new RegExp(expected))).toBeInTheDocument()
  })

  it('toolUse notice 只在最后一条且未运行时出现', () => {
    seedMessages([makeAssistantMessage({ id: 'a1', stopReason: 'toolUse' })])
    const a = render(<AiMessages />)
    expect(screen.getByText(/工具调用上限/)).toBeInTheDocument()
    a.unmount()

    seedMessages([
      makeAssistantMessage({ id: 'a1', stopReason: 'toolUse' }),
      makeAssistantMessage({ id: 'a2', stopReason: 'stop', blocks: [{ type: 'text', text: '继续' }] })
    ])
    const b = render(<AiMessages />)
    expect(screen.queryByText(/工具调用上限/)).not.toBeInTheDocument()
    b.unmount()

    seedMessages([makeAssistantMessage({ id: 'a1', stopReason: 'toolUse' })], {
      runSessionId: 's1',
      runId: 'r1'
    })
    render(<AiMessages />)
    expect(screen.queryByText(/工具调用上限/)).not.toBeInTheDocument()
  })
})

describe('流式态', () => {
  it('运行中 pending 的最后一段文字带 caret', () => {
    seedMessages([makeAssistantMessage({ stopReason: 'pending' })], {
      runSessionId: 's1',
      runId: 'r1'
    })
    const { container } = render(<AiMessages />)
    expect(container.querySelector('.ai-caret')).not.toBeNull()
  })

  it('无活动 run 的 pending 不显示 caret', () => {
    seedMessages([makeAssistantMessage({ stopReason: 'pending' })])
    const { container } = render(<AiMessages />)
    expect(container.querySelector('.ai-caret')).toBeNull()
  })

  it('空块 + 运行中显示「思考中」', () => {
    seedMessages([makeAssistantMessage({ stopReason: 'pending', blocks: [] })], {
      runSessionId: 's1',
      runId: 'r1'
    })
    render(<AiMessages />)
    expect(screen.getByText('思考中…')).toBeInTheDocument()
  })
})

describe('工具步骤', () => {
  it('toolCall 按文本打断分组,配对结果展示输出', () => {
    seedMessages([
      makeAssistantMessage({
        blocks: [
          { type: 'toolCall', id: 't1', name: 'read_plist', label: '读取配置', args: {} },
          { type: 'text', text: '中间说明' },
          { type: 'toolCall', id: 't2', name: 'write_plist', args: {} }
        ]
      }),
      makeToolResult({
        id: 'r1',
        toolCallId: 't1',
        toolName: 'read_plist',
        blocks: [{ type: 'text', text: 'plist 内容' }]
      }),
      makeToolResult({ id: 'r2', toolCallId: 't2', toolName: 'write_plist', blocks: [], durationMs: 3 })
    ])
    const { container } = render(<AiMessages />)

    expect(container.querySelectorAll('.ai-steps')).toHaveLength(2)
    expect(screen.getByText('读取配置')).toBeInTheDocument()
    expect(screen.getByText('write_plist')).toBeInTheDocument()
    expect(screen.getByText('中间说明')).toBeInTheDocument()

    fireEvent.click(screen.getByText('读取配置').closest('.ai-step-hd')!)
    expect(container.querySelector('.ai-step-out.open')?.textContent).toContain('plist 内容')
  })

  it('cardOnly 结果不生成通用步骤,只保留领域卡', () => {
    seedMessages([
      makeAssistantMessage({
        blocks: [{ type: 'toolCall', id: 't1', name: 'prepare_agent', args: {} }]
      }),
      makeToolResult({
        id: 'r1',
        toolCallId: 't1',
        toolName: 'prepare_agent',
        cardOnly: true,
        blocks: [{ type: 'card', card: { kind: 'report', items: [{ level: 'ok', text: '计划已生成' }] } }]
      })
    ])
    const { container } = render(<AiMessages />)

    expect(container.querySelector('.ai-steps')).toBeNull()
    expect(screen.getByText('计划已生成')).toBeInTheDocument()
  })
})

describe('复制与追问', () => {
  it('助手复制按钮写入剪贴板', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    seedMessages([makeAssistantMessage({ blocks: [{ type: 'text', text: '复制我' }] })])
    render(<AiMessages />)

    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('复制我'))
  })

  it('没有可复制正文时复制按钮禁用', () => {
    seedMessages([makeAssistantMessage({ blocks: [] })])
    render(<AiMessages />)
    expect(screen.getByRole('button', { name: '复制' })).toBeDisabled()
  })

  it('suggest 块点击发送;运行中忽略', async () => {
    seedMessages([
      makeAssistantMessage({ blocks: [{ type: 'suggest', items: ['继续排查'] }] })
    ])
    const a = render(<AiMessages />)
    fireEvent.click(screen.getByRole('button', { name: '继续排查' }))
    await waitFor(() => expect(mockLauncher().ai.send).toHaveBeenCalledTimes(1))
    a.unmount()

    seedMessages(
      [makeAssistantMessage({ blocks: [{ type: 'suggest', items: ['继续排查'] }] })],
      { runId: 'r1' }
    )
    render(<AiMessages />)
    fireEvent.click(screen.getByRole('button', { name: '继续排查' }))
    expect(mockLauncher().ai.send).toHaveBeenCalledTimes(1)
  })
})
