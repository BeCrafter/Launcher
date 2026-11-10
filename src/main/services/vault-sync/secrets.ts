// 同步秘密:Token、WebDAV 密码、S3 Secret。走 safeStorage,明文不进设置文件。
// SMB 没有秘密:用户在访达里挂载,应用只记挂载点。

import { createSecretStore, type SecretStore } from '../../ai/secret-store'
import type { NotesSyncProvider } from '../../../shared/settings'

export type SyncSecretId = Exclude<NotesSyncProvider, 'smb'>

export const SYNC_SECRET_IDS: readonly SyncSecretId[] = ['github', 'gitlab', 'webdav', 's3']

export type SyncSecrets = SecretStore<SyncSecretId>

export function createSyncSecrets(opts: {
  path: string
  crypto?: {
    available(): boolean
    encrypt(s: string): string
    decrypt(s: string): string
  }
}): SyncSecrets {
  return createSecretStore<SyncSecretId>(opts)
}
