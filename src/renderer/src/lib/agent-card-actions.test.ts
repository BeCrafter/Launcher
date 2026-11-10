import { describe, expect, it } from 'vitest'
import { cardActions, exitCodeTone } from './agent-card-actions'

const row = (over: Partial<Parameters<typeof cardActions>[0]> = {}) => ({
  status: 'stopped' as const,
  isBrew: false,
  isNotTask: false,
  parseError: undefined,
  ...over
})

describe('cardActions', () => {
  it('非任务只留铅笔:不画启停、brew、更多', () => {
    const a = cardActions(row({ isNotTask: true, isBrew: true, status: 'running' }))
    expect(a).toEqual({ abnormal: true, edit: true, toggle: null, more: false, statusKey: null })
  })

  it('解析失败同样只留铅笔', () => {
    const a = cardActions(row({ parseError: 'bad xml' }))
    expect(a.toggle).toBeNull()
    expect(a.more).toBe(false)
    expect(a.edit).toBe(true)
  })

  it('普通任务:运行中只画停止,其余画启动,更多保留', () => {
    expect(cardActions(row({ status: 'running' })).toggle).toEqual({ kind: 'intent', action: 'stop', busy: false })
    expect(cardActions(row({ status: 'loaded' })).toggle).toEqual({ kind: 'intent', action: 'start', busy: false })
    expect(cardActions(row({ status: 'stopped' })).more).toBe(true)
    expect(cardActions(row({ status: 'stopped' })).statusKey).toBeNull()
  })

  it('Homebrew 跟普通任务一样只留一个按钮,并且走同一个意图入口', () => {
    expect(cardActions(row({ isBrew: true, status: 'running' })).toggle).toEqual({ kind: 'intent', action: 'stop', busy: false })
    expect(cardActions(row({ isBrew: true, status: 'stopped' })).toggle).toEqual({ kind: 'intent', action: 'start', busy: false })
  })

  it('进行中:按钮忙、更多不画,启停重启换文案;开机自启只禁用', () => {
    const stopping = cardActions(row({ status: 'running' }), 'stop')
    expect(stopping.toggle).toEqual({ kind: 'intent', action: 'stop', busy: true })
    expect(stopping.more).toBe(false)
    expect(stopping.statusKey).toBe('ops.working.stop')
    const auto = cardActions(row({ status: 'stopped' }), 'autostart')
    expect(auto.toggle).toEqual({ kind: 'intent', action: 'start', busy: true })
    expect(auto.more).toBe(false)
    expect(auto.statusKey).toBeNull()
  })
})

describe('exitCodeTone', () => {
  it('运行中的上次非 0 退出码不用红色', () => {
    expect(exitCodeTone('running', -15)).toBe('muted')
  })

  it('已载入且没有进程、退出码非 0 才用红色', () => {
    expect(exitCodeTone('loaded', 1)).toBe('bad')
  })

  it('0 是正常退出', () => {
    expect(exitCodeTone('stopped', 0)).toBe('ok')
    expect(exitCodeTone('running', 0)).toBe('ok')
  })
})
