import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiApproveCard, AiDomainCard } from '@shared/ai'
import { AiCard, AiSuggest } from './AiCards'
import { confirmDangerous } from '../../lib/elevation'
import { useAiStore } from '../../state/ai-store'
import { useUiStore } from '../../state/ui-store'
import { renderWithSettings } from '../../test/render'
import { makeSession } from '../../test/fixtures'
import { mockLauncher } from '../../test/launcher-stub'

function renderCard(card: AiDomainCard, pendingToolCallId: string | null = null): ReturnType<typeof render> {
  return render(<AiCard card={card} pendingToolCallId={pendingToolCallId} />)
}

function seedApproval(runId = 'r1', toolCallId = 't1', toolName = 'write_plist'): void {
  useAiStore.setState({
    pendingApprovals: { [toolCallId]: { runId, sessionId: 's1', toolName } },
    sessions: [makeSession()]
  })
}

function approveCard(patch: Partial<AiApproveCard> = {}): AiApproveCard {
  return {
    kind: 'approve',
    tool: 'write_plist',
    toolCallId: 't1',
    detail: '写入 ~/Library/LaunchAgents/com.test.plist',
    command: 'launchctl load com.test.plist',
    state: 'pending',
    ...patch
  }
}

describe('report 卡', () => {
  it('渲染三档行,并支持前往处理', async () => {
    renderCard({
      kind: 'report',
      items: [
        { level: 'ok', text: '一切正常' },
        { level: 'warn', text: '有 2 个服务未运行', goto: 'services' },
        { level: 'err', text: 'cron 不可读' }
      ]
    })

    expect(screen.getByText('一切正常').closest('.ai-report-item')).toHaveClass('ok')
    expect(screen.getByText('有 2 个服务未运行').closest('.ai-report-item')).toHaveClass('warn')
    expect(screen.getByText('cron 不可读').closest('.ai-report-item')).toHaveClass('err')

    fireEvent.click(screen.getByRole('button', { name: /前往处理/ }))
    expect(useUiStore.getState().module).toBe('services')
  })
})

describe('cron 卡', () => {
  it('展示命令、表达式与中文解析', () => {
    renderCard({ kind: 'cron', cmd: 'echo hi', expr: '0 9 * * *' })
    expect(screen.getByText('echo hi')).toBeInTheDocument()
    expect(screen.getByText('0 9 * * *')).toBeInTheDocument()
    expect(screen.getByText('每天 9:00 执行')).toBeInTheDocument()
  })

  it('英文设置下解析文案跟随语言', () => {
    renderWithSettings(<AiCard card={{ kind: 'cron', cmd: 'echo hi', expr: '0 9 * * *' }} pendingToolCallId={null} />, {
      language: 'en-US'
    })
    expect(screen.getByText('Runs daily at 9:00')).toBeInTheDocument()
  })
})

describe('plist 卡', () => {
  it('展示 XML 与路径,复制写入剪贴板并弹 toast', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    renderCard({ kind: 'plist', path: '/tmp/com.test.plist', xml: '<plist>ok</plist>' })

    expect(screen.getByText('/tmp/com.test.plist')).toBeInTheDocument()
    expect(screen.getByText('<plist>ok</plist>')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /复制/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('<plist>ok</plist>'))
    await waitFor(() => expect(useUiStore.getState().toast?.msg).toBe('XML 已复制'))
  })

  it('打开按钮切到 agents 模块', () => {
    useUiStore.setState({ module: 'notes' })
    renderCard({ kind: 'plist', xml: '<plist />' })

    fireEvent.click(screen.getByRole('button', { name: /在编辑器中打开/ }))
    expect(useUiStore.getState().module).toBe('agents')
  })
})

