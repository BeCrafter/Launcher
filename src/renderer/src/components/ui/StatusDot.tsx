// ported-from: docs/demo/js/components.js statusDot @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 状态点(demo components.js statusDot:running/loaded/stopped 三态)
import type { AgentStatus } from '@shared/models'

export function StatusDot({ status }: { status: AgentStatus }): React.JSX.Element {
  const cls = status === 'running' ? 'running' : status === 'loaded' ? 'loaded' : 'stopped'
  return <div className={`status-dot ${cls}`} />
}
