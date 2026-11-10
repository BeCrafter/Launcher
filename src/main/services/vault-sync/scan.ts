// 本地清单:笔记目录下要同步的普通文件。
//
// 只看字节,不认文件类型。排除只来自传入的规则,外加符号链接
// (跟着链接会同步到笔记目录外面,这是安全限制,不进配置)。
// 内容哈希只在大小或 mtime 跟快照不同时重算,大文件不能每轮都整文件读一遍。

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import type { IgnoreMatcher } from './ignore'

/** 超过这个深度的不再往下走,和笔记目录的 8 层对齐 */
const MAX_DEPTH = 8

export interface LocalFile {
  /** 相对路径,用 / 分隔 */
  path: string
  size: number
  mtimeMs: number
  /** sha256(原始字节)。大小与 mtime 都没变时沿用快照里的值,不读文件 */
  hash: string
  /**
   * Git blob SHA-1。只有这轮真正读过文件时才有。
   * 第一次同步用它和 Git 远端的 blob SHA 比,不跟 sha256 比。
   */
  gitHash?: string
}

export interface SnapshotFile {
  etag: string
  size: number
  mtimeMs: number
  hash: string
}

export function contentHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Git blob SHA-1:SHA1("blob " + 字节数 + NUL + 字节)。和远端树里的 blob SHA 直接可比 */
export function gitBlobSha(bytes: Buffer): string {
  const header = Buffer.from(`blob ${bytes.length}\0`)
  return createHash('sha1').update(header).update(bytes).digest('hex')
}

function toRel(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`
}

/**
 * 扫 root。previous 是上一轮快照:同一路径、同一大小、同一 mtime 就复用哈希。
 * 读不动的目录跳过它,不影响其余目录。
 */
export function scanLocal(
  root: string,
  ignore: IgnoreMatcher,
  previous: ReadonlyMap<string, SnapshotFile>,
  read: (abs: string) => Buffer = readFileSync
): Map<string, LocalFile> {
  const out = new Map<string, LocalFile>()

  const walk = (rel: string, depth: number): void => {
    if (depth > MAX_DEPTH) return
    const abs = rel === '' ? root : join(root, rel)
    let entries: Dirent[]
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = toRel(rel, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (ignore.ignores(child, true)) continue
        walk(child, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (ignore.ignores(child, false)) continue
      let st
      try {
        st = statSync(join(root, child))
      } catch {
        continue
      }
      const prev = previous.get(child)
      const unchanged = prev !== undefined && prev.size === st.size && prev.mtimeMs === st.mtimeMs
      let hash: string
      let gitHash: string | undefined
      if (unchanged) {
        hash = prev.hash
      } else {
        const bytes = read(join(root, child))
        hash = contentHash(bytes)
        gitHash = gitBlobSha(bytes)
      }
      out.set(child, { path: child, size: st.size, mtimeMs: st.mtimeMs, hash, gitHash })
    }
  }

  walk('', 0)
  return out
}
