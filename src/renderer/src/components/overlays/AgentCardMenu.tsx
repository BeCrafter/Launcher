// Agent 卡片「更多」菜单(根级浮层,应用新增 UI;超出 demo 冻结基线)
// 提供两个维度:开机自启(开关语义)与 立即执行一次(只跑这次、不改自启设置)
import { useEffect, useRef } from 'react'
import { useT } from '../../hooks/useT'
import { useCardMenuStore } from '../../state/card-menu-store'
import { useAgentsStore } from '../../state/agents-store'
import { runAgentIntent } from '../../lib/agent-ops'

const MENU_W = 168

export function AgentCardMenu(): React.JSX.Element | null {
  const t = useT()
  const agentId = useCardMenuStore((s) => s.agentId)
  const x = useCardMenuStore((s) => s.x)
  const y = useCardMenuStore((s) => s.y)
  const close = useCardMenuStore((s) => s.close)
  const ref = useRef<HTMLDivElement | null>(null)

  const agent = useAgentsStore((s) => s.agents.find((a) => a.id === agentId))
  const open = agentId !== null && agent !== undefined

  // 点外部 / Esc 关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  if (!open || !agent) return null

  const run = (action: 'autostart'): void => {
    close()
    void runAgentIntent(agent, action).then((next) => {
      if (next) void useAgentsStore.getState().load()
    })
  }

  // 定位:锚点按钮右对齐、下方 4px;防溢出钳制
  const left = Math.max(8, Math.min(x - MENU_W, window.innerWidth - MENU_W - 8))
  const top = Math.min(y + 4, window.innerHeight - 96)

  return (
    <div className="agent-card-menu" ref={ref} style={{ left, top, width: MENU_W }} id="agentCardMenu">
      <button className="agent-card-menu-item" type="button" onClick={() => run('autostart')}>
        <i className={agent.isDisabledByOverride ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-pause'} />
        {t(agent.isDisabledByOverride ? 'ops.autostartOn' : 'ops.autostartOff')}
      </button>
    </div>
  )
}
