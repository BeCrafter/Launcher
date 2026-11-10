// 一轮同步:先拉,再改名,再推,最后删。
//
// 冲突的路径本轮不写。某个路径失败不中断其余路径,也不把失败的记进快照。
// 列目录失败则整轮不动,避免半棵树被当成删除。
// 同一时刻只跑一轮,后来的请求并进下一轮。

import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { compileIgnore, type IgnoreMatcher } from './ignore'
import { planSync } from './plan'
import { contentHash, scanLocal, type LocalFile, type SnapshotFile } from './scan'
import { loadSnapshot, saveSnapshot, type SyncSnapshot } from './state'
import { ConflictError, IncompleteListError, type RemoteStore } from './store'

export interface SyncStatus {
  phase: 'idle' | 'running' | 'conflict' | 'error'
  /** 上次成功结束的时间;从未成功过是 0 */
  lastSyncAt: number
  conflicts: string[]
  /** 本轮跳过的大文件或单文件错误,给设置页看 */
  errors: { path: string; message: string }[]
  message?: string
}

export interface VaultSync {
  status(): SyncStatus
  /** 有本地变更时调用。去抖后再跑,不挂在每个保存函数上 */
  notifyLocalChange(): void
  syncNow(): Promise<SyncStatus>
  /**
   * 冲突的决定。keep 是保留哪一边。
   * 只处理当前冲突列表里的路径,其余不动。
   */
  resolve(path: string, keep: 'local' | 'remote'): Promise<SyncStatus>
  stop(): void
}

export interface VaultSyncOptions {
  getRoot(): string
  getIgnore(): string
  /** 当前设置对应的目标。变了就不用旧快照 */
  getTargetId(): string
  /** 没配好(没开、没填仓库)时返回 null,本轮直接跳过 */
  getStore(): RemoteStore | null
  statePath: string
  /**
   * 单文件上限(字节)。超过的跳过并记进 errors,不上传。0 = 不限制。
   * 每次同步现算:换协议后上限跟着变,不用重建引擎。
   */
  maxBytes: number | (() => number)
  /** 去抖,毫秒 */
  debounceMs: number
  now?: () => number
  /** 拉取写完后告诉外面哪些相对路径变了,让打开着的文件重载 */
  onPulled?: (paths: string[]) => void
  /** 删本地文件。应用传系统废纸篓 */
  trash?: (abs: string) => Promise<void>
  log?: (msg: string) => void
}

const idle: SyncStatus = { phase: 'idle', lastSyncAt: 0, conflicts: [], errors: [] }

