// ported-from: docs/demo/js/agents.js + index.html #view-agents @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// Launch Agents 视图(逐行为移植 docs/demo/js/agents.js renderAgents/filterAgents/handleSearch)
// 过滤 → 搜索 → 分桶(user/system/daemon)→ invalid 横幅 + GroupBlock 分组渲染
import { useMemo } from 'react'
import { useT } from '../../hooks/useT'
import { useAgentsStore } from '../../state/agents-store'
import { useUiStore } from '../../state/ui-store'
import { FilterBar, FilterCounts } from '../../components/FilterBar'
import { Chip } from '../../components/ui/Chip'
import { GroupBlock } from '../../components/GroupBlock'
import { EmptyState } from '../../components/ui/EmptyState'
import { ActBtn } from '../../components/ui/ActBtn'
import { AgentCard } from '../../components/cards/AgentCard'
import { useDrawerStore } from '../../state/drawer-store'
import { showToast } from '../../lib/utils'
import { confirmDangerous } from '../../lib/elevation'
import { cronErrorToast } from '../../lib/cron'
import { dataSource } from '../../data'
import type { Agent, AgentScope } from '@shared/models'
import type { AgentFilter } from '../../data/ports'

// demo agents.js 分组元数据(icon/color/labelKey 逐字对应)
const GROUP_META: Record<AgentScope, { icon: string; color: string; labelKey: string }> = {
  user: { icon: 'fa-user', color: 'var(--blue)', labelKey: 'agents.group.user' },
  system: { icon: 'fa-building', color: 'var(--yellow)', labelKey: 'agents.group.global' },
  daemon: { icon: 'fa-server', color: 'var(--red)', labelKey: 'agents.group.daemon' }
}

const FILTERS: { id: AgentFilter; icon: string; label?: string; labelKey?: string }[] = [
  { id: 'all', icon: 'fa-solid fa-list', labelKey: 'filter.all' },
  { id: 'brew', icon: 'fa-solid fa-beer-mug-empty', label: 'Homebrew' },
  { id: 'user', icon: 'fa-solid fa-user', labelKey: 'filter.user' },
  { id: 'system', icon: 'fa-solid fa-building', labelKey: 'filter.global' },
  { id: 'daemon', icon: 'fa-solid fa-server', label: 'Daemon' }
]

