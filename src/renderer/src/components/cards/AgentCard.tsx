// ported-from: docs/demo/js/components.js agentCard + agents.js 卡片装配 @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// Agent 卡片(demo components.js agentCard + agents.js 卡片装配;class 名逐字对齐)
// 槽位复用 L0 原语(StatusDot/StatusLabel/TagChip/ActBtn);动作经 props 上抛
import { StatusDot } from '../ui/StatusDot'
import { StatusLabel } from '../ui/StatusLabel'
import { TagChip } from '../ui/TagChip'
import { ActBtn } from '../ui/ActBtn'
import { useT } from '../../hooks/useT'
import type { Agent } from '@shared/models'

export function AgentCard({
  agent,
  selected,
  onSelect,
  onToggle,
  onBrew,
  onEdit,
  onMore
}: {
  agent: Agent
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onBrew: (kind: 'start' | 'stop') => void
  onEdit: () => void
  onMore: () => void
}): React.JSX.Element {
  const t = useT()
  const tagHtml = agent.tags.slice(0, 3).map((tg) => <TagChip key={tg} text={tg} cls={tg} />)
  const brewBadge = agent.isBrew ? <TagChip text="brew" cls="brew" /> : null
  const toggleBtn = agent.isBrew ? (
    <>
      <ActBtn icon="fa-solid fa-play" opts={{ cls: 'green', title: 'brew start', onPress: onBrew.bind(null, 'start') }} />
      {'  '}
      <ActBtn icon="fa-solid fa-stop" opts={{ cls: 'blue', title: 'brew stop', onPress: onBrew.bind(null, 'stop') }} />
    </>
  ) : (
    <ActBtn
      icon={agent.status === 'running' ? 'fa-solid fa-stop' : 'fa-solid fa-play'}
      opts={{
        cls: agent.status === 'running' ? 'blue' : 'green',
        title: agent.status === 'running' ? 'bootout' : 'bootstrap',
        onPress: onToggle
      }}
    />
  )
  return (
    <div className={`agent-col-card${selected ? ' selected' : ''}`} id={`rc_${agent.id}`} onClick={onSelect}>
      <div className="acc-top">
        <div className="acc-status-row">
          <StatusDot status={agent.status} />
          <StatusLabel status={agent.status} />
        </div>
        <div className="row-tags" style={{ flex: 1, justifyContent: 'flex-end', overflow: 'hidden' }}>
          {brewBadge}
          {tagHtml}
        </div>
      </div>
      <div className="acc-body">
        <div className="acc-label" title={agent.label}>
          {agent.label}
        </div>
        <div className="acc-desc">{agent.desc}</div>
      </div>
      <div className="acc-meta">
        <div className="acc-meta-left">
          <span className="acc-meta-stat">
            <i className="fa-solid fa-microchip" style={{ color: 'var(--accent2)' }} />
            <span>{agent.pid ? `PID ${agent.pid}` : '—'}</span>
          </span>
          <span className="acc-meta-stat">
            <i className="fa-regular fa-clock" style={{ color: 'var(--muted)' }} />
            <span>{agent.uptime || '—'}</span>
          </span>
          {agent.exitCode !== null && agent.exitCode !== undefined ? (
            <span
              className="acc-meta-stat"
              style={{ color: agent.exitCode === 0 ? 'var(--green)' : 'var(--red)' }}
            >
              <i
                className="fa-solid fa-right-from-bracket"
                style={{ color: agent.exitCode === 0 ? 'var(--green)' : 'var(--red)' }}
              />
              <span>{agent.exitCode}</span>
            </span>
          ) : null}
        </div>
        <div className="acc-actions" onClick={(e) => e.stopPropagation()}>
          {toggleBtn}
          <ActBtn icon="fa-solid fa-pen" opts={{ cls: 'accent', title: t('agents.editConfig'), onPress: onEdit }} />
          <ActBtn icon="fa-solid fa-ellipsis" opts={{ title: t('common.more'), onPress: onMore }} />
        </div>
      </div>
    </div>
  )
}
