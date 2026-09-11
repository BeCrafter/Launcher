// ported-from: docs/demo/js/services.js + index.html #view-services @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 端口服务视图(阶段 3:真实 lsof 数据 + docker 容器组;分类分组 + kill/重启 + 搜索)
import { useEffect, useMemo } from 'react'
import { useT, useFmt } from '../../hooks/useT'
import { useServicesStore } from '../../state/services-store'
import { useUiStore } from '../../state/ui-store'
import { FilterBar, FilterCounts } from '../../components/FilterBar'
import { Chip } from '../../components/ui/Chip'
import { GroupBlock } from '../../components/GroupBlock'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { SvcCard } from '../../components/cards/SvcCard'
import { containerToService, effectiveType, filterServices, SVC_GROUP_META, SVC_GROUP_ORDER } from '../../lib/classify'
import { ELEVATION, confirmDangerous } from '../../lib/elevation'
import { showToast, copyText, openExternal } from '../../lib/utils'
import { dataSource } from '../../data'
import type { SvcFilter } from '../../data/ports'
import type { PortService } from '@shared/models'

const FILTERS: { id: SvcFilter; icon: string; label?: string; labelKey?: string }[] = [
  { id: 'all', icon: 'fa-solid fa-list', labelKey: 'filter.all' },
  { id: 'brew', icon: 'fa-solid fa-beer-mug-empty', label: 'Homebrew' },
  { id: 'node', icon: 'fa-brands fa-node-js', label: 'Node.js' },
  { id: 'process', icon: 'fa-solid fa-terminal', labelKey: 'svc.type.process' },
  { id: 'docker', icon: 'fa-solid fa-box', labelKey: 'svc.type.docker' }
]

export function ServicesView(): React.JSX.Element {
  const t = useT()
  const fmt = useFmt()
  const services = useServicesStore((s) => s.services)
  const containers = useServicesStore((s) => s.containers)
  const brewServices = useServicesStore((s) => s.brewServices)
  const loaded = useServicesStore((s) => s.loaded)
  const filter = useServicesStore((s) => s.filter)
  const setFilter = useServicesStore((s) => s.setFilter)
  const searchQuery = useUiStore((s) => s.searchQuery)
  // 首屏加载中(!loaded 且仓库为空):渲染骨架,避免「加载中」被误呈现为「没有数据」
  const loading = !loaded && services.length === 0 && containers.length === 0

  // 页面激活门控:进入本页开启 3s 轮询,离开停止(resource 友好)
  useEffect(() => {
    const store = useServicesStore.getState()
    void store.setActive(true).catch(() => {})
    return () => {
      void useServicesStore.getState().setActive(false).catch(() => {})
    }
  }, [])

  const brewManaged = useMemo(() => new Set(brewServices), [brewServices])
  const all = useMemo(() => [...services, ...containers.map(containerToService)], [services, containers])

  const list = useMemo(() => {
    let l = filterServices(all, filter, brewManaged)
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      l = l.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.cmd.toLowerCase().includes(q) ||
          s.command.toLowerCase().includes(q) ||
          String(s.port).includes(q) ||
          s.addr.toLowerCase().includes(q)
      )
    }
    return l
  }, [all, filter, brewManaged, searchQuery])

  // 按分类分桶(demo renderServices 分组顺序 node → brew → process;docker 容器组置末)
  const groups = useMemo(() => {
    const buckets: Record<string, PortService[]> = { node: [], brew: [], process: [], docker: [] }
    list.forEach((s) => buckets[effectiveType(s, brewManaged)].push(s))
    return buckets
  }, [list, brewManaged])

  const onKill = async (svc: PortService): Promise<void> => {
    const ok = await confirmDangerous.request(fmt(t('svc.killConfirm'), { N: svc.name, P: svc.pid ?? 0 }))
    if (!ok) return
    try {
      await doKill(svc, false)
    } catch (err) {
      svcError(err)
    }
  }

  const onCopy = (svc: PortService): void => {
    void copyText(String(svc.port))
    showToast(fmt(t('toast.copiedPort'), { P: svc.port }), '#22d3ee', 'fa-copy')
  }

  // 服务操作错误 → 提示(提权取消/失败用稳定错误码;kill denied 引导提权)
  const svcError = (err: unknown): void => {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('ELEVATION_CANCELLED')) showToast(t('toast.elevCancelled'), '#8888aa', 'fa-ban')
    else if (msg.includes('ELEVATION_FAILED')) showToast(t('toast.elevFailed'), '#f87171', 'fa-circle-exclamation')
    else showToast(t('toast.containerActionFailed'), '#f87171', 'fa-circle-exclamation')
  }

  const doKill = async (svc: PortService, privileged: boolean): Promise<void> => {
    const outcome = await dataSource().services.kill(svc.id, { privileged })
    if (outcome === 'denied') {
      const ok = await ELEVATION.request({ detail: fmt(t('svc.killConfirm'), { N: svc.name, P: svc.pid ?? 0 }), command: `kill -TERM ${svc.pid ?? 0}` })
      if (!ok) return
      const second = await dataSource().services.kill(svc.id, { privileged: true })
      if (second !== 'ok') showToast(t('toast.svcKillDenied'), '#f87171', 'fa-ban')
      else showToast(fmt(t('toast.svcKilled'), { N: svc.name }), '#f87171', 'fa-stop')
      return
    }
    showToast(fmt(t('toast.svcKilled'), { N: svc.name }), '#f87171', 'fa-stop')
  }

  const onRestart = async (svc: PortService): Promise<void> => {
    const ok = await confirmDangerous.request(fmt(t('svc.killConfirm'), { N: svc.name, P: svc.pid ?? 0 }))
    if (!ok) return
    try {
      const r = await dataSource().services.restart(svc.id)
      if (r.ok) showToast(fmt(t('toast.svcRestarted'), { N: svc.name, P: r.newPid ?? 0 }), '#4ade80', 'fa-rotate-right')
      else showToast(fmt(t('toast.svcRestartFailed'), { N: svc.name }), '#f87171', 'fa-circle-exclamation')
    } catch (err) {
      svcError(err)
    }
  }

  const onContainerAction = (svc: PortService, action: 'start' | 'stop' | 'restart'): void => {
    void dataSource()
      .services.containerAction(svc.id, action)
      .catch(svcError)
  }

  const onOpen = (svc: PortService): void => {
    if (svc.port <= 0) return // 无端口映射的容器:不可打开
    showToast(fmt(t('toast.openingPort'), { P: svc.port }), '#60a5fa', 'fa-arrow-up-right-from-square')
    openExternal(`http://127.0.0.1:${svc.port}`)
  }

  return (
    <div id="view-services" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>
      <FilterBar
        id="svcFilterBar"
        counts={<FilterCounts running={all.filter((s) => s.status === 'running').length} total={all.length} />}
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
              icon={meta.icon}
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
                  onRestart={() => void onRestart(s)}
                  onContainerAction={(a) => onContainerAction(s, a)}
                  onOpen={() => onOpen(s)}
                  onCopy={() => onCopy(s)}
                  onKill={() => void onKill(s)}
                />
              ))}
            </GroupBlock>
          )
        })}
        {!list.length && (loading ? <Skeleton rows={5} /> : <EmptyState icon="fa-solid fa-network-wired" text={t('svc.empty')} />)}
      </div>
    </div>
  )
}
