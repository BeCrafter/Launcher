// 远端只暴露这四个动作。编排层不关心底下是 Git 提交还是一次 PUT。
// list 列不全必须抛错:半棵树会被当成批量删除。

import type { RemoteEntry } from './plan'

export interface RemoteStore {
  /** 绑定到设置里的那一个目标。对不上就拒绝用旧快照 */
  readonly targetId: string
  list(): Promise<Map<string, RemoteEntry>>
  read(path: string): Promise<Buffer>
  /**
   * 覆盖或新建。expectedEtag 有值时,远端已变则抛 ConflictError,不写。
   * 返回写入之后的指纹。
   */
  write(path: string, body: Buffer, expectedEtag?: string): Promise<{ etag: string }>
  remove(path: string, expectedEtag?: string): Promise<void>
  /**
   * 把本轮积下的写入一次提交。Git 用它把多个文件收成一次提交;
   * 没有这个方法的远端(WebDAV / SMB / S3)在 write 时就已经落盘。
   */
  flush?(): Promise<void>
  /**
   * 丢掉还没提交的队列。有冲突或单文件失败时不提交,
   * 同一个 store 实例下一轮不能把这些旧动作一起提交掉。
   */
  discard?(): void
  /** Git 用:最近一次 list 或成功提交后的 HEAD。快照记下来 */
  cursor?(): string | undefined
  /**
   * 把 from 换成 to,不重传字节。做不到(例如两边哈希其实不同)就返回 false,
   * 编排层退回成先推再删。
   */
  rename?(from: string, to: string): Promise<boolean>
}

export class ConflictError extends Error {
  constructor(readonly path: string) {
    super(`远端已变化: ${path}`)
    this.name = 'ConflictError'
  }
}

export class IncompleteListError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IncompleteListError'
  }
}
