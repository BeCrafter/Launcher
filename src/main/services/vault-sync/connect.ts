// 把设置里选中的那一枝收成一个 RemoteStore。没配齐就返回 null,本轮跳过。
// 选哪个只看 notesSync.provider,不探测环境。

import { SYNC_HTTP_MAX_BYTES } from '../../../shared/notes'
import { GITHUB_BLOB_LIMIT } from './git-github'
import type { NotesSyncSettings } from '../../../shared/settings'
import type { HttpOptions } from './http'
import { createGitHubStore } from './git-github'
import { createGitLabStore } from './git-gitlab'
import { createS3Store } from './s3'
import { createSmbStore } from './smb'
import type { SyncSecrets } from './secrets'
import type { RemoteStore } from './store'
import { createWebDavStore } from './webdav'

export interface ConnectedSync {
  store: RemoteStore
  /** 单文件上限。SMB 是本地拷贝,不另设;0 = 不限制 */
  maxBytes: number
}

export function connectSync(
  settings: NotesSyncSettings,
  secrets: SyncSecrets,
  http: HttpOptions
): ConnectedSync | null {
  const provider = settings.provider
  if (provider === 'github') {
    const token = secrets.get('github')
    if (token === null || settings.github.repo === '') return null
    return { store: createGitHubStore({ ...settings.github, token }, http), maxBytes: GITHUB_BLOB_LIMIT }
  }
  if (provider === 'gitlab') {
    const token = secrets.get('gitlab')
    if (token === null || settings.gitlab.repo === '') return null
    return { store: createGitLabStore({ ...settings.gitlab, token }, http), maxBytes: GITHUB_BLOB_LIMIT }
  }
  if (provider === 'webdav') {
    const password = secrets.get('webdav')
    if (password === null || settings.webdav.url === '' || settings.webdav.username === '') return null
    return {
      store: createWebDavStore({ ...settings.webdav, password }, http),
      maxBytes: SYNC_HTTP_MAX_BYTES
    }
  }
  if (provider === 'smb') {
    if (settings.smb.mountPath === '') return null
    return { store: createSmbStore(settings.smb), maxBytes: 0 }
  }
  const secret = secrets.get('s3')
  const s3 = settings.s3
  if (secret === null || s3.endpoint === '' || s3.bucket === '' || s3.accessKeyId === '') return null
  return {
    store: createS3Store({ ...s3, secretAccessKey: secret }, http),
    maxBytes: SYNC_HTTP_MAX_BYTES
  }
}
