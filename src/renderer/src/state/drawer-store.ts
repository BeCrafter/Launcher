// Agent 抽屉状态机(demo drawer.js 的 drawerAgentState + openEditFloat/saveFloatAgent/drawerOpsAction/dpAction)
// 提权分流在此处;toast 文案与 demo 逐字对齐
import { create } from 'zustand'
import type { Agent, AgentForm, DrawerStatusModel, LogLine, OpsState } from '@shared/models'
import type { AgentScope } from '../data/ports'
import { dataSource } from '../data'
import { MOCK_DATA } from '../data/mock/mock-data'
import { nowTs } from '../data/mock/mock-source'
import { ELEVATION, confirmDangerous } from '../lib/elevation'
import { showToast } from '../lib/utils'
import { useAgentsStore } from './agents-store'
import { makeT, getCurrentLang } from '../i18n'

export type DrawerTab = 'edit' | 'status' | 'log' | 'xml'

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
  xml: string
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
  addLogLine(type: LogLine['type'], text: string): void
  clearLog(): void
  pushLogLine(line: LogLine): void
}

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
  xml: '',

  // demo openEditFloat:填充表单(阶段 1 前共用 MOCK_DATA.drawer 表单)+ 推导 ops 三态
  async openFor(agent) {
    const t = makeT(getCurrentLang())
    useAgentsStore.getState().select(agent.id)
    const [form, statusModel] = await Promise.all([
      dataSource().agents.readForm(agent.id),
      dataSource().agents.readStatus(agent.id)
    ])
    // 表单前 3 字段取自当前 agent(demo setVal 行为)
    form.label = agent.label
    form.desc = agent.desc
    form.program = agent.program || ''
    set({
      open: true,
      agentId: agent.id,
      agentLabel: agent.label,
      scope: agent.scope,
      isDraft: false,
      tab: 'edit',
      form,
      statusModel,
      // 初始日志行(demo populateDrawerDefaults:MOCK_DATA.drawer.logLines)
      logLines: MOCK_DATA.drawer.logLines.map(([ts, type, text]) => ({ ts, type, text })),
      ops: {
        loaded: agent.status !== 'stopped' || !!agent.pid,
        enabled: true,
        running: agent.status === 'running'
      },
      // XML tab 原文(demo populateDrawerDefaults:MOCK_DATA.drawer.xml;按 agent 区分属后端阶段)
      xml: MOCK_DATA.drawer.xml
    })
    void t
  },

  // demo openAgentDraft 尾段:isDraft=true,ops 禁用
  async openDraft(agent) {
    await get().openFor(agent)
    set({ isDraft: true })
    showToast(makeT(getCurrentLang())('modal.newAgent.createdOpen').replace('{L}', agent.label), '#a78bfa', 'fa-wand-magic-sparkles')
  },

  close() {
    set({ open: false })
  },

  setTab(tab) {
    set({ tab })
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

  // demo drawerOpsAction(提权分流 + toast + 日志副作用,逐字对齐)
  async opsAction(action) {
    const s = get()
    if (s.isDraft) return
    const t = makeT(getCurrentLang())
    if (s.scope === 'system' || s.scope === 'daemon') {
      const labels: Record<string, string> = {
        load: t('drawer.op.load'),
        enable: t('drawer.op.enable'),
        kickstart: t('drawer.op.kickstart')
      }
      const ok = await ELEVATION.request({
        detail: t('elev.ops.detail').replace('{A}', labels[action] ?? action).replace('{L}', s.agentLabel),
        command: `osascript -e 'do shell script "launchctl ${action === 'load' ? 'bootout' : action} ${s.agentLabel}" with administrator privileges'`
      })
      if (!ok) return
    }
    if (action === 'load') {
      if (s.ops.loaded) {
        s.setOps({ loaded: false, running: false })
        showToast(t('toast.bootoutSuccess'), '#60a5fa', 'fa-plug-circle-xmark')
        get().addLogLine('info', '[INFO] bootout: task unloaded.')
      } else {
        s.setOps({ loaded: true, enabled: true, running: false })
        showToast(t('toast.bootstrapSuccess'), '#4ade80', 'fa-plug')
        get().addLogLine('ok', '[OK] bootstrap: task loaded.')
      }
    } else if (action === 'enable') {
      if (!s.ops.loaded) {
        showToast(t('toast.loadFirst'), '#fbbf24', 'fa-circle-exclamation')
        return
      }
      if (s.ops.enabled) {
        s.setOps({ enabled: false, running: false })
        showToast(t('toast.taskDisabled'), '#fbbf24', 'fa-circle-pause')
        get().addLogLine('warn', '[WARN] disabled: Disabled=true.')
      } else {
        s.setOps({ enabled: true })
        showToast(t('toast.taskEnabled'), '#4ade80', 'fa-circle-check')
        get().addLogLine('ok', '[OK] enabled.')
      }
    } else if (action === 'kickstart') {
      if (!s.ops.loaded) {
        showToast(t('toast.notLoaded'), '#fbbf24', 'fa-circle-exclamation')
        return
      }
      s.setOps({ running: true })
      showToast(t('toast.kickstarting'), '#a78bfa', 'fa-bolt')
      get().addLogLine('info', '[INFO] kickstart: forcing immediate run…')
      setTimeout(
        () => get().addLogLine('ok', '[OK] kickstart: started. PID=' + (Math.floor(Math.random() * 8000) + 2000)),
        600
      )
    }
  },

  // demo saveFloatAgent(提权 + 回写 + 脱草稿态)
  async save() {
    const s = get()
    if (!s.agentId) return
    const entry = useAgentsStore.getState().agents.find((x) => x.id === s.agentId)
    if (!entry) return
    const t = makeT(getCurrentLang())
    const label = s.form?.label?.trim() || entry.label
    if (s.scope === 'system' || s.scope === 'daemon') {
      const ok = await ELEVATION.request({
        detail: t('elev.saveAgent.detail').replace('{L}', label),
        command: `mkdir -p ${s.scope === 'daemon' ? '/Library/LaunchDaemons' : '/Library/LaunchAgents'} && plutil -lint /Library/LaunchAgents/${label}.plist`
      })
      if (!ok) return
    }
    await dataSource().agents.save(s.agentId, {
      label,
      desc: s.form?.desc?.trim() ?? '',
      program: s.form?.program?.trim() ?? ''
    })
    await useAgentsStore.getState().load()
    // 保存后脱离草稿态:plist 已落地但尚未 bootstrap
    set({ isDraft: false, ops: { loaded: false, enabled: false, running: false }, agentLabel: label })
    get().close()
    showToast(t('toast.configSavedReload'), '#4ade80', 'fa-check')
    get().addLogLine('ok', '[OK] Config saved. Reloading…')
  },

  // demo dpAction('delete'):危险确认 + 系统级提权(bootout+rm 一次授权)
  async remove() {
    const s = get()
    if (!s.agentId) return
    const label = s.agentLabel
    const t = makeT(getCurrentLang())
    const detail =
      t('elev.delete.detail').replace('{L}', label) +
      (s.scope === 'system' || s.scope === 'daemon' ? '（bootout + rm 一次授权）' : '（bootout 后删除）')
    const confirmed = await confirmDangerous.request(detail)
    if (!confirmed) return
    if (s.scope === 'system' || s.scope === 'daemon') {
      const ok = await ELEVATION.request({
        detail: t('elev.delete.detail').replace('{L}', label),
        command: `osascript -e 'do shell script "launchctl bootout ${s.scope === 'daemon' ? 'system' : 'gui'}/${label} && rm -f ${s.scope === 'daemon' ? '/Library/LaunchDaemons' : '/Library/LaunchAgents'}/${label}.plist" with administrator privileges'`
      })
      if (!ok) return
    }
    await dataSource().agents.remove(s.agentId)
    await useAgentsStore.getState().load()
    get().close()
    showToast(t('toast.deletedTask'), '#f87171', 'fa-trash-can')
    get().addLogLine('warn', `[WARN] deleted: ${label}`)
  },

  // demo dpAction('clone'):'.copy' 去重循环
  async clone() {
    const id = get().agentId
    if (!id) return
    await dataSource().agents.clone(id)
    await useAgentsStore.getState().load()
    showToast(makeT(getCurrentLang())('toast.clonedTask'), '#22d3ee', 'fa-copy')
  },

  addLogLine(type, text) {
    set({ logLines: [...get().logLines, { ts: nowTs(), type, text }] })
  },

  clearLog() {
    const t = makeT(getCurrentLang())
    set({ logLines: [{ ts: nowTs(), type: '', text: '日志已清空' }] })
    void t
  },

  pushLogLine(line) {
    set({ logLines: [...get().logLines, line] })
  }
}))
