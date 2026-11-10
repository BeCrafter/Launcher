// 一次性应用引导:StrictMode 双跑安全(幂等守卫)
import { IPC_EVENTS } from '@shared/ipc'
import type { ServicesListPayload } from '@shared/ipc'
import type { Agent, AgentRuntimePayload, DrawerStatusModel } from '@shared/models'
import type { NotesChangedPayload } from '@shared/notes'
import { initSettingsFromMain } from './settings-store'
import { useAgentsStore } from './agents-store'
import { useDrawerStore } from './drawer-store'
import { useUiStore } from './ui-store'
import { useCronStore } from './cron-store'
import { useServicesStore } from './services-store'
import { useNotesStore } from './notes-store'
import { useSettingsStore } from './settings-store'
import { useUpdateStore } from './update-store'
import { setAuthCacheMinGetter, setConfirmDangerousGetter } from '../lib/elevation'

let booted = false

export function bootstrap(): void {
  if (booted) return
  booted = true
  // 过渡页的摘除不在这里(见 boot/splash.ts):模块求值期删会让它在「还没被画出来」时就消失,
  // 首帧落到空 #root 上 —— 浅色主题下就是白屏。现在由 App 首次 commit 的 useLayoutEffect 负责。
  initSettingsFromMain()
  // 提权/危险确认读取设置(demo localStorage launcher_authCacheMin / launcher_confirmDangerous 语义)
  setAuthCacheMinGetter(() => useSettingsStore.getState().settings?.authCacheMin ?? 5)
  setConfirmDangerousGetter(() => useSettingsStore.getState().settings?.confirmDangerous ?? true)

  // fseventsActive:main 监听 launchd 目录变化 → agents 重载(mock 源下数据不变,阶段 1 换源即真实刷新)
  // agentsChanged:文件写入/运行态改变(main 侧 AI/MCP 工具直接调服务,绕过本 store)→ 同样重载。
  // 两者都走同一个去抖:AI 一次「写入 + 载入」会连发两条事件,没必要各拉一次整表。
  let agentsReloadTimer: ReturnType<typeof setTimeout> | null = null
  const reloadAgents = (): void => {
    if (agentsReloadTimer) clearTimeout(agentsReloadTimer)
    agentsReloadTimer = setTimeout(() => {
      agentsReloadTimer = null
      void useAgentsStore.getState().load().catch((e) => console.error('[bootstrap] agents reload', e))
    }, 150)
  }
  window.launcher.onEvent(IPC_EVENTS.agentsDirChanged, reloadAgents)
  window.launcher.onEvent(IPC_EVENTS.agentsChanged, reloadAgents)
  window.launcher.onEvent(IPC_EVENTS.agentsRuntime, (payload) => {
    if (payload) useAgentsStore.getState().applyRuntime(payload as AgentRuntimePayload)
  })

  // 只在看着 Agents,或抽屉开着时,让 main 扫运行态。窗口不在前台时 main 自己会停。
  const syncWatch = (): void => {
    const on = useUiStore.getState().module === 'agents' || useDrawerStore.getState().open
    void window.launcher.agents.setWatch(on).catch((e) => console.error('[bootstrap] agents watch', e))
  }
  syncWatch()
  useUiStore.subscribe((s, prev) => {
    if (s.module !== prev.module) syncWatch()
  })
  useDrawerStore.subscribe((s, prev) => {
    if (s.open !== prev.open) syncWatch()
  })

  // 抽屉吃列表里当前那一行。卡片、头部芯片、状态页用同一份快照。
  const followDrawer = (): void => {
    const before = useDrawerStore.getState()
    if (!before.open || !before.agentId || before.isDraft) return
    const agentId = before.agentId
    const requestVersion = before.requestVersion
    const row = useAgentsStore.getState().agents.find((a) => a.id === agentId)
    if (!row || row.isNotTask || row.parseError) return
    const still = (): boolean => {
      const now = useDrawerStore.getState()
      return now.open && now.requestVersion === requestVersion && now.agentId === agentId
    }
    if (!still()) return
    const loaded = row.status !== 'stopped'
    const enabled = !row.isDisabledByOverride
    const running = row.status === 'running'
    const ops = useDrawerStore.getState().ops
    if (ops.loaded !== loaded || ops.enabled !== enabled || ops.running !== running) {
      useDrawerStore.getState().setOps({ loaded, enabled, running })
    }
    const current = useDrawerStore.getState()
    if (!still() || current.tab !== 'status' || !current.statusModel) return
    const extra = useAgentsStore.getState().procExtras[row.id]
    const cpu = extra?.cpu ?? current.statusModel.cpu
    const mem = extra?.mem ?? current.statusModel.mem
    const startTime = extra?.startTime || current.statusModel.startTime
    const next: DrawerStatusModel = {
      ...current.statusModel,
      state: row.status,
      pid: row.pid,
      uptime: row.uptime,
      exitCode: row.exitCode,
      cpu,
      cpuWidth: `${Math.min(100, Number.parseFloat(cpu) || 0)}%`,
      mem,
      memWidth: `${Math.min(100, (Number.parseFloat(mem) || 0) * 10)}%`,
      startTime
    }
    const prevModel = current.statusModel
    const same =
      prevModel.state === next.state &&
      prevModel.pid === next.pid &&
      prevModel.uptime === next.uptime &&
      prevModel.exitCode === next.exitCode &&
      prevModel.cpu === next.cpu &&
      prevModel.mem === next.mem &&
      prevModel.startTime === next.startTime
    if (same || !still()) return
    useDrawerStore.setState({ statusModel: next })
  }
  useAgentsStore.subscribe((s, prev) => {
    if (s.agents !== prev.agents || s.procExtras !== prev.procExtras) followDrawer()
  })

  // 端口服务:main 轮询命中集合变化时推送(阶段 3;页面激活时 3s 一轮)
  window.launcher.onEvent(IPC_EVENTS.servicesUpdated, (payload) => {
    if (payload) useServicesStore.getState().applyPayload(payload as ServicesListPayload)
  })

  // 笔记:目录被外部改动(Obsidian / iCloud / git)时刷新列表,并让当前打开的那篇走冲突流程
  window.launcher.onEvent(IPC_EVENTS.notesChanged, (payload) => {
    const ids = (payload as NotesChangedPayload | undefined)?.ids ?? []
    void useNotesStore.getState().onExternalChange(ids)
  })

  // 应用更新:订阅 main 的状态机。即使从未打开设置页也要初始化 ——
  // 升级完成后的结果提示、ready 后的自动重启倒计时都挂在这里。
  useUpdateStore.getState().init()

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
  // 笔记列表也常驻:三个域的卡片菜单要显示「相关笔记 (N)」,不能等进了笔记页才加载
  void useNotesStore.getState().load().catch((e) => console.error('[bootstrap] notes', e))
}
