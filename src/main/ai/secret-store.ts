// API Key 存储:经 Electron safeStorage 加密后落盘,明文永不进设置文件
//
// 设置文件(${HOME}/.config/launcher/config.json)是明文 JSON,备份/云同步都可能外泄,
// 故 Key 单独存 ${userData}/ai-keys.json,内容形如 { anthropic: "<base64 密文>" }。
// 读侧只回明文给 main 内的调用方(构造请求头);IPC 只暴露 hasKey 布尔,Key 本体不出 main。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import type { AiProviderId } from '../../shared/settings'

export interface SecretStore {
  get(providerId: AiProviderId): string | null
  set(providerId: AiProviderId, apiKey: string): void
  clear(providerId: AiProviderId): void
  has(providerId: AiProviderId): boolean
}

interface Options {
  /** 注入存储路径(便于测试);生产传 ${userData}/ai-keys.json */
  path: string
  /** 注入加密实现(测试用);默认 Electron safeStorage */
  crypto?: {
    available(): boolean
    encrypt(s: string): string
    decrypt(s: string): string
  }
}

/**
 * safeStorage 不可用(极少数无钥匙串的环境)时**拒绝写入**而不是降级明文 ——
 * 降级会让「加密保存」的界面承诺变成谎话,而用户无从察觉。
 */
export function createSecretStore(opts: Options): SecretStore {
  const crypto = opts.crypto ?? {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (s: string) => safeStorage.encryptString(s).toString('base64'),
    decrypt: (s: string) => safeStorage.decryptString(Buffer.from(s, 'base64'))
  }

  const read = (): Record<string, string> => {
    if (!existsSync(opts.path)) return {}
    try {
      const raw = JSON.parse(readFileSync(opts.path, 'utf8')) as unknown
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        // 原型污染守卫:JSON.parse 会把 __proto__ 造成自有属性
        if (k === '__proto__' || typeof v !== 'string') continue
        out[k] = v
      }
      return out
    } catch {
      // 损坏文件按「无 Key」处理:比抛错更能让用户回到可用状态(重新填一次即可覆盖)
      return {}
    }
  }

  const write = (data: Record<string, string>): void => {
    mkdirSync(dirname(opts.path), { recursive: true })
    writeFileSync(opts.path, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 })
  }

  return {
    get(providerId) {
      const enc = read()[providerId]
      if (!enc) return null
      try {
        return crypto.decrypt(enc)
      } catch {
        // 钥匙串换了 / 密文损坏:当作未配置,不要把它当成有效 Key 发出去
        return null
      }
    },
    set(providerId, apiKey) {
      const key = apiKey.trim()
      if (key === '') {
        this.clear(providerId)
        return
      }
      if (!crypto.available()) {
        throw new Error('系统钥匙串不可用,无法安全保存 API Key')
      }
      write({ ...read(), [providerId]: crypto.encrypt(key) })
    },
    clear(providerId) {
      const data = read()
      delete data[providerId]
      write(data)
    },
    has(providerId) {
      return this.get(providerId) !== null
    }
  }
}
