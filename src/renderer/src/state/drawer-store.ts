// Agent 抽屉状态机(阶段 1:真实 launchctl/plist;demo drawer.js 的状态语义 + 真实 ops/保存/克隆/删除)
// 提权说明窗(应用侧)在此处发起;真实授权由 main 侧 osascript 弹出(密码不进应用)
// 2026-09-18 文档模型(整改规范 P0-2/P0-3/P0-4/P1-1):所有写入走 saveForm/saveXml + expectedRevision(CAS),
//   成功后以 main 返回的 AgentDocument **整体替换**状态(表单快照/原文/兼容报告/revision 一起刷新,撤销栈清空);
//   冲突不静默覆盖,由用户选择「重新加载」或「保留我的改动」。
import { create } from 'zustand'
import type { Agent, AgentDocument, AgentForm, ApplyMode, DrawerStatusModel, LogLine, OpsState, SaveOutcome } from '@shared/models'
import type { AgentScope } from '../data/ports'
import { dataSource } from '../data'
import { ELEVATION, confirmDangerous } from '../lib/elevation'
import { CHOICE } from '../lib/choice'
import { showToast } from '../lib/utils'
import { runAgentIntent } from '../lib/agent-ops'
import { cronErrorToast } from '../lib/cron'
import { agentErrorToast } from '../lib/ipc-error'
import { useAgentsStore } from './agents-store'
import { keepAlivePreset } from '../lib/keep-alive'
import { fmt, makeT, getCurrentLang } from '../i18n'

export type DrawerTab = 'edit' | 'status' | 'log' | 'xml'
export type LogSource = 'file' | 'system'

interface DrawerState {
  open: boolean
  /** 每次打开/关闭递增；异步读取、授权和保存返回时必须匹配，避免 A 覆盖或关闭后来打开的 B。 */
  requestVersion: number
  agentId: string | null
  agentLabel: string
  /** 非任务文件的原文件名(label 为空时作展示名;保存说明句用它,因为原地重写不改名) */
  agentFile: string
  scope: AgentScope
  isDraft: boolean
  /** 文件在但不是 launchd 任务(缺 Label):可编辑,补上 Label 即成为任务;启停禁用 */
  isNotTask: boolean
  /** plist 无法解析:编辑走 XML 修复模式 */
  isBroken: boolean
  ops: OpsState
  tab: DrawerTab
  /** 最近一次读取/写入的文档(revision 与兼容报告的唯一来源) */
  document: AgentDocument | null
  /** 本地编辑副本(用户改动;保存时只把脏字段发给 main) */
  form: AgentForm | null
  /** 表单编辑历史(撤销栈,上限 50;写入成功或重新装载时清空) */
  formHistory: AgentForm[]
  /** 用户触碰过的表单字段名(P1-1:服务端只覆盖这些键,其余取保存时的磁盘最新值) */
  dirtyFields: string[]
  /** 日志请求版本:清空成功后递增,使「清空之前发起、之后返回」的读取失效 */
  logRequestVersion: number
  statusModel: DrawerStatusModel | null
  logLines: LogLine[]
  logSource: LogSource
  /**
   * KeepAlive 条件编辑器模式位(纯 UI,不进表单/plist):选过「自定义条件」后保持,直到再选具名预设。
   * 不能只靠 keepAlivePreset() 派生 —— 自定义形态一旦恰好等于某个具名预设(如只勾 Crashed=是),
   * 派生值立刻变回该预设名,编辑器会在用户点第一个 chip 时整块消失。
   */
  kaCustom: boolean
  xml: string
  openFor(agent: Agent): Promise<void>
  openDraft(agent: Agent): Promise<void>
  close(): void
  setTab(tab: DrawerTab): void
  updateForm(patch: Partial<AgentForm>): void
  undoForm(): void
  setXml(xml: string): void
  setKaCustom(v: boolean): void
  /** 写入成功 / 冲突裁决「重新加载」后:用 main 返回的文档整体替换状态(P0-3) */
  applyDocumentImpl(doc: AgentDocument): void
  setOps(next: Partial<OpsState>): void
  opsAction(action: DrawerAction): Promise<void>
  /** P0-2:save 只写文件;saveAndApply 额外把「保存前已载入」的任务重新载入(不主动运行) */
  save(applyMode: ApplyMode): Promise<void>
  saveXml(applyMode: ApplyMode): Promise<void>
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
  requestVersion: 0,
  agentId: null,
  agentLabel: '',
  agentFile: '',
  scope: 'user',
  isDraft: false,
  isNotTask: false,
  isBroken: false,
  ops: { loaded: false, enabled: false, running: false },
  tab: 'edit',
  document: null,
  form: null,
  formHistory: [],
  dirtyFields: [],
  logRequestVersion: 0,
  statusModel: null,
  logLines: [],
  logSource: 'file',
  kaCustom: false,
  xml: '',

