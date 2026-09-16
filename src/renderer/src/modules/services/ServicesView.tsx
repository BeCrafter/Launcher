// ported-from: docs/demo/js/services.js + index.html #view-services @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 端口服务视图(阶段 3:真实 lsof 数据 + docker 容器组;分类分组 + kill/重启 + 搜索)
import { useEffect, useMemo } from 'react'
import { useT, useFmt } from '../../hooks/useT'
import { useServicesStore } from '../../state/services-store'
import { useSettingsStore } from '../../state/settings-store'
import { useSvcConfigStore } from '../../state/svc-config-store'
import { useUiStore } from '../../state/ui-store'
import { FilterBar, FilterCounts } from '../../components/FilterBar'
import { Chip } from '../../components/ui/Chip'
import { GroupBlock } from '../../components/GroupBlock'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { SvcCard } from '../../components/cards/SvcCard'
import { containerToService, dockerNotice, effectiveType, filterServices, SVC_GROUP_META, SVC_GROUP_ORDER } from '../../lib/classify'
import { ELEVATION, confirmDangerous } from '../../lib/elevation'
import { showToast, copyText, openExternal } from '../../lib/utils'
import {
  displayName,
  isOpenableUrl,
  matchesServiceQuery,
  serviceIdentityKey,
  serviceUrl
} from '../../lib/svc-override'
import { saveServiceOverride } from '../../lib/svc-override-actions'
import { dataSource } from '../../data'
import type { SvcFilter } from '../../data/ports'
import type { PortService } from '@shared/models'
import type { ServiceOverride } from '@shared/settings'