export function createVaultSync(opts: VaultSyncOptions): VaultSync {
  const now = opts.now ?? Date.now
  const log = opts.log ?? ((): void => {})
  let current: SyncStatus = { ...idle }
  let running = false
  let rerun = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  function ignore(): IgnoreMatcher {
    return compileIgnore(opts.getIgnore())
  }

  function snapshotFor(store: RemoteStore): SyncSnapshot {
    return loadSnapshot(opts.statePath, store.targetId)
  }

  async function run(): Promise<SyncStatus> {
    if (stopped) return current
    if (running) {
      rerun = true
      return current
    }
    running = true
    current = { ...current, phase: 'running', errors: [], message: undefined }
    try {
      current = await runOnce()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log(`sync failed: ${message}`)
      current = { ...current, phase: 'error', message }
    } finally {
      running = false
      if (rerun && !stopped) {
        rerun = false
        void run()
      }
    }
    return current
  }

  async function runOnce(): Promise<SyncStatus> {
    const store = opts.getStore()
    if (store === null) return { ...current, phase: 'idle' }
    const root = opts.getRoot()
    const matcher = ignore()
    const snapshot = snapshotFor(store)
    const previous = new Map(Object.entries(snapshot.files))
    const local = scanLocal(root, matcher, previous)
    let remote
    try {
      remote = await store.list()
    } catch (err) {
      if (err instanceof IncompleteListError) throw err
      throw err
    }
    const firstSync = previous.size === 0 && snapshot.cursor === undefined
    const plan = planSync({ local, remote, snapshot: previous, firstSync, ignore: matcher })

    const errors: SyncStatus['errors'] = []
    const pulled: string[] = []
    const files = { ...snapshot.files }
    /** 还没真正提交的路径。flush 没跑成时,这些项恢复成快照里的旧值 */
    const deferred = new Set<string>()

    const limit = typeof opts.maxBytes === 'function' ? opts.maxBytes() : opts.maxBytes
    const tooBig = (path: string, size: number): boolean => {
      if (limit > 0 && size > limit) {
        errors.push({ path, message: `超过 ${limit} 字节,已跳过` })
        return true
      }
      return false
    }

    for (const path of plan.baseline) {
      const entry = remote.get(path)
      const file = local.get(path)
      if (entry === undefined || file === undefined) continue
      files[path] = { etag: entry.etag, hash: file.hash, size: file.size, mtimeMs: file.mtimeMs }
    }

    for (const path of plan.pull) {
      const entry = remote.get(path)
      if (entry === undefined || tooBig(path, entry.size)) continue
      try {
        const body = await store.read(path)
        writeAtomic(root, path, body)
        const file = localStat(root, path, body)
        files[path] = { etag: entry.etag, hash: file.hash, size: file.size, mtimeMs: file.mtimeMs }
        pulled.push(path)
      } catch (err) {
        errors.push({ path, message: messageOf(err) })
      }
    }

    for (const { from, to } of plan.renames) {
      try {
        const moved = store.rename ? await store.rename(from, to) : false
        if (!moved) {
          const body = readLocal(root, to)
          if (tooBig(to, body.length)) continue
          const written = await store.write(to, body)
          await store.remove(from)
          const file = local.get(to)
          if (file) files[to] = { ...fileEntry(file), etag: written.etag }
          if (store.flush) {
            deferred.add(to)
            deferred.add(from)
          }
        } else {
          const file = local.get(to)
          const prev = files[from]
          if (file && prev) files[to] = { ...fileEntry(file), etag: prev.etag }
        }
        delete files[from]
      } catch (err) {
        errors.push({ path: to, message: messageOf(err) })
      }
    }

    for (const path of plan.push) {
      const file = local.get(path)
      if (file === undefined || tooBig(path, file.size)) continue
      try {
        const body = readLocal(root, path)
        const expected = remote.get(path)?.etag
        const written = await store.write(path, body, expected)
        files[path] = { ...fileEntry(file), etag: written.etag }
        if (store.flush) deferred.add(path)
      } catch (err) {
        if (err instanceof ConflictError) plan.conflicts.push(path)
        else errors.push({ path, message: messageOf(err) })
      }
    }

    for (const path of plan.deleteRemote) {
      try {
        await store.remove(path, remote.get(path)?.etag)
        delete files[path]
        if (store.flush) deferred.add(path)
      } catch (err) {
        if (err instanceof ConflictError) plan.conflicts.push(path)
        else errors.push({ path, message: messageOf(err) })
      }
    }

    for (const path of plan.deleteLocal) {
      try {
        const abs = join(root, path)
        if (opts.trash) await opts.trash(abs)
        else rmSync(abs)
        delete files[path]
        pulled.push(path)
      } catch (err) {
        errors.push({ path, message: messageOf(err) })
      }
    }

    // 规则收紧后,快照里被排除的项丢掉。远端副本留着,不删
    for (const path of Object.keys(files)) {
      if (matcher.ignores(path, false)) delete files[path]
    }

    // 有冲突或单文件失败就不提交这一批。排队里的路径不进快照,
    // 下一轮还会把它们当成未同步。提交自己失败时同样回滚。
    const holdBack = errors.length > 0 || plan.conflicts.length > 0
    if (holdBack) store.discard?.()
    if (!holdBack && store.flush) {
      try {
        await store.flush()
        deferred.clear()
      } catch (err) {
        store.discard?.()
        errors.push({ path: '', message: messageOf(err) })
      }
    }
    if (deferred.size > 0) {
      for (const path of deferred) {
        if (snapshot.files[path] !== undefined) files[path] = snapshot.files[path]
        else delete files[path]
      }
    }
    // 提交没做成时不推进 cursor:下一轮还要拿旧的 HEAD 对
    const next: SyncSnapshot = {
      targetId: store.targetId,
      cursor: deferred.size > 0 ? snapshot.cursor : (store.cursor?.() ?? snapshot.cursor),
      files
    }
    saveSnapshot(opts.statePath, next)
    if (pulled.length > 0) opts.onPulled?.(pulled)

    const conflicts = [...new Set(plan.conflicts)].sort()
    return {
      phase: conflicts.length > 0 ? 'conflict' : errors.length > 0 ? 'error' : 'idle',
      lastSyncAt: now(),
      conflicts,
      errors,
      message: errors.length > 0 ? errors[0].message : undefined
    }
  }

  return {
    status: () => current,
    notifyLocalChange() {
      if (stopped) return
      // 尾沿:窗口里又有写入就重新计时,不在第一下就定死
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void run()
      }, opts.debounceMs)
    },
    syncNow: () => run(),
    async resolve(path, keep) {
      if (!current.conflicts.includes(path)) return current
      const store = opts.getStore()
      if (store === null) return current
      const root = opts.getRoot()
      const snapshot = snapshotFor(store)
      try {
        if (keep === 'remote') {
          const body = await store.read(path)
          writeAtomic(root, path, body)
          const remote = await store.list()
          const entry = remote.get(path)
          const file = localStat(root, path, body)
          if (entry) {
            snapshot.files[path] = { etag: entry.etag, hash: file.hash, size: file.size, mtimeMs: file.mtimeMs }
          }
          opts.onPulled?.([path])
        } else {
          const body = readLocal(root, path)
          const written = await store.write(path, body)
          await store.flush?.()
          const st = localStat(root, path, body)
          snapshot.files[path] = { etag: written.etag, hash: st.hash, size: st.size, mtimeMs: st.mtimeMs }
        }
        saveSnapshot(opts.statePath, snapshot)
        current = { ...current, conflicts: current.conflicts.filter((p) => p !== path) }
        if (current.conflicts.length === 0 && current.errors.length === 0) current = { ...current, phase: 'idle' }
      } catch (err) {
        current = { ...current, phase: 'error', message: messageOf(err) }
      }
      return current
    },
    stop() {
      stopped = true
      if (timer !== null) clearTimeout(timer)
      timer = null
    }
  }
}

function fileEntry(file: LocalFile): SnapshotFile {
  return { etag: '', hash: file.hash, size: file.size, mtimeMs: file.mtimeMs }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function readLocal(root: string, path: string): Buffer {
  return readFileSync(join(root, path))
}

function localStat(root: string, path: string, body: Buffer): { hash: string; size: number; mtimeMs: number } {
  const st = statSync(join(root, path))
  return { hash: contentHash(body), size: st.size, mtimeMs: st.mtimeMs }
}

/** 先写临时文件再改名,避免拉到一半留下半截文件 */
function writeAtomic(root: string, path: string, body: Buffer): void {
  const abs = join(root, path)
  mkdirSync(dirname(abs), { recursive: true })
  const tmp = `${abs}.tmp`
  writeFileSync(tmp, body)
  renameSync(tmp, abs)
}