describe('agentPreparation 卡', () => {
  it('ready:展示目标、命令、触发条件、日志与三类清单', () => {
    renderCard({
      kind: 'agentPreparation',
      readiness: 'ready',
      label: 'com.test.job',
      scope: 'user',
      command: '/usr/bin/true',
      trigger: '每天 09:00',
      logs: ['/tmp/job.log'],
      port: { value: 8080, state: 'free', detail: '可用' },
      risks: ['会后台常驻'],
      questions: ['需要开机启动吗'],
      verification: ['launchctl list | grep com.test.job']
    })

    expect(screen.getByText('com.test.job')).toBeInTheDocument()
    expect(screen.getByText('/usr/bin/true')).toBeInTheDocument()
    expect(screen.getByText('每天 09:00')).toBeInTheDocument()
    expect(screen.getByText('/tmp/job.log')).toBeInTheDocument()
    expect(screen.getByText('8080 · 可用')).toBeInTheDocument()
    expect(screen.getByText('会后台常驻')).toBeInTheDocument()
    expect(screen.getByText('需要开机启动吗')).toBeInTheDocument()
    expect(screen.getByText('launchctl list | grep com.test.job')).toBeInTheDocument()
    expect(screen.getByText('可准备草稿')).toBeInTheDocument()
    expect(document.querySelector('.ai-plan')).not.toHaveClass('blocked')
  })

  it('blocked:标记状态、空日志显示「未配置」', () => {
    renderCard({
      kind: 'agentPreparation',
      readiness: 'blocked',
      label: 'com.test.job',
      scope: 'system',
      command: '/usr/bin/false',
      trigger: '手动',
      logs: [],
      risks: [],
      questions: [],
      verification: []
    })

    expect(screen.getByText('未配置')).toBeInTheDocument()
    expect(screen.getByText('需要先处理')).toBeInTheDocument()
    expect(document.querySelector('.ai-plan')).toHaveClass('blocked')
  })

  it('未知 kind 返回 null', () => {
    const weird = { kind: 'mystery' } as unknown as AiDomainCard
    const { container } = renderCard(weird)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('approve 卡', () => {
  it('没有配对的 toolCallId 时所有按钮禁用', () => {
    seedApproval()
    renderCard(approveCard(), null)

    for (const name of [/授权执行/, /本会话允许普通写入/, /取消/]) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
  })

  it('授权 / 本会话允许 / 取消分别回传决策', async () => {
    const stub = mockLauncher()
    seedApproval()

    const a = renderCard(approveCard(), 't1')
    fireEvent.click(screen.getByRole('button', { name: /授权执行/ }))
    await waitFor(() =>
      expect(stub.ai.respondApproval).toHaveBeenCalledWith({
        runId: 'r1',
        toolCallId: 't1',
        decision: 'approve'
      })
    )
    // 应答后待处理表立刻清空,卡片不会重复提交
    expect(useAiStore.getState().pendingApprovals).toEqual({})
    a.unmount()

    seedApproval()
    const b = renderCard(approveCard(), 't1')
    fireEvent.click(screen.getByRole('button', { name: /本会话允许普通写入/ }))
    await waitFor(() =>
      expect(stub.ai.respondApproval).toHaveBeenLastCalledWith({
        runId: 'r1',
        toolCallId: 't1',
        decision: 'approve',
        rememberSession: true
      })
    )
    b.unmount()

    seedApproval()
    renderCard(approveCard(), 't1')
    fireEvent.click(screen.getByRole('button', { name: /取消/ }))
    await waitFor(() =>
      expect(stub.ai.respondApproval).toHaveBeenLastCalledWith({
        runId: 'r1',
        toolCallId: 't1',
        decision: 'cancel'
      })
    )
  })

  it('危险操作先走二次确认:取消不发 IPC,确认后才发', async () => {
    const stub = mockLauncher()
    seedApproval()
    renderCard(approveCard({ dangerous: true }), 't1')

    // 危险卡不提供「本会话允许」
    expect(screen.queryByRole('button', { name: /本会话允许普通写入/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /授权执行/ }))
    expect(stub.ai.respondApproval).not.toHaveBeenCalled()

    await act(async () => {
      confirmDangerous.cancel()
    })
    expect(stub.ai.respondApproval).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /授权执行/ }))
    await act(async () => {
      confirmDangerous.confirm()
    })
    await waitFor(() => expect(stub.ai.respondApproval).toHaveBeenCalledTimes(1))
  })

  it.each([
    [{ state: 'approved' as const }, '已执行'],
    [{ state: 'approved' as const, auto: true }, '已按本会话授权自动执行'],
    [{ state: 'cancelled' as const }, '已取消']
  ])('状态落定文案:%o → %s', (patch, text) => {
    renderCard(approveCard(patch), null)
    expect(screen.getByText(new RegExp(text))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /授权执行/ })).not.toBeInTheDocument()
  })

  it('auto 授权卡使用自动允许标题', () => {
    renderCard(approveCard({ state: 'approved', auto: true }), null)
    expect(screen.getByText('本会话已自动允许写入')).toBeInTheDocument()
  })
})

describe('AiSuggest', () => {
  beforeEach(() => {
    useAiStore.setState({ currentId: 's1', sessions: [makeSession()] })
  })

  it('空列表返回 null', () => {
    const { container } = render(<AiSuggest items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('点击建议会作为用户消息发送', async () => {
    render(<AiSuggest items={['继续排查']} />)
    fireEvent.click(screen.getByRole('button', { name: '继续排查' }))
    await waitFor(() => expect(mockLauncher().ai.send).toHaveBeenCalledTimes(1))
    expect(mockLauncher().ai.send.mock.calls[0]?.[0]).toMatchObject({ text: '继续排查', sessionId: 's1' })
  })

  it('运行中点击被忽略', () => {
    useAiStore.setState({ runId: 'r1' })
    render(<AiSuggest items={['继续排查']} />)
    fireEvent.click(screen.getByRole('button', { name: '继续排查' }))
    expect(mockLauncher().ai.send).not.toHaveBeenCalled()
  })
})
