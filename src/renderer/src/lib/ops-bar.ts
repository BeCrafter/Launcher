// ported-from: docs/demo/js/drawer.js updateOpsBar 视觉分支表 @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 抽屉头部操作栏 5 态推导(纯函数化 demo drawer.js updateOpsBar 的视觉分支表)
// 态:draft(草稿) / unloaded(未加载) / stopped(已停) / ready(就绪) / running(运行)
import type { OpsState } from '@shared/models'

export interface OpsBarModel {
  state: 'draft' | 'unloaded' | 'stopped' | 'ready' | 'running'
  loadDisabled: boolean
  enableDisabled: boolean
  kickDisabled: boolean
  load: { icon: string; labelKey: string; cls: string }
  enable: { icon: string; labelKey: string; cls: string }
  dot: string // hdr-state-dot class
  labelKey: string
  chipColor: string // CSS var
}

export function deriveOpsBar(s: OpsState & { isDraft: boolean }): OpsBarModel {
  if (s.isDraft) {
    return {
      state: 'draft',
      loadDisabled: true,
      enableDisabled: true,
      kickDisabled: true,
      load: { icon: 'fa-solid fa-plug', labelKey: 'drawer.op.load', cls: 'hdr-ops-btn' },
      enable: { icon: 'fa-solid fa-circle-check', labelKey: 'drawer.op.enable', cls: 'hdr-ops-btn' },
      dot: 'unloaded',
      labelKey: 'drawer.state.draft',
      chipColor: 'var(--dim)'
    }
  }
  const load = s.loaded
    ? { icon: 'fa-solid fa-plug-circle-xmark', labelKey: 'drawer.op.unload', cls: 'hdr-ops-btn active-blue' }
    : { icon: 'fa-solid fa-plug', labelKey: 'drawer.op.load', cls: 'hdr-ops-btn active-green' }
  const enable =
    s.loaded && s.enabled
      ? { icon: 'fa-solid fa-circle-pause', labelKey: 'drawer.op.disable', cls: 'hdr-ops-btn active-yellow' }
      : { icon: 'fa-solid fa-circle-check', labelKey: 'drawer.op.enable', cls: 'hdr-ops-btn active-accent' }
  if (!s.loaded) {
    return {
      state: 'unloaded',
      loadDisabled: false,
      enableDisabled: true,
      kickDisabled: true,
      load,
      enable,
      dot: 'unloaded',
      labelKey: 'drawer.state.unloaded',
      chipColor: 'var(--dim)'
    }
  }
  if (!s.enabled) {
    return {
      state: 'stopped',
      loadDisabled: false,
      enableDisabled: false,
      kickDisabled: false,
      load,
      enable,
      dot: 'stopped',
      labelKey: 'drawer.state.stopped',
      chipColor: 'var(--yellow)'
    }
  }
  if (s.running) {
    return {
      state: 'running',
      loadDisabled: false,
      enableDisabled: false,
      kickDisabled: false,
      load,
      enable,
      dot: 'running',
      labelKey: 'status.running',
      chipColor: 'var(--green)'
    }
  }
  return {
    state: 'ready',
    loadDisabled: false,
    enableDisabled: false,
    kickDisabled: false,
    load,
    enable,
    dot: 'loaded',
    labelKey: 'drawer.state.ready',
    chipColor: 'var(--accent2)'
  }
}
