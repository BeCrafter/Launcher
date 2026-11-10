import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../shared/settings'
import type { NotesSyncSettings } from '../../../shared/settings'
import { connectSync } from './connect'
import type { SyncSecrets } from './secrets'

function secrets(map: Record<string, string> = {}): SyncSecrets {
  return {
    get: (id) => map[id] ?? null,
    set: () => {},
    clear: () => {},
    has: (id) => map[id] !== undefined
  }
}

const http = { fetch: (async () => new Response('')) as typeof fetch }

function settings(patch: Partial<NotesSyncSettings>): NotesSyncSettings {
  return { ...DEFAULT_SETTINGS.notesSync, ...patch }
}

describe('connectSync', () => {
  it('没填仓库或没存 Token 时不构造', () => {
    expect(connectSync(settings({ provider: 'github', github: { repo: 'o/r', branch: '', apiBaseUrl: '' } }), secrets(), http)).toBeNull()
    expect(connectSync(settings({ provider: 'github' }), secrets({ github: 't' }), http)).toBeNull()
  })

  it('只看选中的协议,别的枝填了也不用', () => {
    const connected = connectSync(
      settings({
        provider: 'smb',
        smb: { mountPath: '/Volumes/Notes' },
        github: { repo: 'o/r', branch: '', apiBaseUrl: '' }
      }),
      secrets({ github: 't' }),
      http
    )
    expect(connected?.store.targetId).toBe('smb|/Volumes/Notes')
    expect(connected?.maxBytes).toBe(0)
  })

  it('WebDAV 有单文件上限,Git 用主机上限', () => {
    const web = connectSync(
      settings({ provider: 'webdav', webdav: { url: 'https://dav.example/n', username: 'u' } }),
      secrets({ webdav: 'p' }),
      http
    )
    expect(web?.maxBytes).toBe(128 * 1024 * 1024)
    expect(web?.store.targetId.startsWith('webdav|')).toBe(true)

    const git = connectSync(
      settings({ provider: 'gitlab', gitlab: { repo: 'ns/p', branch: 'dev', apiBaseUrl: '' } }),
      secrets({ gitlab: 't' }),
      http
    )
    expect(git?.maxBytes).toBe(95 * 1024 * 1024)
  })
})
