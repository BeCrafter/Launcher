// Cron 数据 store:demo crontab.js 状态部分(activeCronFilter/activeCronEdit + cronData)
import { create } from 'zustand'
import type { CronJob } from '@shared/models'
import type { CronFilter } from '../data/ports'
import { dataSource } from '../data'
import { showToast } from '../lib/utils'
import { makeT, getCurrentLang } from '../i18n'

interface CronState {
  crons: CronJob[]
  filter: CronFilter
  editingId: string | null // demo activeCronEdit(互斥内联编辑)
  loaded: boolean
  load(): Promise<void>
  setFilter(f: CronFilter): void
  setEditingId(id: string | null): void
  setEnabled(id: string, enabled: boolean): Promise<void>
  setLog(id: string, log: boolean): Promise<void>
  save(id: string, patch: Partial<CronJob>): Promise<void>
  remove(id: string): Promise<void>
  create(job: CronJob): Promise<void>
}

export const useCronStore = create<CronState>((set, get) => ({
  crons: [],
  filter: 'all',
  editingId: null,
  loaded: false,

  async load() {
    const crons = await dataSource().crons.list()
    set({ crons, loaded: true })
  },

  setFilter(f) {
    set({ filter: f })
  },

  setEditingId(id) {
    set({ editingId: id })
  },

  // demo toggleCronJob:状态点即时刷新 + toast
  async setEnabled(id, enabled) {
    const j = await dataSource().crons.update(id, { enabled })
    set({ crons: get().crons.map((x) => (x.id === j.id ? { ...j } : x)) })
    const t = makeT(getCurrentLang())
    showToast(enabled ? t('toast.cronEnabled') : t('toast.cronDisabled'), enabled ? '#4ade80' : '#8888aa', enabled ? 'fa-check' : 'fa-ban')
  },

  // demo toggleCronLog:开关即时生效 + toast
  async setLog(id, log) {
    const j = await dataSource().crons.update(id, { log })
    set({ crons: get().crons.map((x) => (x.id === j.id ? { ...j } : x)) })
    const t = makeT(getCurrentLang())
    showToast(log ? t('toast.cronLogOn') : t('toast.cronLogOff'), log ? '#4ade80' : '#8888aa', 'fa-scroll')
  },

  // demo saveCronEdit(提权分流在调用方)
  async save(id, patch) {
    const j = await dataSource().crons.update(id, patch)
    set({ crons: get().crons.map((x) => (x.id === j.id ? { ...j } : x)), editingId: null })
    showToast(makeT(getCurrentLang())('toast.cronSaved'), '#4ade80', 'fa-check')
  },

  // demo deleteCronJob(提权分流在调用方)
  async remove(id) {
    await dataSource().crons.remove(id)
    set({ crons: get().crons.filter((x) => x.id !== id), editingId: null })
    showToast(makeT(getCurrentLang())('toast.cronDeleted'), '#f87171', 'fa-trash-can')
  },

  // demo createCronJob:unshift 到列表顶
  async create(job) {
    await dataSource().crons.create(job)
    set({ crons: [job, ...get().crons] })
    showToast(makeT(getCurrentLang())('toast.cronAdded'), '#4ade80', 'fa-check')
  }
}))