export function AgentsView(): React.JSX.Element {
  const t = useT()
  const agents = useAgentsStore((s) => s.agents)
  const invalidPlists = useAgentsStore((s) => s.invalidPlists)
  const missingPlists = useAgentsStore((s) => s.missingPlists)
  const filter = useAgentsStore((s) => s.filter)
  const setFilter = useAgentsStore((s) => s.setFilter)
  const selectedId = useAgentsStore((s) => s.selectedId)
  const select = useAgentsStore((s) => s.select)
  const toggle = useAgentsStore((s) => s.toggle)
  const brewAction = useAgentsStore((s) => s.brewAction)
  const searchQuery = useUiStore((s) => s.searchQuery)

  const list = useMemo(() => {
    // demo renderAgents 过滤分支
    let l = agents.filter((a) => {
      if (filter === 'brew') return !!a.isBrew
      if (filter === 'user') return a.scope === 'user' && !a.isBrew
      if (filter === 'system') return a.scope === 'system'
      if (filter === 'daemon') return a.scope === 'daemon'
      return true
    })
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      l = l.filter(
        (a) => a.label.toLowerCase().includes(q) || a.tags.some((tg) => tg.includes(q)) || a.desc.toLowerCase().includes(q)
      )
    }
    return l
  }, [agents, filter, searchQuery])

  // 分桶(demo groups 顺序 user → system → daemon)
  const groups = useMemo(() => {
    const g: Record<AgentScope, Agent[]> = { user: [], system: [], daemon: [] }
    list.forEach((a) => {
      if (g[a.scope]) g[a.scope].push(a)
    })
    return g
  }, [list])

  const runningCount = agents.filter((a) => a.status === 'running').length

  const onToggle = (a: Agent): void => {
    const wasRunning = a.status === 'running'
    void toggle(a.id).then(() => {
      showToast(
        wasRunning ? `bootout: ${a.label}` : `bootstrap: ${a.label}`,
        wasRunning ? '#60a5fa' : '#4ade80',
        wasRunning ? 'fa-stop' : 'fa-play'
      )
    })
  }

  const onBrew = (kind: 'start' | 'stop', a: Agent): void => {
    void brewAction(kind, a.id).then(() => {
      showToast(`brew ${kind}: ${a.label}`, '#f97316', 'fa-beer-mug-empty')
    })
  }

  return (
    <div id="view-agents" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>
      <FilterBar
        id="agentFilterBar"
        counts={<FilterCounts running={runningCount} total={agents.length} />}
      >
        {FILTERS.map((f) => (
          <Chip
            key={f.id}
            active={filter === f.id}
            icon={f.icon}
            label={f.label ?? t(f.labelKey as string)}
            onClick={() => setFilter(f.id)}
          />
        ))}
      </FilterBar>
      <div className="list-container" id="agentList" style={{ gap: 16 }}>
        {missingPlists.length > 0 && (
          <div id="missingPlistsBanner" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--yellow)' }}>
              <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 6 }} />
              {t('agents.missing.title')}
            </div>
            {missingPlists
              .filter((m) => filter === 'all' || filter === m.scope)
              .map((m) => (
                <div className="invalid-plist-row" key={`${m.scope}:${m.label}`}>
                  <i className="fa-solid fa-unlink invalid-icon" style={{ color: 'var(--yellow)' }} />
                  <div className="invalid-info">
                    <div className="invalid-path">
                      {m.label}
                      {m.pid ? <span style={{ color: 'var(--dim)' }}> · PID {m.pid}</span> : null}
                    </div>
                    <div className="invalid-sub">
                      {t('agents.missing.hint')}
                      {m.path ? <span style={{ marginLeft: 6, color: 'var(--dim)' }}>{m.path}</span> : null}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
        {(filter === 'all' || filter === 'user') &&
          invalidPlists.map((inv) => (
            <div className="invalid-plist-row" key={inv.path}>
              <i className="fa-solid fa-circle-exclamation invalid-icon" />
              <div className="invalid-info">
                <div className="invalid-path">{inv.path}</div>
                <div className="invalid-sub">{inv.reason}</div>
              </div>
              <ActBtn
                icon="fa-solid fa-trash-can"
                opts={{
                  cls: 'red',
                  title: t('common.delete'),
                  iconStyle: { fontSize: 10 },
                  onPress: () => {
                    void (async () => {
                      const confirmed = await confirmDangerous.request(t('common.delete') + ': ' + inv.path)
                      if (!confirmed) return
                      try {
                        await dataSource().agents.removeInvalid(inv.path)
                        await useAgentsStore.getState().load()
                        showToast(t('toast.plistDeleted'), '#f87171', 'fa-trash-can')
                      } catch (err) {
                        cronErrorToast(err, t)
                      }
                    })()
                  }
                }}
              />
            </div>
          ))}
        {(Object.keys(GROUP_META) as AgentScope[]).map((scope) => {
          const items = groups[scope]
          if (!items.length) return null
          const meta = GROUP_META[scope]
          const gid = `grp_${meta.labelKey}`
          return (
            <GroupBlock
              key={scope}
              id={gid}
              icon={`fa-solid ${meta.icon}`}
              color={meta.color}
              label={t(meta.labelKey)}
              count={items.length}
            >
              {items.map((a) => (
                <AgentCard
                  key={a.id}
                  agent={a}
                  selected={selectedId === a.id}
                  onSelect={() => select(a.id)}
                  onToggle={() => onToggle(a)}
                  onBrew={(kind) => onBrew(kind, a)}
                  onEdit={() => void useDrawerStore.getState().openFor(a)}
                  onMore={() => showToast(t('toast.moreActions'), '#888', 'fa-ellipsis')}
                />
              ))}
            </GroupBlock>
          )
        })}
        {!list.length && <EmptyState icon="fa-solid fa-magnifying-glass" text={t('agents.empty')} />}
      </div>
    </div>
  )
}
