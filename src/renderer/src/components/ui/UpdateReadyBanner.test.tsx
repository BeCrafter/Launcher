import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeUpdateState } from '../../test/fixtures'
import { useUpdateStore } from '../../state/update-store'
import { UpdateReadyBanner } from './UpdateReadyBanner'

beforeEach(() => {
  useUpdateStore.setState({
    state: makeUpdateState({
      phase: 'ready',
      targetVersion: '0.3.0',
      canCheck: false,
      canApply: true,
      canCancel: true
    }),
    countdown: 10,
    postponed: false,
    dirtyBlocked: false
  })
})

describe('UpdateReadyBanner', () => {
  it('ready 时在任意页面给出倒计时和操作', () => {
    const { container } = render(<UpdateReadyBanner />)
    expect(container.querySelector('.update-ready-banner')).not.toBeNull()
    expect(screen.getByText(/更新已就绪/)).toBeInTheDocument()
    expect(screen.getByText(/v0\.3\.0/)).toBeInTheDocument()
    expect(screen.getByText('10 秒后自动重启并升级')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '立即重启并升级' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '稍后' })).toBeInTheDocument()
  })

  it('未保存内容暂停时显示暂停原因,仍可点「稍后」', () => {
    useUpdateStore.setState({ countdown: null, dirtyBlocked: true })
    render(<UpdateReadyBanner />)
    expect(screen.getByText(/已暂停自动重启/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '稍后' }))
    expect(useUpdateStore.getState().postponed).toBe(true)
  })

  it('点「稍后」后收起,不在全局继续打扰', () => {
    const { container } = render(<UpdateReadyBanner />)
    fireEvent.click(screen.getByRole('button', { name: '稍后' }))
    expect(useUpdateStore.getState().postponed).toBe(true)
    expect(container.querySelector('.update-ready-banner')).toBeNull()
  })

  it('非 ready 阶段不渲染', () => {
    useUpdateStore.setState({ state: makeUpdateState({ phase: 'downloading' }) })
    const { container } = render(<UpdateReadyBanner />)
    expect(container.querySelector('.update-ready-banner')).toBeNull()
  })
})
