// ported-from: docs/demo/js/crontab.js(renderCron/filterCrons) + index.html #view-crontab @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// Cron 视图(demo renderCron/filterCrons/updateCronStats:#cronGrid 嵌套 + scope 分组 + 文档级点击收面板)
import { useEffect, useMemo } from 'react'
import { useT } from '../../hooks/useT'
import { useCronStore } from '../../state/cron-store'
import { useUiStore } from '../../state/ui-store'
import { FilterBar, FilterCounts } from '../../components/FilterBar'
import { Chip } from '../../components/ui/Chip'
import { GroupBlock } from '../../components/GroupBlock'
import { EmptyState } from '../../components/ui/EmptyState'
import { CronCard } from './CronCard'
import { CronLogDrawer } from './CronLogDrawer'
import { NewCronModal } from './NewCronModal'
import type { CronFilter } from '../../data/ports'

// demo CRON_SCOPE_GROUPS(逐字)
const CRON_SCOPE_GROUPS = [
  { key: 'user', icon: 'fa-solid fa-user', color: 'blue', labelKey: 'filter.user' },
  { key: 'system', icon: 'fa-solid fa-building', color: 'red', labelKey: 'filter.systemEtc' }
] as const

const FILTERS: { id: CronFilter; icon: string; labelKey: string }[] = [
  { id: 'all', icon: 'fa-solid fa-list', labelKey: 'filter.all' },
  { id: 'user', icon: 'fa-solid fa-user', labelKey: 'filter.user' },
  { id: 'system', icon: 'fa-solid fa-building', labelKey: 'filter.systemEtc' }
]

export function CronView(): React.JSX.Element {
  const t = useT()
  const crons = useCronStore((s) => s.crons)
  const filter = useCronStore((s) => s.filter)
  const setFilter = useCronStore((s) => s.setFilter)
  const setEditingId = useCronStore((s) => s.setEditingId)
  const searchQuery = useUiStore((s) => s.searchQuery)

  const list = useMemo(() => {
    let l = crons.filter((j) => {
      if (filter === 'user') return !j.system
      if (filter === 'system') return !!j.system
      return true
    })
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      l = l.filter((j) => j.cmd.toLowerCase().includes(q) || j.desc.toLowerCase().includes(q) || j.expr.toLowerCase().includes(q))
    }
    return l
  }, [crons, filter, searchQuery])

  const byGroup = useMemo(() => {
    const g: Record<'user' | 'system', typeof list> = { user: [], system: [] }
    list.forEach((j) => {
      ;(j.system ? g.system : g.user).push(j)
    })
    return g
  }, [list])

  // demo:点击卡片/面板以外区域收起内联编辑
  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (target.closest('#cronGrid .cron-edit-expand.open, #cronGrid .cron-col-card')) return
      if (document.querySelector('#cronGrid .cron-edit-expand.open')) setEditingId(null)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [setEditingId])

  return (
    <div id="view-crontab" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>
      <FilterBar id="cronFilterBar" counts={<FilterCounts running={crons.filter((j) => j.enabled).length} total={crons.length} />}>
        {FILTERS.map((f) => (
          <Chip key={f.id} active={filter === f.id} icon={f.icon} label={t(f.labelKey)} onClick={() => setFilter(f.id)} />
        ))}
      </FilterBar>
      <div className="list-container" id="cronList">
        <div id="cronGrid">
          {CRON_SCOPE_GROUPS.map((g) => {
            const items = byGroup[g.key]
            if (!items.length) return null
            return (
              <GroupBlock
                key={g.key}
                id={`crongrp_${g.key}`}
                icon={g.icon}
                color={`var(--${g.color})`}
                label={t(g.labelKey)}
                count={items.length}
              >
                {items.map((j) => (
                  <CronCard key={j.id} job={j} />
                ))}
              </GroupBlock>
            )
          })}
        </div>
        {!list.length && <EmptyState icon="fa-regular fa-clock" text={t('cron.empty')} />}
      </div>
      <CronLogDrawer />
      <NewCronModal />
    </div>
  )
}
