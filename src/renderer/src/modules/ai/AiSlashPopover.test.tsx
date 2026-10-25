import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiSlashPopover } from './AiSlashPopover'
import { useAiStore } from '../../state/ai-store'
import { makeSkill } from '../../test/fixtures'

interface HostProps {
  open?: boolean
  query?: string
  selectedSkillIds?: string[]
  onPickSkill?: (id: string) => void
  onPickFile?: () => void
  onClose?: () => void
}

function Host({
  open = true,
  query = '',
  selectedSkillIds = [],
  onPickSkill = vi.fn(),
  onPickFile = vi.fn(),
  onClose = vi.fn()
}: HostProps): React.JSX.Element {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  return (
    <>
      <div data-testid="anchor" ref={anchorRef} />
      <AiSlashPopover
        open={open}
        query={query}
        anchorRef={anchorRef}
        selectedSkillIds={selectedSkillIds}
        onPickSkill={onPickSkill}
        onPickFile={onPickFile}
        onClose={onClose}
      />
    </>
  )
}

beforeEach(() => {
  useAiStore.setState({
    skills: [
      makeSkill({ id: 'sk-diag', tag: '诊断' }),
      makeSkill({
        id: 'sk-cron',
        nameKey: 'ai.report.title',
        descKey: 'ai.cron.title',
        tag: '定时'
      })
    ]
  })
})

describe('渲染', () => {
  it('open=false 不渲染 portal', () => {
    render(<Host open={false} />)
    expect(document.getElementById('aiSlashPop')).toBeNull()
  })

  it('渲染技能行与文件行', () => {
    render(<Host />)
    expect(screen.getByText('技能与操作')).toBeInTheDocument()
    expect(screen.getByText('一键系统体检')).toBeInTheDocument()
    expect(screen.getByText('添加本地文件')).toBeInTheDocument()
  })

  it('按技能名/id 过滤;无匹配显示空态', () => {
    render(<Host query="sk-cron" />)
    expect(screen.getByText('系统体检报告')).toBeInTheDocument()
    expect(screen.queryByText('一键系统体检')).not.toBeInTheDocument()
    expect(screen.queryByText('添加本地文件')).not.toBeInTheDocument()
  })

  it('无匹配行时显示空态文案', () => {
    render(<Host query="zzz" />)
    expect(screen.getByText('没有匹配的技能或操作')).toBeInTheDocument()
  })

  it('已选技能标记 selected 与「已选」', () => {
    render(<Host selectedSkillIds={['sk-cron']} />)
    const selectedRow = screen.getByText('已选').closest('button')
    expect(selectedRow).toHaveClass('selected')
  })
})

describe('点击', () => {
  it('点技能行回调 id,点文件行回调文件操作', async () => {
    const user = userEvent.setup()
    const onPickSkill = vi.fn()
    const onPickFile = vi.fn()
    render(<Host onPickSkill={onPickSkill} onPickFile={onPickFile} />)

    await user.click(screen.getByText('一键系统体检'))
    expect(onPickSkill).toHaveBeenCalledWith('sk-diag')

    await user.click(screen.getByText('添加本地文件'))
    expect(onPickFile).toHaveBeenCalledTimes(1)
  })
})

describe('键盘', () => {
  it('ArrowDown 移动,Enter 选中当前行', () => {
    const onPickSkill = vi.fn()
    render(<Host onPickSkill={onPickSkill} />)

    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onPickSkill).toHaveBeenCalledWith('sk-cron')
  })

  it('ArrowUp 从第一行环绕到最后一行(文件行)', () => {
    const onPickFile = vi.fn()
    render(<Host onPickFile={onPickFile} />)

    fireEvent.keyDown(window, { key: 'ArrowUp' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onPickFile).toHaveBeenCalledTimes(1)
  })

  it('ArrowDown 从最后一行环绕回第一行', () => {
    const onPickSkill = vi.fn()
    render(<Host onPickSkill={onPickSkill} />)

    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onPickSkill).toHaveBeenCalledWith('sk-diag')
  })

  it('零行时 Enter 只关闭菜单', () => {
    const onClose = vi.fn()
    const onPickSkill = vi.fn()
    render(<Host query="zzz" onClose={onClose} onPickSkill={onPickSkill} />)

    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onPickSkill).not.toHaveBeenCalled()
  })

  it('Escape 关闭', () => {
    const onClose = vi.fn()
    render(<Host onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('输入法组合中的按键忽略', () => {
    const onClose = vi.fn()
    const onPickSkill = vi.fn()
    render(<Host onClose={onClose} onPickSkill={onPickSkill} />)

    fireEvent.keyDown(window, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true })
    expect(onClose).not.toHaveBeenCalled()
    expect(onPickSkill).not.toHaveBeenCalled()
  })
})

describe('外部点击与清理', () => {
  it('document mousedown 关闭;popover/anchor 内的 mousedown 不关闭', () => {
    const onClose = vi.fn()
    render(<Host onClose={onClose} />)

    fireEvent.mouseDown(document.getElementById('aiSlashPop')!)
    fireEvent.mouseDown(screen.getByTestId('anchor'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('卸载时移除 window 键盘/滚动与 document mousedown 监听', () => {
    const winRemove = vi.spyOn(window, 'removeEventListener')
    const docRemove = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(<Host />)

    unmount()

    expect(winRemove.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(['keydown', 'resize', 'scroll'])
    )
    expect(docRemove.mock.calls.map((c) => c[0])).toContain('mousedown')
  })
})