// 模块级冻结空表:settings 未就绪时保持引用稳定,否则每次渲染都新建 {} 会让下游 memo 失效
const EMPTY_OVERRIDES: Record<string, ServiceOverride> = Object.freeze({})

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
  const dockerAvailable = useServicesStore((s) => s.dockerAvailable)
  const dockerReason = useServicesStore((s) => s.dockerReason)
  const loaded = useServicesStore((s) => s.loaded)
  const filter = useServicesStore((s) => s.filter)
  const setFilter = useServicesStore((s) => s.setFilter)
  const searchQuery = useUiStore((s) => s.searchQuery)
  const overrides = useSettingsStore((s) => s.settings?.serviceOverrides ?? EMPTY_OVERRIDES)
  const openSvcConfig = useSvcConfigStore((s) => s.open)
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
      // 别名 / 可连接 host / 原名 / 命令行 / 端口 全部参与匹配(见 lib/svc-override)
      l = l.filter((s) => matchesServiceQuery(s, overrides[serviceIdentityKey(s)], searchQuery))
    }
    return l
  }, [all, filter, brewManaged, searchQuery, overrides])

  // 按分类分桶(demo renderServices 分组顺序 node → brew → process;docker 容器组置末)
  const groups = useMemo(() => {
    const buckets: Record<string, PortService[]> = { node: [], brew: [], process: [], docker: [] }
    list.forEach((s) => buckets[effectiveType(s, brewManaged)].push(s))
    return buckets
  }, [list, brewManaged])

  // Docker 不可用提示:仅在「全部」或已筛到 Docker 时展示(筛 Node/Homebrew 时不该冒出 Docker 组)。
  // 同时在此时抑制通用空状态,否则「提示条 + 无数据」会同时出现
  const dockerDown = !dockerAvailable && (filter === 'all' || filter === 'docker')

  // 覆写解析:展示名 / 完整 URL(键为跨重启稳定的 identityKey,见 lib/svc-override)
  const keyOf = (svc: PortService): string => serviceIdentityKey(svc)
  const nameOf = (svc: PortService): string => displayName(svc, overrides[keyOf(svc)])
  const urlOf = (svc: PortService): string => serviceUrl(svc, overrides[keyOf(svc)])

  const onKill = async (svc: PortService): Promise<void> => {
    const ok = await confirmDangerous.request(fmt(t('svc.killConfirm'), { N: nameOf(svc), P: svc.pid ?? 0 }))
    if (!ok) return
    try {
      await doKill(svc, false)
    } catch (err) {
      svcError(err)
    }
  }

  // 复制完整 URL(含推导/覆写的 host 与已配置路径)—— 此前只复制了端口号
  const onCopy = (svc: PortService): void => {
    const url = urlOf(svc)
    void copyText(url)
    showToast(fmt(t('toast.svcUrlCopied'), { U: url }), '#22d3ee', 'fa-copy')
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
      const ok = await ELEVATION.request({ detail: fmt(t('svc.killConfirm'), { N: nameOf(svc), P: svc.pid ?? 0 }), command: `kill -TERM ${svc.pid ?? 0}` })
      if (!ok) return
      const second = await dataSource().services.kill(svc.id, { privileged: true })
      if (second !== 'ok') showToast(t('toast.svcKillDenied'), '#f87171', 'fa-ban')
      else showToast(fmt(t('toast.svcKilled'), { N: nameOf(svc) }), '#f87171', 'fa-stop')
      return
    }
    showToast(fmt(t('toast.svcKilled'), { N: nameOf(svc) }), '#f87171', 'fa-stop')
  }

  const onRestart = async (svc: PortService): Promise<void> => {
    const ok = await confirmDangerous.request(fmt(t('svc.killConfirm'), { N: nameOf(svc), P: svc.pid ?? 0 }))
    if (!ok) return
    try {
      const r = await dataSource().services.restart(svc.id)
      if (r.ok) showToast(fmt(t('toast.svcRestarted'), { N: nameOf(svc), P: r.newPid ?? 0 }), '#4ade80', 'fa-rotate-right')
      else showToast(fmt(t('toast.svcRestartFailed'), { N: nameOf(svc) }), '#f87171', 'fa-circle-exclamation')
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
    const url = urlOf(svc)
    // 非法 host/端口会被 main 的 url-guard 拒绝并静默吞掉,这里先拦下给出可见反馈
    if (!isOpenableUrl(url)) {
      showToast(t('toast.svcUrlInvalid'), '#f87171', 'fa-circle-exclamation')
      return
    }
    showToast(fmt(t('toast.svcUrlOpening'), { U: url }), '#60a5fa', 'fa-arrow-up-right-from-square')
    openExternal(url)
  }

  // 双击名称就地改名:空串 = 清除别名(回退进程原名)
  const onRename = (svc: PortService, alias: string): void => {
    saveServiceOverride(keyOf(svc), { alias: alias === '' ? undefined : alias })
  }

  const onConfigure = (svc: PortService, anchor: { x: number; y: number }): void => {
    openSvcConfig(svc, anchor.x, anchor.y)
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
          // docker 不可用时也渲染该组:否则整组消失,「没有容器」与「Docker 不可用」无从区分
          const showNotice = k === 'docker' && dockerDown
          if (!items?.length && !showNotice) return null
          const meta = SVC_GROUP_META[k]
          const notice = dockerNotice(dockerReason)
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
              {showNotice && (
                <div className="svc-docker-notice">
                  <i className={notice.icon} />
                  <span>{t(notice.key)}</span>
                  <span className="svc-docker-notice-hint">{t('svc.docker.hint')}</span>
                </div>
              )}
              {items.map((s) => (
                <SvcCard
                  key={s.id}
                  svc={s}
                  brewManaged={brewManaged}
                  overrides={overrides}
                  t={t}
                  onRestart={() => void onRestart(s)}
                  onContainerAction={(a) => onContainerAction(s, a)}
                  onOpen={() => onOpen(s)}
                  onCopy={() => onCopy(s)}
                  onKill={() => void onKill(s)}
                  onRename={(alias) => onRename(s, alias)}
                  onConfigure={(anchor) => onConfigure(s, anchor)}
                />
              ))}
            </GroupBlock>
          )
        })}
        {!list.length && !dockerDown && (loading ? <Skeleton rows={5} /> : <EmptyState icon="fa-solid fa-network-wired" text={t('svc.empty')} />)}
      </div>
    </div>
  )
}
