// 意图层的「停用任务启动」确认(P1 复审项):enable 副作用必须由用户明确选择,不能藏在 start 内部
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ops: vi.fn(),
  load: vi.fn()
}))

vi.mock('../data', () => ({
  dataSource: (): unknown => ({ agents: { ops: mocks.ops } })
}))
vi.mock('../state/agents-store', () => ({
  useAgentsStore: {
    getState: (): unknown => ({ agents: [], load: mocks.load })
  }
}))
vi.mock('./utils', () => ({ showToast: vi.fn() }))

import { runAgentIntent } from './agent-ops'
import { CHOICE, type ChoiceRequest } from './choice'
import type { Agent } from '@shared/models'

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: 'user:com.a',
  label: 'com.a',
  desc: '',
  status: 'stopped',
  pid: null,
  uptime: null,
  scope: 'user',
  tags: [],
  program: '/bin/echo',
  exitCode: null,
  restarts: 0,
  isDisabledByOverride: false,
  ...over
})

/** 捕获下一个 CHOICE 请求并立刻给出选择 */
function answerChoice(value: string | null): { last: () => ChoiceRequest | null; stop: () => void } {
  let last: ChoiceRequest | null = null
  const unsub = CHOICE.subscribe((req) => {
    if (!req) return // 关闭浮层时会再回调一次 null,别覆盖掉刚捕获的请求
    last = req
    queueMicrotask(() => (value === null ? CHOICE.cancel() : CHOICE.pick(value)))
  })
  return { last: () => last, stop: unsub }
}

describe('runAgentIntent:停用任务的启动', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('先弹选择(说明无法「仅本次启动」);取消 → 零 ops 调用', async () => {
    const c = answerChoice(null)
    const res = await runAgentIntent(agent({ isDisabledByOverride: true }), 'start')
    expect(res).toBeNull()
    expect(mocks.ops).not.toHaveBeenCalled()
    expect(c.last()?.header).toMatch(/停用/)
    expect(c.last()?.title).toMatch(/无法只启动本次|停用会阻止载入/)
    c.stop()
  })

  it('选「启用并启动」→ 才真正调用 ops(start)', async () => {
    mocks.ops.mockResolvedValue({ loaded: true, enabled: true, running: true })
    const c = answerChoice('go')
    const res = await runAgentIntent(agent({ isDisabledByOverride: true }), 'start')
    expect(mocks.ops).toHaveBeenCalledWith('user:com.a', 'start')
    expect(res).toMatchObject({ running: true })
    c.stop()
  })

  it('未停用的任务:不弹选择,直接启动', async () => {
    mocks.ops.mockResolvedValue({ loaded: true, enabled: true, running: true })
    const c = answerChoice('go')
    await runAgentIntent(agent(), 'start')
    expect(mocks.ops).toHaveBeenCalledWith('user:com.a', 'start')
    expect(c.last()).toBeNull() // 没有出现任何选择请求
    c.stop()
  })
})
