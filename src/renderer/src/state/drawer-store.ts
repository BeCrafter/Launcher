// Agent 抽屉状态机(阶段 1:真实 launchctl/plist;demo drawer.js 的状态语义 + 真实 ops/保存/克隆/删除)
// 提权说明窗(应用侧)在此处发起;真实授权由 main 侧 osascript 弹出(密码不进应用)
import { create } from 'zustand'
import type { Agent, AgentForm, DrawerStatusModel, LogLine, OpsState } from '@shared/models'
import type { AgentScope } from '../data/ports'
import { dataSource } from '../data'
import { ELEVATION, confirmDangerous } from '../lib/elevation'
import { showToast } from '../lib/utils'
import { runAgentIntent } from '../lib/agent-ops'
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
  /** 表单编辑历史(撤销栈,上限 50;openFor 时清空) */
  formHistory: AgentForm[]
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
  undoForm(): void
  setXml(xml: string): void
  setOps(next: Partial<OpsState>): void
  opsAction(action: DrawerAction): Promise<void>
  save(): Promise<void>
  remove(): Promise<void>
  clone(): Promise<void>
  loadLogs(source: LogSource): Promise<void>
  refreshLogs(): Promise<void>
  clearLog(): Promise<void>
}

const t = (): ((k: string) => string) => makeT(getCurrentLang())

/** 抽屉头部的意图动作(用户语义) */
export type DrawerAction = 'start' | 'stop' | 'restart' | 'autostart'

export const useDrawerStore = create<DrawerState>((set, get) => ({
  open: false,
  agentId: null,
  agentLabel: '',
  scope: 'user',
  isDraft: false,
  ops: { loaded: false, enabled: false, running: false },
  tab: 'edit',
  form: null,
  formHistory: [],
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
      formHistory: [],
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
    if (!form) return
    const history = [...get().formHistory, form]
    if (history.length > 50) history.shift()
    set({ form: { ...form, ...patch }, formHistory: history })
  },

  // 撤销上一次表单编辑(栈空 → 无操作;按钮侧禁用)
  undoForm() {
    const history = get().formHistory
    if (history.length === 0) return
    set({ form: history[history.length - 1], formHistory: history.slice(0, -1) })
    showToast(t()('toast.undone'), '#888888', 'fa-rotate-left')
  },

  setXml(xml) {
    set({ xml })
  },

  setOps(next) {
    set({ ops: { ...get().ops, ...next } })
  },

  // 意图动作:交互外壳(提权/询问/toast)在 lib/agent-ops 统一实现,抽屉与列表卡片共用同一份
  async opsAction(action) {
    const s = get()
    if (s.isDraft || !s.agentId) return
    const agent = useAgentsStore.getState().agents.find((a) => a.id === s.agentId)
    if (!agent) return
    const next = await runAgentIntent(agent, action)
    if (!next) return
    s.setOps(next) // 列表刷新由 lib/agent-ops 统一负责
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
