// 快照:每台设备一份,不进笔记目录,也不进远端。
// targetId 变了(换协议、换仓库、换目录)整份作废,下一轮按第一次同步。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SnapshotFile } from './scan'

export interface SyncSnapshot {
  targetId: string
  /** 只有 Git 用:上次同步结束时的 HEAD,用来判断远程是不是被强推过 */
  cursor?: string
  files: Record<string, SnapshotFile>
}

export function emptySnapshot(targetId: string): SyncSnapshot {
  return { targetId, files: {} }
}

export function loadSnapshot(path: string, targetId: string): SyncSnapshot {
  if (!existsSync(path)) return emptySnapshot(targetId)
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptySnapshot(targetId)
    const o = raw as Record<string, unknown>
    if (o.targetId !== targetId) return emptySnapshot(targetId)
    const files: Record<string, SnapshotFile> = {}
    if (typeof o.files === 'object' && o.files !== null && !Array.isArray(o.files)) {
      for (const [k, v] of Object.entries(o.files as Record<string, unknown>)) {
        if (k === '__proto__' || typeof v !== 'object' || v === null) continue
        const f = v as Record<string, unknown>
        if (typeof f.etag !== 'string' || typeof f.hash !== 'string') continue
        if (typeof f.size !== 'number' || typeof f.mtimeMs !== 'number') continue
        files[k] = { etag: f.etag, hash: f.hash, size: f.size, mtimeMs: f.mtimeMs }
      }
    }
    const cursor = typeof o.cursor === 'string' ? o.cursor : undefined
    return { targetId, cursor, files }
  } catch {
    return emptySnapshot(targetId)
  }
}

/** tmp + rename,和设置文件同一套原子写 */
export function saveSnapshot(path: string, snapshot: SyncSnapshot): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(snapshot), 'utf8')
  renameSync(tmp, path)
}
