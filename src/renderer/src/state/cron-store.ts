// Cron 数据 store:demo crontab.js 状态部分(activeCronFilter + cronData)
import { create } from 'zustand'
import type { CronJob } from '@shared/models'
import type { CronFilter } from '../data/ports'
import { dataSource } from '../data'

interface CronState {
  crons: CronJob[]
  filter: CronFilter
  loaded: boolean
  load(): Promise<void>
  setFilter(f: CronFilter): void
  setEnabled(id: string, enabled: boolean): Promise<void>
}

export const useCronStore = create<CronState>((set, get) => ({
  crons: [],
  filter: 'all',
  loaded: false,

  async load() {
    const crons = await dataSource().crons.list()
    set({ crons, loaded: true })
  },

  setFilter(f) {
    set({ filter: f })
  },

  async setEnabled(id, enabled) {
    const j = await dataSource().crons.update(id, { enabled })
    set({ crons: get().crons.map((x) => (x.id === j.id ? { ...j } : x)) })
  }
}))
