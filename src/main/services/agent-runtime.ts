// Agent 运行态轮询。只在列表页或抽屉需要时跑,而且窗口不在前台就停。
// 进程启停不改 plist,目录监听抓不到;这里补的就是这一段。
// 快照会顺带看一眼公式目录(brew stop 会删掉 LaunchAgents 副本)。任务集合变了由
// onMembershipChange 触发整表刷新;状态变化仍只推 agents:runtime。

import type { BrowserWindow } from 'electron'
import type { AgentRuntimePayload } from '../../shared/models'
import type { AgentService } from './agent-service'

export interface AgentRuntimeWatch {
  start(): void
  stop(): void
  /** 渲染层:Agents 页可见,或抽屉开着。 */
  setWatch(on: boolean): void
  /** 窗口藏起来 / 失焦时停;重新露出时若仍在看,立刻扫一轮。 */
  setVisible(on: boolean): void
}

export function createAgentRuntimeWatch(deps: {
  agents: AgentService
  getWindow(): BrowserWindow | null
  broadcast(payload: AgentRuntimePayload): void
  pollMs?: number
  log?(m: string): void
}): AgentRuntimeWatch {
  const pollMs = deps.pollMs ?? 3000
  const log = deps.log ?? ((): void => {})
  let timer: ReturnType<typeof setInterval> | null = null
  let wanted = false
  let visible = true
  let running = false
  let lastJson = ''

  function shouldPoll(): boolean {
    if (!wanted || !visible) return false
    const win = deps.getWindow()
    if (!win || win.isDestroyed()) return false
    // 菜单栏常驻时关窗只是 hide,这时也不扫。
    if (!win.isVisible() || !win.isFocused()) return false
    return true
  }

  async function tick(): Promise<void> {
    if (!shouldPoll() || running) return
    running = true
    try {
      const snap = await deps.agents.snapshotRuntime()
      const json = JSON.stringify(snap.rows)
      if (json === lastJson) return
      lastJson = json
      deps.broadcast(snap)
    } catch (err) {
      log(`runtime snapshot failed: ${String(err)}`)
    } finally {
      running = false
    }
  }

  return {
    start() {
      if (timer) return
      timer = setInterval(() => void tick(), pollMs)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
    setWatch(on) {
      wanted = on
      if (on) void tick()
    },
    setVisible(on) {
      visible = on
      if (on) void tick()
    }
  }
}
