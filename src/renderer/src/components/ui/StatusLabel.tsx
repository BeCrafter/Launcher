// ported-from: docs/demo/js/components.js statusLabel @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 状态文案(demo components.js statusLabel:三态配色,文本键可覆盖)
import { useT } from '../../hooks/useT'
import type { AgentStatus } from '@shared/models'

export function StatusLabel({
  status,
  texts
}: {
  status: AgentStatus
  texts?: Partial<Record<AgentStatus, string>>
}): React.JSX.Element | null {
  const t = useT()
  const keys: Record<AgentStatus, string> = {
    running: 'status.running',
    loaded: 'status.loaded',
    stopped: 'status.stopped',
    ...texts
  }
  if (status === 'running') {
    return (
      <span style={{ color: 'var(--green)', fontSize: 10, fontWeight: 600 }}>{t(keys.running)}</span>
    )
  }
  if (status === 'loaded') {
    return (
      <span style={{ color: 'var(--yellow)', fontSize: 10, fontWeight: 600 }}>{t(keys.loaded)}</span>
    )
  }
  if (status === 'stopped') {
    return <span style={{ color: 'var(--dim)', fontSize: 10 }}>{t(keys.stopped)}</span>
  }
  return null
}
