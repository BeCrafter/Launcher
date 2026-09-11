// 一次性应用引导:StrictMode 双跑安全(幂等守卫)
import { IPC_EVENTS } from '@shared/ipc'
import type { ServicesListPayload } from '@shared/ipc'
import type { Agent } from '@shared/models'
import { initSettingsFromMain } from './settings-store'
import { useAgentsStore } from './agents-store'
import { useCronStore } from './cron-store'
import { useServicesStore } from './services-store'
import { useSettingsStore } from './settings-store'
import { setAuthCacheMinGetter, setConfirmDangerousGetter } from '../lib/elevation'

let booted = false

export function bootstrap(): void {
  if (booted) return
  booted = true
  // 移除「启动中」过渡页(与 index.html #boot-splash 契约)
  document.getElementById('boot-splash')?.remove()
  initSettingsFromMain()
  // 提权/危险确认读取设置(demo localStorage launcher_authCacheMin / launcher_confirmDangerous 语义)
  setAuthCacheMinGetter(() => useSettingsStore.getState().settings?.authCacheMin ?? 5)
  setConfirmDangerousGetter(() => useSettingsStore.getState().settings?.confirmDangerous ?? true)

  // fseventsActive:main 监听 launchd 目录变化 → agents 重载(mock 源下数据不变,阶段 1 换源即真实刷新)
  window.launcher.onEvent(IPC_EVENTS.agentsDirChanged, () => {
    void useAgentsStore.getState().load().catch((e) => console.error('[bootstrap] agents reload', e))
  })

  // 端口服务:main 轮询命中集合变化时推送(阶段 3;页面激活时 3s 一轮)
  window.launcher.onEvent(IPC_EVENTS.servicesUpdated, (payload) => {
    if (payload) useServicesStore.getState().applyPayload(payload as ServicesListPayload)
  })

  // menubarBadge:运行中 Agent 计数上报(去重;main 渲染 Tray 角标)
  let lastBadge = -1
  const pushBadge = (agents: Agent[]): void => {
    const n = agents.filter((a) => a.status === 'running').length
    if (n === lastBadge) return
    lastBadge = n
    void window.launcher.reportBadgeCount(n).catch((e) => console.error('[bootstrap] badge', e))
  }
  pushBadge(useAgentsStore.getState().agents)
  useAgentsStore.subscribe((s, prev) => {
    if (s.agents !== prev.agents) pushBadge(s.agents)
  })

  // 数据模块首屏加载(mock 立即 resolve;失败不阻断外壳)
  void useAgentsStore.getState().load().catch((e) => console.error('[bootstrap] agents', e))
  void useCronStore.getState().load().catch((e) => console.error('[bootstrap] crons', e))
  void useServicesStore.getState().load().catch((e) => console.error('[bootstrap] services', e))
}
