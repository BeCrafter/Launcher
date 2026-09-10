// 过滤栏(demo:#agentFilterBar/#cronFilterBar/#svcFilterBar 同构 = chips + 右侧计数块)
// chips 由各视图注入(active 态由视图 filter 状态驱动)
import { useT } from '../hooks/useT'

export function FilterBar({
  id,
  children,
  counts
}: {
  id: string
  children: React.ReactNode
  counts?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="filter-bar" id={id}>
      {children}
      {counts}
    </div>
  )
}

// 右侧计数块(demo 内联样式逐字保留;#runningCount/#totalCount id 供对照)
export function FilterCounts({
  running,
  total
}: {
  running: React.ReactNode
  total: React.ReactNode
}): React.JSX.Element {
  const t = useT()
  return (
    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>
        <span id="runningCount" style={{ color: 'var(--green)', fontWeight: 700 }}>
          {running}
        </span>{' '}
        <span>{t('filter.runningSep')}</span>
        <span id="totalCount" style={{ color: 'var(--muted)' }}>
          {total}
        </span>{' '}
        <span>{t('filter.total')}</span>
      </span>
    </div>
  )
}
