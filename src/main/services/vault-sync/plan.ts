// 三方对比:快照(上次一致的样子)/ 现在的本地 / 现在的远端。
//
// 纯函数,不碰网络也不碰磁盘。两边都变了就停下来,不覆盖。
// 被排除规则命中的路径不参与推、拉、删除 —— 收紧规则后,
// 远端已有的副本留着不动,不当成「本地已删」。

import type { IgnoreMatcher } from './ignore'
import type { LocalFile, SnapshotFile } from './scan'

export interface RemoteEntry {
  path: string
  /** 协议内的指纹。Git 是 blob SHA,文件协议是 ETag 或 mtime+size */
  etag: string
  size: number
  /**
   * 内容哈希。文件协议能直接给出 sha256 时填 sha256。
   * Git 填 blob SHA,和本地的 gitHash 比,不和 sha256 比。
   * 留空表示列目录时不知道内容,第一次同步记为冲突。
   */
  hash?: string
}

export interface SyncPlan {
  /** 本地变了、远端没变:推上去 */
  push: string[]
  /** 远端变了、本地没变:拉下来 */
  pull: string[]
  /** 本地没了、远端没变:删远端 */
  deleteRemote: string[]
  /** 远端没了、本地没变:删本地 */
  deleteLocal: string[]
  /** 两边都变了,或者第一次同步时两边内容不同:停下来问 */
  conflicts: string[]
  /**
   * 第一次同步时两边内容相同:不传,但要记进快照。
   * 否则下一轮没有「上次一致」,会把没改过的文件当成两边都变了。
   */
  baseline: string[]
  /**
   * 旧路径消失、新路径出现,且内容哈希相同:当成改名,不重传字节。
   * from 是远端路径,to 是本地路径。
   */
  renames: { from: string; to: string }[]
}

function sameContent(local: LocalFile, snap: SnapshotFile | undefined): boolean {
  return snap !== undefined && snap.hash === local.hash
}

function remoteUnchanged(remote: RemoteEntry, snap: SnapshotFile | undefined): boolean {
  return snap !== undefined && snap.etag === remote.etag
}

export function planSync(input: {
  local: ReadonlyMap<string, LocalFile>
  remote: ReadonlyMap<string, RemoteEntry>
  snapshot: ReadonlyMap<string, SnapshotFile>
  /** 快照为空且没有 cursor 时是第一次同步 */
  firstSync: boolean
  ignore: IgnoreMatcher
}): SyncPlan {
  const { local, remote, snapshot, firstSync, ignore } = input
  const plan: SyncPlan = {
    push: [],
    pull: [],
    deleteRemote: [],
    deleteLocal: [],
    conflicts: [],
    baseline: [],
    renames: []
  }

  const kept = (path: string): boolean => !ignore.ignores(path, false)

  const localOnly: string[] = []
  const remoteOnly: string[] = []

  for (const [path, file] of local) {
    if (!kept(path)) continue
    const snap = snapshot.get(path)
    const there = remote.get(path)
    if (there === undefined) {
      if (snap === undefined || sameContent(file, snap)) localOnly.push(path)
      else plan.conflicts.push(path)
      continue
    }
    const localChanged = !sameContent(file, snap)
    const remoteChanged = !remoteUnchanged(there, snap)
    if (firstSync && snap === undefined) {
      // 第一次没有「上次一致」可依。内容哈希相同就不用传,不同或比不了就问,不默认哪一边胜出
      // 文件协议的 hash 是 sha256。Git 的 hash 是 blob SHA,要和本地 gitHash 比
      const remoteHash = there.hash
      const same =
        remoteHash !== undefined &&
        (remoteHash === file.hash || (file.gitHash !== undefined && remoteHash === file.gitHash))
      if (same) plan.baseline.push(path)
      else plan.conflicts.push(path)
      continue
    }
    if (localChanged && remoteChanged) plan.conflicts.push(path)
    else if (localChanged) plan.push.push(path)
    else if (remoteChanged) plan.pull.push(path)
  }

  for (const [path] of remote) {
    if (!kept(path)) continue
    if (local.has(path)) continue
    const snap = snapshot.get(path)
    if (snap === undefined) {
      remoteOnly.push(path)
      continue
    }
    if (remoteUnchanged(remote.get(path)!, snap)) plan.deleteRemote.push(path)
    else plan.conflicts.push(path)
  }

  // 改名:本地新增的哈希 == 远端将删的哈希。一对一,多对多留给冲突处理。
  const byHash = new Map<string, string[]>()
  for (const path of localOnly) {
    const hash = local.get(path)!.hash
    const list = byHash.get(hash) ?? []
    list.push(path)
    byHash.set(hash, list)
  }
  const renamedTo = new Set<string>()
  for (const from of [...plan.deleteRemote]) {
    const hash = snapshot.get(from)?.hash
    if (hash === undefined) continue
    const candidates = byHash.get(hash)
    if (candidates === undefined || candidates.length !== 1) continue
    const to = candidates[0]
    if (renamedTo.has(to)) continue
    plan.renames.push({ from, to })
    renamedTo.add(to)
    plan.deleteRemote = plan.deleteRemote.filter((p) => p !== from)
  }
  for (const path of localOnly) {
    if (renamedTo.has(path)) continue
    const snap = snapshot.get(path)
    if (snap === undefined) plan.push.push(path)
    else plan.deleteLocal.push(path)
  }

  // 远端有、本地没有、快照里也没有:拉下来。第一次同步同样拉,因为本地根本没有这份
  for (const path of remoteOnly) plan.pull.push(path)

  return plan
}
