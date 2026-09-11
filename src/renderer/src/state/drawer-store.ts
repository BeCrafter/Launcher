// Agent 抽屉状态机(阶段 1:真实 launchctl/plist;demo drawer.js 的状态语义 + 真实 ops/保存/克隆/删除)
// 提权说明窗(应用侧)在此处发起;真实授权由 main 侧 osascript 弹出(密码不进应用)
import { create } from 'zustand'
import type { Agent, AgentForm, DrawerStatusModel, LogLine, OpsState } from '@shared/models'
import type { AgentScope } from '../data/ports'
import { dataSource } from '../data'
import { ELEVATION, confirmDangerous } from '../lib/elevation'
import { showToast } from '../lib/utils'
import { cronErrorToast } from '../lib/cron'
import { useAgentsStore } from './agents-store'
import { makeT, getCurrentLang } from '../i18n'

export type DrawerTab = 'edit' | 'status' | 'log' | 'xml'
export type LogSource = 'file' | 'system'

// demo openEditFloat 的 scopeMap(逐字对应)
const SCOPE_LABEL: Record<AgentScope, string> = {
  user: '用户级 · ~/Library/LaunchAgents',
  system: '全局 · /Library/LaunchAgents',
  daemon: '系统 · /Library/LaunchDaemons'
}

interface DrawerState {
  open: boolean
  agentId: string | null
  agentLabel: string
  scope: AgentScope
  isDraft: boolean
  ops: OpsState
  tab: DrawerTab
  form: AgentForm | null
  statusModel: DrawerStatusModel | null
  logLines: LogLine[]
  logSource: LogSource
  xml: string
  xmlFormMode: boolean
  unsupportedKeys: string[]
  openFor(agent: Agent): Promise<void>
  openDraft(agent: Agent): Promise<void>
  close(): void
  setTab(tab: DrawerTab): void
  updateForm(patch: Partial<AgentForm>): void
  setXml(xml: string): void
  setOps(next: Partial<OpsState>): void
  opsAction(action: 'load' | 'enable' | 'kickstart'): Promise<void>
  save(): Promise<void>
  remove(): Promise<void>
  clone(): Promise<void>
  loadLogs(source: LogSource): Promise<void>
  refreshLogs(): Promise<void>
  clearLog(): Promise<void>
}

const t = (): ((k: string) => string) => makeT(getCurrentLang())

