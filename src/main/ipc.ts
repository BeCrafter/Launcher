// IPC 注册:settings 读写重置 / app 信息 / 外链打开 / Agent 角标计数 / 定时任务(阶段 2);设置变更广播到所有窗口

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import {
  IPC,
  IPC_EVENTS,
  type AppInfo,
  type ContainerAction,
  type ServicesListPayload,
  type SettingsPatch
} from '../shared/ipc'
import { isAllowedExternalUrl } from '../shared/url-guard'
import type { AgentForm, AgentScope, CronJob, CronScope } from '../shared/models'
import type { AgentService } from './services/agent-service'
import { checkForUpdate } from './services/update-check'
import type { CrontabService } from './services/crontab-service'
import type { DockerService } from './services/docker-service'
import type { ProcessDiscovery, ScanResult } from './services/process-discovery'
import type { TerminationService } from './services/termination'
import type { SettingsStore } from './settings/store'
import type { TrayController } from './settings/types'

export interface IpcDeps {
  store: SettingsStore
  tray: TrayController
  agents: AgentService
  cron: CrontabService
  discovery: ProcessDiscovery
  termination: TerminationService
  docker: DockerService
}

export function registerIpc(deps: IpcDeps): void {
  const { store } = deps

  const toServicesPayload = (r: ScanResult): ServicesListPayload => ({
    services: r.services,
    brewServices: r.brewServices,
    containers: r.containers,
    dockerAvailable: r.dockerAvailable,
    polling: deps.discovery.polling,
    scannedAt: r.scannedAt
  })
  const findService = (id: string): { pid?: number; cmd: string } | undefined =>
    deps.discovery.getLast().services.find((s) => s.id === id)
  ipcMain.handle(IPC.settingsGet, () => store.get())

  ipcMain.handle(IPC.settingsSet, (_e, patch: SettingsPatch) => {
    return store.save(patch ?? {})
  })

  ipcMain.handle(IPC.settingsReset, () => store.reset())

  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    arch: process.arch,
    platform: process.platform,
    version: app.getVersion(),
    isPackaged: app.isPackaged
  }))

  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (!isAllowedExternalUrl(url)) {
      throw new Error(`blocked external url: ${String(url)}`)
    }
    console.log(`[ipc] openExternal ${url}`)
    return shell.openExternal(url)
  })

  // renderer 上报运行中 Agent 计数(menubarBadge 角标;数据在 renderer,阶段 1 换真实源后 main 自算)
  ipcMain.handle(IPC.agentsBadge, (_e, count: unknown) => {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 999) {
      throw new Error(`invalid badge count: ${String(count)}`)
    }
    deps.tray.setBadgeCount(count)
  })

  // 检查更新:main 侧请求 GitHub Releases(8s 超时;四态见 services/update-check.ts)
  ipcMain.handle(IPC.appCheckUpdates, () => checkForUpdate(app.getVersion()))

  // ── Launch Agents(阶段 1) ──
  ipcMain.handle(IPC.agList, () => deps.agents.list())
  ipcMain.handle(IPC.agToggle, (_e, id: string) => deps.agents.toggle(id))
  ipcMain.handle(IPC.agBrewAction, (_e, kind: 'start' | 'stop', id: string) => deps.agents.brewAction(kind, id))
  ipcMain.handle(IPC.agCreateDraft, (_e, scope: AgentScope, label: string) => deps.agents.createDraft(scope, label))
  ipcMain.handle(IPC.agSave, (_e, id: string, patch: Partial<AgentForm> & { label: string; desc: string }) =>
    deps.agents.save(id, patch)
  )
  ipcMain.handle(IPC.agRemove, (_e, id: string) => deps.agents.remove(id))
  ipcMain.handle(IPC.agClone, (_e, id: string) => deps.agents.clone(id))
  ipcMain.handle(IPC.agOps, (_e, id: string, action: 'load' | 'unload' | 'enable' | 'disable' | 'kickstart') => deps.agents.ops(id, action))
  ipcMain.handle(IPC.agReadForm, (_e, id: string) => deps.agents.readForm(id))
  ipcMain.handle(IPC.agReadXml, (_e, id: string) => deps.agents.readXml(id))
  ipcMain.handle(IPC.agSaveXml, (_e, id: string, xml: string) => deps.agents.saveXml(id, xml))
  ipcMain.handle(IPC.agReadStatus, (_e, id: string) => deps.agents.readStatus(id))
  ipcMain.handle(IPC.agReadLogs, (_e, id: string, source: 'file' | 'system') => deps.agents.readLogs(id, source))
  ipcMain.handle(IPC.agClearLogs, (_e, id: string) => deps.agents.clearLogs(id))
  ipcMain.handle(IPC.agValidateXml, (_e, xml: string) => deps.agents.validateXml(xml))
  ipcMain.handle(IPC.agRemoveInvalid, (_e, path: string) => deps.agents.removeInvalid(path))

  // ── 定时任务(阶段 2) ──
  ipcMain.handle(IPC.cronList, () => deps.cron.list())
  ipcMain.handle(IPC.cronCreate, (_e, job: Omit<CronJob, 'id'>) => deps.cron.create(job))
  ipcMain.handle(IPC.cronUpdate, (_e, job: CronJob, patch: Partial<CronJob>) => deps.cron.update(job, patch))
  ipcMain.handle(IPC.cronRemove, (_e, job: CronJob) => deps.cron.remove(job))
  ipcMain.handle(IPC.cronReadLog, (_e, id: string) => deps.cron.readLog(id))
  ipcMain.handle(IPC.cronWriteHeader, (_e, scope: CronScope, text: string) => deps.cron.writeHeader(scope, text))

  // ── 端口服务(阶段 3) ──
  ipcMain.handle(IPC.svcList, async () => {
    const r = await deps.discovery.scanOnce()
    return toServicesPayload(r)
  })
  ipcMain.handle(IPC.svcKill, async (_e, id: string, opts?: { privileged?: boolean }) => {
    const pid = Number.parseInt(id.split(':')[0], 10)
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`invalid service id: ${id}`)
    const outcome = await deps.termination.kill(pid, opts)
    void deps.discovery.scanOnce() // 立即反映(不等下一轮轮询)
    return outcome
  })
  ipcMain.handle(IPC.svcRestart, async (_e, id: string) => {
    const job = findService(id)
    if (!job) return { ok: false, newPid: null, error: 'notFound' }
    const r = await deps.termination.restart(job.pid ?? 0, job.cmd)
    void deps.discovery.scanOnce()
    return r
  })
  ipcMain.handle(IPC.svcContainerAction, async (_e, id: string, action: ContainerAction) => {
    await deps.docker.action(id, action)
    void deps.discovery.scanOnce()
  })
  ipcMain.handle(IPC.svcSetPolling, async (_e, enabled: boolean) => {
    deps.discovery.setPolling(enabled)
    const r = await deps.discovery.scanOnce()
    return toServicesPayload(r)
  })
  ipcMain.handle(IPC.svcSetActive, (_e, active: boolean) => {
    deps.discovery.setActive(active)
  })

  // 设置任意写入(main 自身 applier 或 renderer patch)后广播
  store.onChange((s) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC_EVENTS.settingsChanged, s)
    }
  })

  // cronLogRetainDays 变更 → 立即执行一次日志清理(不必等下一次 list 的节流窗口)
  let lastRetainDays = store.get().cronLogRetainDays
  store.onChange((s) => {
    if (s.cronLogRetainDays !== lastRetainDays) {
      lastRetainDays = s.cronLogRetainDays
      void deps.cron.cleanupLogs()
    }
  })
}