  /** 文档 → 状态整体替换(P0-3):表单快照/原文/兼容报告/revision/身份一起换,撤销栈清空 */
  applyDocumentImpl(doc: AgentDocument): void {
    const listed = useAgentsStore.getState().agents.find((a) => a.id === doc.id)
    set({
      document: doc,
      agentId: doc.id,
      // ⚠ 不 trim:agentLabel 兼作「未编辑时的身份来源」,trim 会把含首尾空白的历史 Label 变成改名
      agentLabel: doc.form?.label || listed?.label || listed?.fileName || get().agentLabel,
      agentFile: listed?.fileName ?? get().agentFile,
      scope: doc.scope,
      isNotTask: !!listed?.isNotTask,
      isBroken: doc.form === null,
      form: doc.form ? { ...doc.form } : null,
      xml: doc.sourceXml,
      formHistory: [],
      dirtyFields: []
    })
  },

  // 真实数据装载:文档 + 状态 + 日志(文件源)并行读取
  async openFor(agent) {
    const requestVersion = get().requestVersion + 1
    // 先递增版本再发请求：后打开的抽屉会使此前慢请求失效。
    set({ requestVersion })
    useAgentsStore.getState().select(agent.id)
    // 每个读调用各自兜底:Promise.all 任一 reject 会让抽屉静默不开(损坏文件正是可能读不出来的那类)
    const [doc, statusModel, logs] = await Promise.all([
      dataSource().agents.readDocument(agent.id).catch(() => null),
      dataSource().agents.readStatus(agent.id).catch(() => null),
      dataSource().agents.readLogs(agent.id, 'file').catch(() => [])
    ])
    // A 请求完成前用户若已打开/关闭 B，绝不能回写 A 的文档、日志或 tab。
    if (get().requestVersion !== requestVersion) return
    const broken = !!agent.parseError
    set({
      open: true,
      agentId: agent.id,
      // 非任务/损坏文件没有 label:展示名与删除确认都退到文件名
      agentLabel: agent.label || agent.fileName || '',
      agentFile: agent.fileName ?? '',
      scope: agent.scope,
      isDraft: false,
      isNotTask: !!agent.isNotTask,
      isBroken: broken,
      // 损坏文件没有可解析的字典,表单无从填起 → 直接落到 XML 修复入口
      tab: broken ? 'xml' : 'edit',
      document: doc,
      // 损坏文件 main 侧就返回 form:null(空字典映射出的空表单既不是文件内容、保存也只会写坏文件)
      form: doc?.form ?? null,
      // 打开时按磁盘形态取初值:形态不落在任何具名预设上 → 直接进自定义模式
      kaCustom: doc?.form ? keepAlivePreset(doc.form) === 'custom' : false,
      formHistory: [],
      dirtyFields: [],
      statusModel,
      logLines: logs,
      logSource: 'file',
      logRequestVersion: get().logRequestVersion + 1,
      xml: doc?.sourceXml ?? '',
      ops: {
        loaded: agent.status !== 'stopped' || agent.pid !== null,
        enabled: !agent.isDisabledByOverride,
        running: agent.status === 'running'
      }
    })
  },