export const useDrawerStore = create<DrawerState>((set, get) => ({
  open: false,
  agentId: null,
  agentLabel: '',
  scope: 'user',
  isDraft: false,
  ops: { loaded: false, enabled: false, running: false },
  tab: 'edit',
  form: null,
  statusModel: null,
  logLines: [],
  logSource: 'file',
  xml: '',
  xmlFormMode: true,
  unsupportedKeys: [],

  // 真实数据装载:表单/状态/XML/日志(文件源)并行读取
  async openFor(agent) {
    useAgentsStore.getState().select(agent.id)
    const [form, statusModel, xmlInfo, logs] = await Promise.all([
      dataSource().agents.readForm(agent.id),
      dataSource().agents.readStatus(agent.id),
      dataSource().agents.readXml(agent.id),
      dataSource().agents.readLogs(agent.id, 'file').catch(() => [])
    ])
    form.label = agent.label
    form.desc = agent.desc
    set({
      open: true,
      agentId: agent.id,
      agentLabel: agent.label,
      scope: agent.scope,
      isDraft: false,
      tab: 'edit',
      form,
      statusModel,
      logLines: logs,
      logSource: 'file',
      xml: xmlInfo.xml,
      xmlFormMode: xmlInfo.formMode,
      unsupportedKeys: xmlInfo.unsupportedKeys,
      ops: {
        loaded: agent.status !== 'stopped' || agent.pid !== null,
        enabled: !agent.isDisabledByOverride,
        running: agent.status === 'running'
      }
    })
  },

  async openDraft(agent) {
    await get().openFor(agent)
    set({ isDraft: true })
    showToast(t()('modal.newAgent.createdOpen').replace('{L}', agent.label), '#a78bfa', 'fa-wand-magic-sparkles')
  },

  close() {
    set({ open: false })
  },

  setTab(tab) {
    set({ tab })
    if (tab === 'status' && get().agentId && !get().isDraft) {
      void dataSource()
        .agents.readStatus(get().agentId!)
        .then((statusModel) => set({ statusModel }))
        .catch(() => {})
    }
    if (tab === 'log') void get().loadLogs(get().logSource)
  },

  updateForm(patch) {
    const form = get().form
    if (form) set({ form: { ...form, ...patch } })
  },

  setXml(xml) {
    set({ xml })
  },

  setOps(next) {
    set({ ops: { ...get().ops, ...next } })
  },

  // 真实 ops:load/unload 与 enable/disable 为开关语义;kickstart 强制立即运行
  async opsAction(action) {
    const s = get()
    if (s.isDraft || !s.agentId) return
    const tr = t()
    try {
      if (s.scope !== 'user') {
        const labels: Record<string, string> = {
          load: tr('drawer.op.load'),
          enable: tr('drawer.op.enable'),
          kickstart: tr('drawer.op.kickstart')
        }
        const ok = await ELEVATION.request({
          detail: tr('elev.ops.detail').replace('{A}', labels[action] ?? action).replace('{L}', s.agentLabel),
          command: `launchctl <domain>/${s.agentLabel}`
        })
        if (!ok) return
      }
      if (action === 'load') {
        const next = await dataSource().agents.ops(s.agentId, s.ops.loaded ? 'unload' : 'load')
        s.setOps(next)
        showToast(s.ops.loaded ? tr('toast.bootoutSuccess') : tr('toast.bootstrapSuccess'), s.ops.loaded ? '#60a5fa' : '#4ade80', 'fa-plug')
      } else if (action === 'enable') {
        if (!s.ops.loaded) {
          showToast(tr('toast.loadFirst'), '#fbbf24', 'fa-circle-exclamation')
          return
        }
        const next = await dataSource().agents.ops(s.agentId, s.ops.enabled ? 'disable' : 'enable')
        s.setOps(next)
        showToast(next.enabled ? tr('toast.taskEnabled') : tr('toast.taskDisabled'), next.enabled ? '#4ade80' : '#fbbf24', next.enabled ? 'fa-circle-check' : 'fa-circle-pause')
      } else {
        if (!s.ops.loaded) {
          showToast(tr('toast.notLoaded'), '#fbbf24', 'fa-circle-exclamation')
          return
        }
        showToast(tr('toast.kickstarting'), '#a78bfa', 'fa-bolt')
        const next = await dataSource().agents.ops(s.agentId, 'kickstart')
        s.setOps(next)
      }
      await useAgentsStore.getState().load()
    } catch (err) {
      cronErrorToast(err, tr)
    }
  },

  // 真实保存:表单 → plist 写盘(main 侧;提权作用域自动走系统授权)
  async save() {
    const s = get()
    if (!s.agentId || !s.form) return
    const tr = t()
    const label = s.form.label.trim() || s.agentLabel
    try {
      if (!s.isDraft && (s.scope === 'system' || s.scope === 'daemon')) {
        const ok = await ELEVATION.request({
          detail: tr('elev.saveAgent.detail').replace('{L}', label),
          command: `写入 ${s.scope === 'daemon' ? '/Library/LaunchDaemons' : '/Library/LaunchAgents'}/${label}.plist`
        })
        if (!ok) return
      }
      const f = s.form
      const agent = await dataSource().agents.save(s.agentId, {
        ...f,
        label,
        desc: f.desc.trim()
      })
      await useAgentsStore.getState().load()
      set({ isDraft: false, agentId: agent.id, agentLabel: agent.label, ops: { loaded: agent.status !== 'stopped', enabled: !agent.isDisabledByOverride, running: agent.status === 'running' } })
      get().close()
      showToast(tr('toast.configSavedReload'), '#4ade80', 'fa-check')
    } catch (err) {
      cronErrorToast(err, tr)
    }
  },

  // 真实删除(危险确认;提权作用域 bootout+rm 合并一次授权,含用户域半状态防护)
  async remove() {
    const s = get()
    if (!s.agentId) return
    const label = s.agentLabel
    const tr = t()
    const detail =
      tr('elev.delete.detail').replace('{L}', label) +
      (s.scope === 'system' || s.scope === 'daemon' ? '（bootout + rm 一次授权）' : '（bootout 后删除）')
    const confirmed = await confirmDangerous.request(detail)
    if (!confirmed) return
    try {
      if (s.scope === 'system' || s.scope === 'daemon') {
        const ok = await ELEVATION.request({
          detail: tr('elev.delete.detail').replace('{L}', label),
          command: `launchctl bootout <domain>/${label}; rm <plist>`
        })
        if (!ok) return
      }
      await dataSource().agents.remove(s.agentId)
      await useAgentsStore.getState().load()
      get().close()
      showToast(tr('toast.deletedTask'), '#f87171', 'fa-trash-can')
    } catch (err) {
      cronErrorToast(err, tr)
    }
  },

  // 真实克隆(读 XML → 替换 Label → 另存 .copy;去重循环在 main)
  async clone() {
    const id = get().agentId
    if (!id) return
    try {
      await dataSource().agents.clone(id)
      await useAgentsStore.getState().load()
      showToast(t()('toast.clonedTask'), '#22d3ee', 'fa-copy')
    } catch (err) {
      cronErrorToast(err, t())
    }
  },

  // 日志加载(文件源 512KB 尾读 / 系统源 log show 15m·2000 行)
  async loadLogs(source) {
    const id = get().agentId
    if (!id || get().isDraft) return
    set({ logSource: source })
    try {
      const lines = await dataSource().agents.readLogs(id, source)
      if (get().agentId === id) set({ logLines: lines })
    } catch (err) {
      cronErrorToast(err, t())
    }
  },

  async refreshLogs() {
    await get().loadLogs(get().logSource)
  },

  // 清空 = 写空串到 stdout/stderr 文件(开源同款语义)
  async clearLog() {
    const id = get().agentId
    if (!id || get().isDraft) return
    await dataSource().agents.clearLogs(id)
    set({ logLines: [] })
  }
}))
