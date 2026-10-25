import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiContextMeter } from './AiContextMeter'
import { useAiStore } from '../../state/ai-store'
import {
  makeAssistantMessage,
  makeEngineState,
  makeImageAttachment,
  makeMention,
  makeTextAttachment,
  makeUsage
} from '../../test/fixtures'

function renderMeter(
  props: Partial<ComponentProps<typeof AiContextMeter>> = {}
): ReturnType<typeof render> {
  return render(<AiContextMeter text="" attachments={[]} mentions={[]} {...props} />)
}

/** 用一条带真实 usage 的助手消息做上下文锚点 */
function seedAnchor(totalTokens: number): void {
  useAiStore.setState({
    messages: [
      makeAssistantMessage({
        usage: makeUsage({ input: totalTokens, totalTokens })
      })
    ]
  })
}

beforeEach(() => {
  useAiStore.setState({ engine: makeEngineState() })
})

describe('显示条件', () => {
  it('引擎未加载 / 未配置 / 窗口非法时不渲染', () => {
    useAiStore.setState({ engine: null })
    const a = renderMeter()
    expect(a.container).toBeEmptyDOMElement()
    a.unmount()

    useAiStore.setState({ engine: makeEngineState({ configured: false }) })
    const b = renderMeter()
    expect(b.container).toBeEmptyDOMElement()
    b.unmount()

    useAiStore.setState({ engine: makeEngineState({ contextWindow: 0 }) })
    const c = renderMeter()
    expect(c.container).toBeEmptyDOMElement()
  })

  it('已配置时渲染按钮,aria-label 含百分比与估算口径', () => {
    seedAnchor(100_000)
    renderMeter()
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-label')).toContain('上下文估算')
    expect(button.getAttribute('aria-label')).toContain('50%')
    expect(button.getAttribute('aria-label')).toContain('最近一次服务端用量')
  })
})

describe('阈值样式', () => {
  it('70% 起 warn,90% 起 danger', () => {
    seedAnchor(140_000)
    const a = renderMeter()
    expect(screen.getByRole('button')).toHaveClass('ai-ctx', 'warn')
    a.unmount()

    seedAnchor(180_000)
    renderMeter()
    expect(screen.getByRole('button')).toHaveClass('ai-ctx', 'danger')
  })

  it('超过窗口时 aria-label 明确写出 >100%,弧仍钳在 100%', () => {
    seedAnchor(210_000)
    renderMeter()
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-label')).toContain('>100%')
    expect(button).toHaveClass('danger')
  })
})

describe('悬停/聚焦明细卡', () => {
  it('hover 打开 tooltip,unhover 关闭', async () => {
    const user = userEvent.setup()
    renderMeter()
    const button = screen.getByRole('button')

    await user.hover(button)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    await user.unhover(button)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('focus 打开,Escape 关闭并 blur', () => {
    renderMeter()
    const button = screen.getByRole('button')

    act(() => button.focus())
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(document.activeElement).not.toBe(button)
  })

  it('window blur 关闭', () => {
    renderMeter()
    const button = screen.getByRole('button')

    act(() => button.focus())
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent(window, new Event('blur'))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('悬停同时保持焦点时,移开鼠标不关闭', async () => {
    const user = userEvent.setup()
    renderMeter()
    const button = screen.getByRole('button')

    await user.hover(button)
    act(() => button.focus())
    await user.unhover(button)

    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })

  it('引擎被切到未配置时收起悬停态,重新配置后不会自动展开', async () => {
    const user = userEvent.setup()
    renderMeter()
    await user.hover(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    act(() => useAiStore.setState({ engine: makeEngineState({ configured: false }) }))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    act(() => useAiStore.setState({ engine: makeEngineState() }))
    expect(screen.getByRole('button')).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('卸载时移除 window 的 keydown / blur 监听', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderMeter()

    act(() => screen.getByRole('button').focus())
    unmount()

    const removed = removeSpy.mock.calls.map((c) => c[0])
    expect(removed).toContain('keydown')
    expect(removed).toContain('blur')
  })
})

describe('明细卡内容', () => {
  it('有锚点:展示服务端读数与之后新增', () => {
    seedAnchor(100_000)
    useAiStore.setState({
      messages: [
        ...useAiStore.getState().messages,
        makeAssistantMessage({ id: 'a2', blocks: [{ type: 'text', text: 'abcd' }] })
      ]
    })
    renderMeter()
    act(() => screen.getByRole('button').focus())

    const card = screen.getByRole('tooltip')
    expect(card).toHaveTextContent('服务端读数')
    expect(card).toHaveTextContent('之后新增')
    expect(card).toHaveTextContent('1 条消息')
  })

  it('无锚点但有历史:提示尚未计入', () => {
    useAiStore.setState({ messages: [makeAssistantMessage({ id: 'a1' })] })
    renderMeter()
    act(() => screen.getByRole('button').focus())

    expect(screen.getByRole('tooltip')).toHaveTextContent('1 条历史消息尚未计入')
  })

  it('草稿与附件:文字字数、附件计数、文本/图片拆分', () => {
    renderMeter({
      text: '你好',
      attachments: [makeImageAttachment(), makeTextAttachment()],
      mentions: [makeMention()]
    })
    act(() => screen.getByRole('button').focus())

    const card = screen.getByRole('tooltip')
    expect(card).toHaveTextContent('文字 2 字 · 附件 2 个 · 引用 1 个')
    expect(card).toHaveTextContent('文本 1 个 · 图片 1 张')
  })

  it('超限:展示已超出量', () => {
    seedAnchor(210_000)
    renderMeter()
    act(() => screen.getByRole('button').focus())

    expect(screen.getByRole('tooltip')).toHaveTextContent('已超出约')
  })

  it('footer 展示模型与窗口/输出上限', () => {
    seedAnchor(10_000)
    renderMeter()
    act(() => screen.getByRole('button').focus())

    const card = screen.getByRole('tooltip')
    expect(card).toHaveTextContent('Anthropic · Claude Opus 5')
    expect(card).toHaveTextContent('窗口 200k · 单次输出 64k')
  })
})
