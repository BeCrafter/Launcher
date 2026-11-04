import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeUpdateState } from '../../test/fixtures'
import { useUpdateStore } from '../../state/update-store'
import { UpdatePanel } from './UpdatePanel'

const readyState = (): ReturnType<typeof makeUpdateState> =>
  makeUpdateState({
    phase: 'ready',
    targetVersion: '0.3.0',
    canCheck: false,
    canApply: true,
    canCancel: true
  })

beforeEach(() => {
  useUpdateStore.setState({
    state: readyState(),
    countdown: 10,
    postponed: false,
    dirtyBlocked: false
  })
})

describe('UpdatePanel ready 操作', () => {
  it('倒计时中提供重启 / 稍后 / 取消本次升级', () => {
    render(<UpdatePanel />)
    expect(screen.getByRole('button', { name: '立即重启并升级' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '稍后' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消本次升级' })).toBeInTheDocument()
  })

  it('因未保存内容暂停时仍能点「稍后」', () => {
    useUpdateStore.setState({ countdown: null, dirtyBlocked: true })
    render(<UpdatePanel />)
    expect(screen.getByRole('button', { name: '稍后' })).toBeInTheDocument()
  })

  it('已经稍后时不再显示「稍后」,但仍可取消本次升级', () => {
    useUpdateStore.setState({ countdown: null, postponed: true })
    render(<UpdatePanel />)
    expect(screen.queryByRole('button', { name: '稍后' })).toBeNull()
    expect(screen.getByRole('button', { name: '取消本次升级' })).toBeInTheDocument()
  })
})
