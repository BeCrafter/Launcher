// Agents 视图(Phase 1 占位:列表在 Phase 2 落地;对照表标 stub)
import { useT } from '../../hooks/useT'

export function AgentsView(): React.JSX.Element {
  const t = useT()
  return (
    <div id="view-agents" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>
      <div className="list-container" id="agentList" style={{ gap: 16 }} />
      <div style={{ padding: '16px 4px', color: 'var(--dim)', fontSize: 11 }}>{t('agents.empty')}</div>
    </div>
  )
}
