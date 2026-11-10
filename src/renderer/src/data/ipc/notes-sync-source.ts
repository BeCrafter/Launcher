// 笔记同步的 IPC 实现。设置页只发意图,比对和传输都在 main。
import { IPC_EVENTS } from '@shared/ipc'
import type { NotesSyncStatus } from '@shared/ipc'
import type { NotesSyncRepository } from '../ports'

export function createIpcNotesSyncRepo(): NotesSyncRepository {
  const api = (): Window['launcher']['notesSync'] => window.launcher.notesSync
  return {
    status: () => api().status(),
    syncNow: () => api().syncNow(),
    resolve: (path, keep) => api().resolve(path, keep),
    setSecret: (provider, secret) => api().setSecret(provider, secret),
    revealSecret: (provider) => api().revealSecret(provider),
    test: () => api().test(),
    onChanged: (cb) =>
      window.launcher.onEvent(IPC_EVENTS.notesSyncChanged, (payload) => cb(payload as NotesSyncStatus))
  }
}
