// Cron 数据 store:真实 crontab 后端(阶段 2)
// mutation 全部「调用后端 → 整表 reload」:job id 由内容推导,编辑后可能变化,不做 map-patch
// 错误(提权取消/任务被外部改动等)向调用方抛出,由视图层统一 toast

import { create } from 'zustand'
import type { CronJob, CronScope, CronScopeData } from '@shared/models'
import type { CronFilter } from '../data/ports'
import { dataSource } from '../data'
import { showToast } from '../lib/utils'
import { makeT, getCurrentLang } from '../i18n'
import { ELEVATION } from '../lib/elevation'

const EMPTY_SCOPE: CronScopeData = { headerRaw: '', exists: false }

interface CronState {
  crons: CronJob[]
  headers: { user: CronScopeData; system: CronScopeData }
  filter: CronFilter
  editingId: string | null // demo activeCronEdit(互斥内联编辑)
  loaded: boolean
  load(): Promise<void>
  setFilter(f: CronFilter): void
  setEditingId(id: string | null): void
  setEnabled(job: CronJob, enabled: boolean): Promise<void>
  setLog(job: CronJob, log: boolean): Promise<void>
  save(job: CronJob, patch: Partial<CronJob>): Promise<void>
  remove(job: CronJob): Promise<void>
  create(input: Omit<CronJob, 'id'>): Promise<void>
  writeHeader(scope: CronScope, text: string): Promise<void>
}

const t = (): ((k: string) => string) => makeT(getCurrentLang())

export const useCronStore = create<CronState>((set, get) => ({
  crons: [],
  headers: { user: EMPTY_SCOPE, system: EMPTY_SCOPE },
  filter: 'all',
  editingId: null,
  loaded: false,

  async load() {
    const payload = await dataSource().crons.list()
    set({ crons: payload.jobs, headers: payload.headers, loaded: true })
  },

  setFilter(f) {
    set({ filter: f })
  },

  setEditingId(id) {
    set({ editingId: id })
  },

  // demo toggleCronJob:状态点即时刷新 + toast
  async setEnabled(job, enabled) {
    await dataSource().crons.update(job, { enabled })
    if (job.system) ELEVATION.noteSuccess()
    await get().load()
    showToast(enabled ? t()('toast.cronEnabled') : t()('toast.cronDisabled'), enabled ? '#4ade80' : '#8888aa', enabled ? 'fa-check' : 'fa-ban')
  },

  // demo toggleCronLog:开关即时生效 + toast
  async setLog(job, log) {
    await dataSource().crons.update(job, { log })
    if (job.system) ELEVATION.noteSuccess()
    await get().load()
    showToast(log ? t()('toast.cronLogOn') : t()('toast.cronLogOff'), log ? '#4ade80' : '#8888aa', 'fa-scroll')
  },

  // demo saveCronEdit(提权说明窗在调用方;真实授权由 main 侧 osascript 弹出)
  async save(job, patch) {
    const { stale } = await dataSource().crons.update(job, patch)
    if (job.system) ELEVATION.noteSuccess()
    await get().load()
    set({ editingId: null })
    showToast(t()(stale ? 'toast.cronStale' : 'toast.cronSaved'), '#4ade80', 'fa-check')
  },

  // demo deleteCronJob(危险确认在调用方)
  async remove(job) {
    await dataSource().crons.remove(job)
    if (job.system) ELEVATION.noteSuccess()
    await get().load()
    set({ editingId: null })
    showToast(t()('toast.cronDeleted'), '#f87171', 'fa-trash-can')
  },

  // demo createCronJob(后端追加到文件末尾;列表 reload 后按解析结果呈现)
  async create(input) {
    await dataSource().crons.create(input)
    if (input.system) ELEVATION.noteSuccess()
    await get().load()
    showToast(t()('toast.cronAdded'), '#4ade80', 'fa-check')
  },

  async writeHeader(scope, text) {
    await dataSource().crons.writeHeader(scope, text)
    if (scope === 'system') ELEVATION.noteSuccess()
    await get().load()
    showToast(t()('toast.cronHeaderSaved'), '#4ade80', 'fa-check')
  }
}))