  async openDraft(agent) {
    await get().openFor(agent)
    // openFor 可能被另一次打开请求取代；只把仍是本草稿的抽屉标为草稿。
    if (get().open && get().agentId === agent.id) set({ isDraft: true })
    else return
    showToast(t()('modal.newAgent.createdOpen').replace('{L}', agent.label), '#a78bfa', 'fa-wand-magic-sparkles')
  },

  close() {
    // 使进行中的 open/save/remove 回调失效，避免关闭后又被旧请求重新写开。
    set({ open: false, requestVersion: get().requestVersion + 1 })
  },

  setTab(tab) {
    set({ tab })
    const s = get()
    if (tab === 'status' && s.agentId && !s.isDraft) {
      const id = s.agentId
      const requestVersion = s.requestVersion
      void dataSource()
        .agents
        .readStatus(id)
        .then((statusModel) => {
          const now = get()
          // 慢响应可能属于「上一份文档/上一次打开」:版本或身份不符就丢弃
          if (now.open && now.requestVersion === requestVersion && now.agentId === id) set({ statusModel })
        })
        .catch(() => {})
    }
    if (tab === 'log') void get().loadLogs(get().logSource)
  },

  updateForm(patch) {
    const form = get().form
    if (!form) return
    const history = [...get().formHistory, form]
    if (history.length > 50) history.shift()
    const dirty = new Set(get().dirtyFields)
    for (const k of Object.keys(patch)) dirty.add(k)
    set({ form: { ...form, ...patch }, formHistory: history, dirtyFields: [...dirty] })
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

  setKaCustom(v) {
    set({ kaCustom: v })
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
    const requestVersion = s.requestVersion
    const agentId = s.agentId
    const next = await runAgentIntent(agent, action)
    if (!next) return
    const now = get()
    if (now.open && now.requestVersion === requestVersion && now.agentId === agentId) {
      now.setOps(next) // 列表刷新由 lib/agent-ops 统一负责
    }
  },

  // P0-2:表单保存 —— 只发脏字段;save 不动运行态,saveAndApply 只把「保存前已载入」的任务重新载入
  async save(applyMode) {
    const s = get()
    if (!s.agentId || !s.form || !s.document) return
    const requestVersion = s.requestVersion
    const isCurrent = (): boolean => {
      const now = get()
      return now.open && now.requestVersion === requestVersion && now.agentId === s.agentId
    }
    const tr = t()
    // 未编辑 Label 的既有任务必须保留**磁盘原值**(来自 document,而非可能被 trim 过的展示串);
    // 否则含首尾空白的历史 Label 会被误判为改名。
    const labelEdited = s.dirtyFields.includes('label')
    const typed = labelEdited ? s.form.label.trim() : (s.document?.form?.label ?? s.agentLabel)
    // 非任务文件必须补上 Label:否则落盘后仍是一行置灰,与「保存失败」无从区分
    if (s.isNotTask && typed === '') {
      showToast(tr('agents.notTask.labelRequired'), '#eec04d', 'fa-triangle-exclamation')
      return
    }
    const label = typed || s.agentLabel
    // P1-4:新建(草稿)首次组合出「需要解释的运行效果」时显式确认一次(既有配置只提示不拦)
    if (s.isDraft) {
      const notes: string[] = []
      if (s.form.triggers.keepAlive &&
        (typeof s.form.triggers.startInterval === 'number' && s.form.triggers.startInterval > 0) ||
        s.form.triggers.keepAlive && (s.form.triggers.startCalendarInterval || s.form.triggers.watchPaths)) {
        notes.push(tr('cfg.keepAlive.conflict'))
      }
      if (s.form.triggers.startCalendarInterval && s.form.sciEntries.some((e) => Object.keys(e).length === 0)) {
        notes.push(tr('sci.empty.confirmNote'))
      }
      if (notes.length > 0) {
        const picked = await CHOICE.request({
          header: tr('newConfirm.header'),
          title: notes.join('\n'),
          options: [
            { label: tr('newConfirm.ok'), value: 'go' },
            { label: tr('newConfirm.back'), value: 'back' }
          ]
        })
        if (picked !== 'go' || !isCurrent()) return
      }
    }
    if (!isCurrent()) return
    const dirty = s.dirtyFields
      const patch: Record<string, unknown> = {}
      for (const k of dirty) patch[k] = (s.form as unknown as Record<string, unknown>)[k]
    // 身份以 label 字段为准。已存在任务的 Label 改动必须走专用迁移事务；
    // 其余情况(草稿/非任务转正/原值未变)仍由 saveForm 处理。
    patch.label = typed
    const isExistingTaskRename = !s.isDraft && !s.isNotTask && labelEdited && typed !== (s.document.form?.label ?? s.agentLabel)
    try {
      // 草稿同样要过这道闸口:新建一个落在 /Library/LaunchDaemons 或 /Library/LaunchAgents 的 agent
      // 正是最该解释的高危操作,此前被 !s.isDraft 排除在外 → 只弹一个没有任何上下文的系统密码框
      if (s.scope !== 'user') {
        // 非任务文件是原地重写、保留原文件名(不会产生 <Label>.plist),说明句必须照实说
        const fileName = s.isNotTask ? s.agentFile : `${label}.plist`
        const ok = await ELEVATION.request({
          detail: tr('elev.saveAgent.detail').replace('{L}', label),
          command: `写入 ${s.scope === 'daemon' ? '/Library/LaunchDaemons' : '/Library/LaunchAgents'}/${fileName}`
        })
        if (!ok || !isCurrent()) return
      }
      const outcome = isExistingTaskRename
        ? await dataSource().agents.renameAgent({
            id: s.agentId,
            expectedRevision: s.document.revision,
            newLabel: typed,
            dirtyFields: [...dirty].filter((k) => k !== 'label'),
            patch: Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'label')) as never,
            applyMode
          })
        : await dataSource().agents.saveForm({
            id: s.agentId,
            expectedRevision: s.document.revision,
            dirtyFields: dirty,
            patch: patch as never,
            applyMode
          })
      if (!isCurrent() || !(await handleOutcome(outcome, applyMode, isCurrent))) return
      if (s.scope !== 'user') ELEVATION.noteSuccess()
      set({ isDraft: false })
      get().close()
    } catch (err) {
      agentErrorToast(err, tr)
    }
  },

  // XML 保存(P0-3):成功后用 main 返回的整份文档替换状态,避免「表单快照仍是旧的」
  async saveXml(applyMode) {
    const s = get()
    if (!s.agentId || !s.document || s.xml === '') return
    const requestVersion = s.requestVersion
    const isCurrent = (): boolean => {
      const now = get()
      return now.open && now.requestVersion === requestVersion && now.agentId === s.agentId
    }
    const tr = t()
    try {
      if (s.scope !== 'user') {
        const ok = await ELEVATION.request({
          detail: tr('elev.saveAgent.detail').replace('{L}', s.agentLabel),
          command: tr('xml.saveHint')
        })
        if (!ok || !isCurrent()) return
      }
      const outcome = await dataSource().agents.saveXml({
        id: s.agentId,
        expectedRevision: s.document.revision,
        xml: s.xml,
        applyMode
      })
      if (!isCurrent() || !(await handleOutcome(outcome, applyMode, isCurrent))) return
      if (s.scope !== 'user') ELEVATION.noteSuccess()
      // XML 草稿落盘后已成为正式 Agent，必须解除草稿门控。
      if (isCurrent()) set({ isDraft: false })
    } catch (err) {
      agentErrorToast(err, tr)
    }
  },

  // 真实删除(危险确认;提权作用域 bootout+rm 合并一次授权,含用户域半状态防护)+ CAS
  async remove() {
    const s = get()
    if (!s.agentId) return
    const requestVersion = s.requestVersion
    const isCurrent = (): boolean => {
      const now = get()
      return now.open && now.requestVersion === requestVersion && now.agentId === s.agentId
    }
    const label = s.agentLabel
    const tr = t()
    const detail =
      tr('elev.delete.detail').replace('{L}', label) +
      (s.scope === 'system' || s.scope === 'daemon' ? '（bootout + rm 一次授权）' : '（bootout 后删除）')
    const confirmed = await confirmDangerous.request(detail)
    if (!confirmed || !isCurrent()) return
    try {
      if (s.scope === 'system' || s.scope === 'daemon') {
        const ok = await ELEVATION.request({
          detail: tr('elev.delete.detail').replace('{L}', label),
          command: `launchctl bootout <domain>/${label}; rm <plist>`
        })
        if (!ok || !isCurrent()) return
      }
      if (!s.document) {
        showToast(tr('drawer.reloadFirst'), '#fbbf24', 'fa-triangle-exclamation')
        return
      }
      const outcome = await dataSource().agents.remove(s.agentId, s.document.revision)
      if (!isCurrent() || !(await handleOutcome(outcome, 'save', isCurrent))) return
      await useAgentsStore.getState().load()
      if (!isCurrent()) return
      get().close()
      showToast(tr('toast.deletedTask'), '#f87171', 'fa-trash-can')
    } catch (err) {
      agentErrorToast(err, tr)
    }
  },

  // 真实克隆(读 XML → 替换 Label → 另存 .copy;去重与保真判据在 main,带 revision 防克隆旧快照)
  async clone() {
    const s = get()
    if (!s.agentId || !s.document) return
    const tr = t()
    try {
      const outcome = await dataSource().agents.clone({ id: s.agentId, expectedRevision: s.document.revision })
      if (!outcome.ok) {
        showToast(outcome.message.slice(0, 180), '#f87171', 'fa-circle-exclamation')
        return
      }
      await useAgentsStore.getState().load()
      showToast(tr('toast.clonedTask'), '#22d3ee', 'fa-copy')
    } catch (err) {
      agentErrorToast(err, tr)
    }
  },

  // 日志加载(文件源 512KB 尾读 / 系统源 log show 15m·2000 行)
  async loadLogs(source) {
    const s = get()
    const id = s.agentId
    if (!id || s.isDraft) return
    const requestVersion = s.requestVersion
    const logVersion = s.logRequestVersion
    set({ logSource: source })
    try {
      const lines = await dataSource().agents.readLogs(id, source)
      const now = get()
      // 快速切 file/system、换 agent,或期间发生过清空 → 旧响应不得覆盖当前列表
      if (
        now.open &&
        now.requestVersion === requestVersion &&
        now.agentId === id &&
        now.logSource === source &&
        now.logRequestVersion === logVersion
      ) {
        set({ logLines: lines })
      }
    } catch (err) {
      cronErrorToast(err, t())
    }
  },

  async refreshLogs() {
    await get().loadLogs(get().logSource)
  },

  // 清空 = 写空串到 stdout/stderr 文件(开源同款语义);完成后仅在仍是同一抽屉请求时清空列表
  async clearLog() {
    const s = get()
    const id = s.agentId
    if (!id || s.isDraft) return
    const requestVersion = s.requestVersion
    const logVersion = s.logRequestVersion
    const tr = t()
    const res = await dataSource().agents.clearLogs(id)
    const now = get()
    if (!(now.open && now.requestVersion === requestVersion && now.agentId === id)) return
    if (res.failed.length > 0) {
      // 假成功防线:有文件没清掉 → 保留列表并指出是哪些
      showToast(`${tr('log.clearFailed')}: ${res.failed.map((f) => f.path).join(', ')}`.slice(0, 180), '#f87171', 'fa-circle-exclamation')
      return
    }
    set({ logLines: [], logRequestVersion: logVersion + 1 })
  }
}))

