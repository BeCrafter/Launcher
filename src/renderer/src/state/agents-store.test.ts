import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, AgentRuntimePayload } from '@shared/models'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  checkMissing: vi.fn()
}))

vi.mock('../data', () => ({
  dataSource: (): unknown => ({
    agents: {
      list: mocks.list,
      checkMissing: mocks.checkMissing,
      brewAction: vi.fn(),
      createDraft: vi.fn()
    }
  })
}))

import { useAgentsStore } from './agents-store'

function agent(over: Partial<Agent> = {}): Agent {
  return {
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
    ...over
  }
}

function payload(epoch: number, rows: AgentRuntimePayload['rows']): AgentRuntimePayload {
  return { epoch, rows }
}

describe('agents-store.applyRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkMissing.mockResolvedValue([])
    useAgentsStore.setState({
      agents: [],
      epoch: 0,
      procExtras: {},
      missingPlists: [],
      loaded: false,
      loadVersion: 0
    })
  })

  it('比整表更旧的快照丢掉,不改列表', async () => {
    mocks.list.mockResolvedValue({ agents: [agent({ status: 'running', pid: 1 })], epoch: 2 })
    await useAgentsStore.getState().load()
    const before = useAgentsStore.getState().agents
    useAgentsStore.getState().applyRuntime(
      payload(1, [
        {
          id: 'user:com.a',
          status: 'stopped',
          pid: null,
          uptime: null,
          exitCode: 1,
          isDisabledByOverride: false,
          cpu: null,
          mem: null,
          startTime: null
        }
      ])
    )
    expect(useAgentsStore.getState().agents).toBe(before)
    expect(useAgentsStore.getState().agents[0].status).toBe('running')
  })

  it('按 id 合并运行态,不删行、不加行、不复核孤儿', () => {
    const keep = agent({ id: 'user:file:empty.plist', label: '', isNotTask: true })
    useAgentsStore.setState({ agents: [agent(), keep], epoch: 1, loaded: true })
    useAgentsStore.getState().applyRuntime(
      payload(1, [
        {
          id: 'user:com.a',
          status: 'running',
          pid: 42,
          uptime: '1m',
          exitCode: -15,
          isDisabledByOverride: true,
          cpu: '0.5%',
          mem: '1.0%',
          startTime: 'now'
        },
        {
          id: 'user:com.missing',
          status: 'stopped',
          pid: null,
          uptime: null,
          exitCode: null,
          isDisabledByOverride: false,
          cpu: null,
          mem: null,
          startTime: null
        }
      ])
    )
    const agents = useAgentsStore.getState().agents
    expect(agents.map((a) => a.id)).toEqual(['user:com.a', 'user:file:empty.plist'])
    expect(agents[0]).toMatchObject({ status: 'running', pid: 42, exitCode: -15, isDisabledByOverride: true })
    expect(agents[1]).toBe(keep)
    expect(useAgentsStore.getState().procExtras['user:com.a']).toEqual({
      cpu: '0.5%',
      mem: '1.0%',
      startTime: 'now'
    })
    expect(mocks.checkMissing).not.toHaveBeenCalled()
  })

  it('字段没变就不换数组', () => {
    const row = agent({ status: 'running', pid: 7, uptime: '1m', isDisabledByOverride: false })
    useAgentsStore.setState({ agents: [row], epoch: 1 })
    useAgentsStore.getState().applyRuntime(
      payload(1, [
        {
          id: row.id,
          status: 'running',
          pid: 7,
          uptime: '1m',
          exitCode: null,
          isDisabledByOverride: false,
          cpu: null,
          mem: null,
          startTime: null
        }
      ])
    )
    expect(useAgentsStore.getState().agents).toEqual([row])
    expect(useAgentsStore.getState().agents[0]).toBe(row)
  })
})
