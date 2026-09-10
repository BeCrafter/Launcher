// 设置持久化:仅由 main 进程持有(单一事实来源),renderer 经 IPC 读写
// 路径约定(用户确认):${HOME}/.config/launcher/config.json

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { normalizeSettings, type LauncherSettings } from '../../shared/settings'
import type { SettingsPatch } from '../../shared/ipc'

export const SETTINGS_DIR = join('.config', 'launcher')
export const SETTINGS_FILE = 'config.json'

export function defaultConfigPath(home: string): string {
  return join(home, SETTINGS_DIR, SETTINGS_FILE)
}

export interface SettingsStore {
  readonly path: string
  get(): LauncherSettings
  save(patch: SettingsPatch): LauncherSettings
  reset(): LauncherSettings
  onChange(cb: (s: LauncherSettings) => void): () => void
}

export function createSettingsStore(filePath: string): SettingsStore {
  let cache: LauncherSettings | null = null
  const listeners = new Set<(s: LauncherSettings) => void>()

  function load(): LauncherSettings {
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf8'))
      cache = normalizeSettings(raw)
      return cache
    } catch (err) {
      // 文件损坏(或非法 JSON):保留现场 .bak 供用户排查,回到默认值
      if (existsSync(filePath)) {
        try {
          renameSync(filePath, `${filePath}.bak`)
          console.error(`[settings] 配置损坏,已备份到 ${filePath}.bak 并回默认值:`, err)
        } catch (bakErr) {
          console.error(`[settings] 配置损坏且备份失败,回默认值:`, bakErr)
        }
      }
      cache = normalizeSettings(undefined)
      return cache
    }
  }

  function persist(next: LauncherSettings): void {
    mkdirSync(dirname(filePath), { recursive: true })
    // 临时文件 + renameSync 同盘原子替换,避免半写文件
    const tmp = `${filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
    renameSync(tmp, filePath)
  }

  function emit(next: LauncherSettings): void {
    for (const cb of listeners) cb(next)
  }

  return {
    path: filePath,
    get() {
      return cache ?? load()
    },
    save(patch) {
      const next = normalizeSettings({ ...(cache ?? load()), ...patch })
      cache = next
      persist(next)
      emit(next)
      return next
    },
    reset() {
      const next = normalizeSettings(undefined)
      cache = next
      persist(next)
      emit(next)
      return next
    },
    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
}
