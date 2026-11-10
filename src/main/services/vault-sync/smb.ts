// SMB:不自己实现协议。用户先在访达里挂载,这里只对挂载点做普通文件读写。
// 挂载点不存在或不可写时直接失败,密码不进应用。
// 单文件上限不在这里:SMB 是本地拷贝,编排层对它传 maxBytes = 0。

import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ConflictError, type RemoteStore } from './store'
import type { RemoteEntry } from './plan'
import { scanLocal } from './scan'
import { compileIgnore } from './ignore'

export interface SmbConfig {
  /** 访达挂载点,例如 /Volumes/Share/notes */
  mountPath: string
}

export function createSmbStore(config: SmbConfig): RemoteStore {
  const root = config.mountPath
  const fingerprint = (path: string): string => {
    const st = statSync(join(root, path))
    return `${st.mtimeMs}:${st.size}`
  }

  return {
    targetId: `smb|${root}`,
    async list() {
      if (!existsSync(root)) throw new Error(`挂载点不存在: ${root}`)
      try {
        accessSync(root, constants.W_OK)
      } catch {
        throw new Error(`挂载点不可写: ${root}`)
      }
      const found = scanLocal(root, compileIgnore(''), new Map())
      const out = new Map<string, RemoteEntry>()
      for (const [path, file] of found) {
        const etag = `${file.mtimeMs}:${file.size}`
        out.set(path, { path, etag, size: file.size, hash: file.hash })
      }
      return out
    },
    async read(path) {
      return readFileSync(join(root, path))
    },
    async write(path, body, expected) {
      const abs = join(root, path)
      if (expected !== undefined && existsSync(abs) && fingerprint(path) !== expected) {
        throw new ConflictError(path)
      }
      mkdirSync(dirname(abs), { recursive: true })
      const tmp = `${abs}.tmp`
      writeFileSync(tmp, body)
      renameSync(tmp, abs)
      return { etag: fingerprint(path) }
    },
    async remove(path, expected) {
      const abs = join(root, path)
      if (!existsSync(abs)) return
      if (expected !== undefined && fingerprint(path) !== expected) throw new ConflictError(path)
      rmSync(abs)
    },
    async rename(from, to) {
      const src = join(root, from)
      const dst = join(root, to)
      if (!existsSync(src)) return false
      mkdirSync(dirname(dst), { recursive: true })
      renameSync(src, dst)
      return true
    }
  }
}
