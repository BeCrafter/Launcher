import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimePayload } from '../../shared/models'
import { createAgentRuntimeWatch } from './agent-runtime'
import type { AgentService } from './agent-service'

const row = {
  id: 'user:com.a',
  status: 'running' as const,
  pid: 1,
  uptime: '1m',
  exitCode: 0,
  isDisabledByOverride: false,
  cpu: '0.0%',
  mem: '0.0%',
  startTime: 'now'
}

function payload(rows = [row]): AgentRuntimePayload {
  return { epoch: 1, rows }
}

function windowOf(state: { visible: boolean; focused: boolean }) {
  return {
    isDestroyed: () => false,
    isVisible: () => state.visible,
    isFocused: () => state.focused
  }
}

describe('agent runtime watch', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('页面没打开、或窗口不在前台,就不扫', async () => {
    const snapshotRuntime = vi.fn(async () => payload())
    const broadcast = vi.fn()
    const state = { visible: false, focused: false }
    const watch = createAgentRuntimeWatch({
      agents: { snapshotRuntime } as unknown as AgentService,
      getWindow: () => windowOf(state) as never,
      broadcast,
      pollMs: 3000
    })
    watch.start()
    watch.setWatch(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(snapshotRuntime).not.toHaveBeenCalled()
    state.visible = true
    state.focused = true
    watch.setVisible(true)
    await vi.waitFor(() => expect(snapshotRuntime).toHaveBeenCalledTimes(1))
    expect(broadcast).toHaveBeenCalledTimes(1)
    state.focused = false
    watch.setVisible(false)
    await Promise.resolve()
    expect(snapshotRuntime).toHaveBeenCalledTimes(1)
    watch.stop()
  })

  it('行没变不推;变了才广播', async () => {
    const snaps = [payload(), payload(), payload([{ ...row, pid: 2 }])]
    const snapshotRuntime = vi.fn(async () => snaps.shift() ?? payload())
    const broadcast = vi.fn()
    const watch = createAgentRuntimeWatch({
      agents: { snapshotRuntime } as unknown as AgentService,
      getWindow: () => windowOf({ visible: true, focused: true }) as never,
      broadcast,
      pollMs: 1000
    })
    watch.setWatch(true)
    await vi.waitFor(() => expect(broadcast).toHaveBeenCalledTimes(1))
    watch.setWatch(true)
    await vi.waitFor(() => expect(snapshotRuntime).toHaveBeenCalledTimes(2))
    expect(broadcast).toHaveBeenCalledTimes(1)
    watch.setWatch(true)
    await vi.waitFor(() => expect(broadcast).toHaveBeenCalledTimes(2))
    expect(broadcast.mock.calls[1][0].rows[0].pid).toBe(2)
    watch.stop()
  })
})
