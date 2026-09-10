// 端口服务视图(demo services.js:分类分组渲染 + kill 危险确认 + 复制端口)
import { useMemo } from 'react'
import { useT, useFmt } from '../../hooks/useT'
import { useServicesStore } from '../../state/services-store'
import { useUiStore } from '../../state/ui-store'
import { FilterBar, FilterCounts } from '../../components/FilterBar'
import { Chip } from '../../components/ui/Chip'
import { GroupBlock } from '../../components/GroupBlock'
import { EmptyState } from '../../components/ui/EmptyState'
import { SvcCard } from '../../components/cards/SvcCard'
import { classifySvc, filterServices, SVC_GROUP_META, SVC_GROUP_ORDER } from '../../lib/classify'
import { confirmDangerous } from '../../lib/elevation'
import { showToast } from '../../lib/utils'
import { dataSource } from '../../data'
import type { SvcFilter } from '../../data/ports'
import type { PortService } from '@shared/models'

const FILTERS: { id: SvcFilter; icon: string; label?: string; labelKey?: string }[] = [
  { id: 'all', icon: 'fa-solid fa-list', labelKey: 'filter.all' },
  { id: 'brew', icon: 'fa-solid fa-beer-mug-empty', label: 'Homebrew' },
  { id: 'node', icon: 'fa-brands fa-node-js', label: 'Node.js' },
  { id: 'process', icon: 'fa-solid fa-terminal', labelKey: 'svc.type.process' }
]

export function ServicesView(): React.JSX.Element {
  const t = useT()
  const fmt = useFmt()
  const services = useServicesStore((s) => s.services)
  const brewServices = useServicesStore((s) => s.brewServices)
  const filter = useServicesStore((s) => s.filter)
  const setFilter = useServicesStore((s) => s.setFilter)
  const searchQuery = useUiStore((s) => s.searchQuery)

  const brewManaged = useMemo(() => new Set(brewServices), [brewServices])
  // demo services 无真实搜索(searchHandler 仅 toast);查询参数保留对齐接口
  const list = useMemo(() => filterServices(services, filter, brewManaged), [services, filter, brewManaged])

  // 按分类分桶(demo renderServices 分组顺序 node → brew → process)
  const groups = useMemo(() => {
    const buckets: Record<string, PortService[]> = { node: [], brew: [], process: [] }
    list.forEach((s) => buckets[classifySvc(s, brewManaged)].push(s))
    return buckets
  }, [list, brewManaged])

  const onKill = async (svc: PortService): Promise<void> => {
    const ok = await confirmDangerous.request(fmt(t('svc.killConfirm'), { N: svc.name, P: svc.pid }))
    if (!ok) return
    await dataSource().services.kill(svc.id)
    showToast(fmt(t('toast.killedSvc'), { N: svc.name }), '#f87171', 'fa-stop')
  }

  const onCopy = (svc: PortService): void => {
    showToast(fmt(t('toast.copiedPort'), { P: svc.port }), '#22d3ee', 'fa-copy')
  }

  const onOpen = (svc: PortService): void => {
    showToast(fmt(t('toast.openingPort'), { P: svc.port }), '#60a5fa', 'fa-arrow-up-right-from-square')
  }

  return (
    <div id="view-services" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>
      <FilterBar
        id="svcFilterBar"
        counts={<FilterCounts running={services.filter((s) => s.status === 'running').length} total={services.length} />}
      >
        {FILTERS.map((f) => (
          <Chip key={f.id} active={filter === f.id} icon={f.icon} label={f.label ?? t(f.labelKey as string)} onClick={() => setFilter(f.id)} />
        ))}
      </FilterBar>
      <div className="list-container" id="svcList">
        {SVC_GROUP_ORDER.map((k) => {
          const items = groups[k]
          if (!items?.length) return null
          const meta = SVC_GROUP_META[k]
          return (
            <GroupBlock
              key={k}
              id={`svcgrp_${k}`}
              icon={`fa-solid ${meta.icon}`}
              color={meta.color}
              label={t('svc.type.' + k)}
              count={items.length}
              labelTitle={t(meta.clsKey + '.group')}
            >
              {items.map((s) => (
                <SvcCard
                  key={s.id}
                  svc={s}
                  brewManaged={brewManaged}
                  t={t}
                  onOpen={() => onOpen(s)}
                  onCopy={() => onCopy(s)}
                  onKill={() => void onKill(s)}
                />
              ))}
            </GroupBlock>
          )
        })}
        {!list.length && <EmptyState icon="fa-solid fa-network-wired" text={t('svc.empty')} />}
      </div>
    </div>
  )
}