/** 写入结果统一处置:冲突交用户裁决(不静默覆盖);成功则整体替换状态并按真实结果给反馈 */
async function handleOutcome(
  outcome: SaveOutcome,
  applyMode: ApplyMode,
  isCurrent: () => boolean = () => true
): Promise<boolean> {
  const tr = t()
  const store = useDrawerStore.getState()
  if (!isCurrent()) return false
  if (!outcome.ok) {
    if (outcome.kind === 'conflict' && outcome.latest) {
      const picked = await CHOICE.request({
        header: tr('conflict.header'),
        title: tr('conflict.title'),
        options: [
          { label: tr('conflict.reload'), value: 'reload' },
          { label: tr('conflict.keep'), value: 'keep' }
        ]
      })
      if (!isCurrent()) return false
      if (picked === 'reload') {
        store.applyDocumentImpl(outcome.latest)
        showToast(tr('conflict.reloaded'), '#60a5fa', 'fa-rotate-right')
      } else {
        showToast(tr('conflict.kept'), '#8888aa', 'fa-file-pen')
      }
      return false
    }
    if (outcome.kind === 'elevation-cancelled') showToast(tr('toast.elevCancelled'), '#8888aa', 'fa-ban')
    else if (outcome.kind === 'elevation-failed') showToast(tr('toast.elevFailed'), '#f87171', 'fa-circle-exclamation')
    else showToast(saveFailureMessage(outcome, tr), '#f87171', 'fa-circle-exclamation')
    // 失败时的分阶段结果(P0-2):文件写了没 / 回滚了没 / 运行态现在如何
    if (outcome.report && outcome.report.notes.length > 0) {
      showToast(outcome.report.notes.join(' / ').slice(0, 180), '#f87171', 'fa-list-check')
    }
    // 写盘后无法回源时，旧 form/revision 已不再可信：刷新列表并关闭抽屉，
    // 不能让用户继续基于旧身份再次保存。
    if (outcome.report?.fileWritten && outcome.report.notes.some((n) => n.includes('最新文档读取失败'))) {
      await useAgentsStore.getState().load().catch(() => {})
      if (isCurrent()) useDrawerStore.getState().close()
    }
    return false
  }
  await useAgentsStore.getState().load()
  if (!isCurrent()) return false
  // 删除成功没有 AgentDocument；调用方随后刷新列表并关闭抽屉。
  if ('removed' in outcome) return true
  store.applyDocumentImpl(outcome.document)
  const r = outcome.report
  if (applyMode === 'saveAndApply' && r.applied) {
    // 应用 = bootout → bootstrap:运行态变了(通常变成「已载入未运行」),抽屉的状态页与操作栏必须跟着刷新,
    // 否则 XML tab 保存后仍显示旧 PID/running
    const listed = useAgentsStore.getState().agents.find((a) => a.id === outcome.document.id)
    if (listed) {
      store.setOps({
        loaded: listed.status !== 'stopped' || listed.pid !== null,
        enabled: !listed.isDisabledByOverride,
        running: listed.status === 'running'
      })
    }
    const statusVersion = store.requestVersion
    void dataSource()
      .agents
      .readStatus(outcome.document.id)
      .then((statusModel) => {
        const now = useDrawerStore.getState()
        if (now.open && now.requestVersion === statusVersion && now.agentId === outcome.document.id) {
          useDrawerStore.setState({ statusModel })
        }
      })
      .catch(() => {})
  }
  if (applyMode === 'save') {
    // 只写了文件:已载入的任务仍在用旧配置(运行态漂移),明确说出来而不是让用户以为已生效
    if (r.wasLoaded === true) {
      showToast(tr('toast.savedDrift'), '#fbbf24', 'fa-triangle-exclamation')
    } else {
      showToast(tr('toast.savedToFile'), '#4ade80', 'fa-floppy-disk')
    }
  }
  else if (r.applied) showToast(tr('toast.savedApplied'), '#4ade80', 'fa-check')
  else if (r.wasLoaded === false) showToast(tr('toast.savedNotLoaded'), '#4ade80', 'fa-floppy-disk')
  else showToast(tr('toast.savedToFile'), '#4ade80', 'fa-floppy-disk')
  return true
}

function saveFailureMessage(outcome: Extract<SaveOutcome, { ok: false }>, tr: (k: string) => string): string {
  if (outcome.kind === 'unsupported') {
    const keys = outcome.message.match(/键:([^;]+)/)?.[1] ?? ''
    return keys ? fmt(tr('cfg.unsupported.title'), { K: keys }) : tr('cfg.unsupported.hint')
  }
  if (outcome.kind === 'invalid') return tr('toast.agentInvalid')
  if (outcome.kind === 'write-failed') return tr('toast.agentWriteFailed')
  return outcome.message.slice(0, 180)
}
