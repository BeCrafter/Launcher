// Agent 卡片(demo components.js agentCard + agents.js 卡片装配;class 名逐字对齐)
// 槽位复用 L0 原语(StatusDot/StatusLabel/TagChip/ActBtn);动作经 props 上抛
// 非任务/损坏文件(2026-09-13):整卡置灰、启停与「更多」禁用,但**编辑保持可用** —— 这类行唯一的出路就是编辑
import { StatusDot } from '../ui/StatusDot'
import { StatusLabel } from '../ui/StatusLabel'
import { TagChip } from '../ui/TagChip'
import { ActBtn } from '../ui/ActBtn'
import { useT } from '../../hooks/useT'
import { cardActions, exitCodeTone } from '../../lib/agent-card-actions'
import { useAgentsStore } from '../../state/agents-store'
import type { Agent, AgentStatus } from '@shared/models'

const EXIT_COLOR = { ok: 'var(--green)', bad: 'var(--red)', muted: 'var(--muted)' } as const

function exitCodeColor(status: AgentStatus, code: number): string {
  return EXIT_COLOR[exitCodeTone(status, code)]
}

export function AgentCard({
  agent,
  selected,
  onSelect,
  onToggle,
  onEdit,
  onMore
}: {
  agent: Agent
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onEdit: () => void
  onMore: (anchor: { x: number; y: number }) => void
}): React.JSX.Element {
  const t = useT()
  const working = useAgentsStore((s) => s.working[agent.id])
  const broken = !!agent.parseError
  // 非任务文件与损坏文件都不是 launchd 任务:启停与「更多」不画,编辑保留
  const actions = cardActions(agent, working)
  const displayName = agent.label || agent.fileName || ''
  const tagHtml = agent.tags.slice(0, 3).map((tg) => <TagChip key={tg} text={tg} cls={tg} />)
  const brewBadge = agent.isBrew ? <TagChip text="brew" cls="brew" /> : null
  // 开源 isDisabledByOverride:launchctl 覆盖禁用 → 橙标提示(更多菜单/抽屉「启用」可恢复)
  const overrideBadge = agent.isDisabledByOverride ? (
    <TagChip text={t('agent.override')} cls="yellow" title={t('agent.override.title')} />
  ) : null
  // 意图层:未运行→启动 / 运行中→停止。Homebrew 也走这里,main 再决定是 brew services 还是 launchctl。
  const toggle = actions.toggle
  const toggleBtn = toggle ? (
    <ActBtn
      icon={
        toggle.busy
          ? 'fa-solid fa-spinner ops-working-spin'
          : toggle.action === 'stop'
            ? 'fa-solid fa-stop'
            : 'fa-solid fa-play'
      }
      opts={{
        cls: toggle.action === 'stop' ? 'blue' : 'green',
        title: t(actions.statusKey ?? (toggle.action === 'stop' ? 'ops.stop' : 'ops.start')),
        onPress: onToggle,
        disabled: toggle.busy
      }}
    />
  ) : null
  return (
    <div
      className={`agent-col-card${selected ? ' selected' : ''}${agent.isNotTask ? ' not-task' : ''}${broken ? ' broken' : ''}`}
      id={`rc_${agent.id}`}
      onClick={onSelect}
    >
      <div className="acc-top">
        <div className="acc-status-row">
          {actions.abnormal ? (
            <span
              className={`acc-nontask-chip${broken ? ' broken' : ''}`}
              title={broken ? t('agent.broken.title') : t('agent.notTask.title')}
            >
              <i className={`fa-solid ${broken ? 'fa-triangle-exclamation' : 'fa-file-circle-question'}`} />
              {broken ? t('agent.broken') : t('agent.notTask')}
            </span>
          ) : actions.statusKey ? (
            <>
              <div className="status-dot working" />
              <span style={{ color: 'var(--accent2)', fontSize: 10, fontWeight: 600 }}>{t(actions.statusKey)}</span>
            </>
          ) : (
            <>
              <StatusDot status={agent.status} />
              <StatusLabel status={agent.status} />
            </>
          )}
        </div>
        <div className="row-tags" style={{ flex: 1, justifyContent: 'flex-end', overflow: 'hidden' }}>
          {brewBadge}
          {tagHtml}
        </div>
      </div>
      <div className="acc-body">
        <div className="acc-label" title={displayName}>
          {displayName}
        </div>
        <div className="acc-desc" title={broken ? agent.parseError : undefined}>
          {broken
            ? t('agents.broken.reason').replace('{R}', agent.parseError ?? '')
            : agent.isNotTask
              ? t('agents.notTask.hint')
              : agent.desc}
        </div>
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
            <span className="acc-meta-stat" style={{ color: exitCodeColor(agent.status, agent.exitCode) }}>
              <i className="fa-solid fa-right-from-bracket" style={{ color: exitCodeColor(agent.status, agent.exitCode) }} />
              <span>{agent.exitCode}</span>
            </span>
          ) : null}
        </div>
        <div className="acc-actions" onClick={(e) => e.stopPropagation()}>
          {toggleBtn}
          <ActBtn
            icon="fa-solid fa-pen"
            opts={{
              cls: 'accent',
              title: actions.abnormal ? (broken ? t('agent.broken.title') : t('agent.notTask.title')) : t('agents.editConfig'),
              onPress: onEdit
            }}
          />
          {actions.more ? (
            <ActBtn
              icon="fa-solid fa-ellipsis"
              opts={{
                title: t('common.more'),
                onPress: (e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  onMore({ x: r.right, y: r.bottom })
                }
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
