// applier 注册表:设置变更 → 按序应用各域副作用(每域一个模块,新增设置 = schema 加键 + 对应域 applier)

import type { LauncherSettings } from '../../../shared/settings'
import type { ApplyCtx, SettingsApplier } from '../types'
import { createAppearanceApplier } from './appearance'
import { createDockApplier } from './dock'
import { createTrayApplier } from './tray'
import { createLoginApplier } from './login'
import { createFsEventsApplier } from './fsevents'

export interface ApplierRegistry {
  apply(s: LauncherSettings): void
}

export function createApplierRegistry(ctx: ApplyCtx): ApplierRegistry {
  const appliers: SettingsApplier[] = [
    createAppearanceApplier(),
    createDockApplier(),
    createTrayApplier(),
    createLoginApplier(),
    createFsEventsApplier()
  ]
  let prev: LauncherSettings | null = null
  return {
    apply(s) {
      for (const a of appliers) a.apply(s, prev, ctx)
      prev = s
    }
  }
}
