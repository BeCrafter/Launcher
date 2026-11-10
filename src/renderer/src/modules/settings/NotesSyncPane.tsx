// 笔记设置里的同步区。一排五个协议,选中哪个才渲染哪一块。
// 各块的字段分开存在 notesSync 里,切走再切回来值还在。
// 秘密不进设置文件:框是空的,placeholder 写「已配置」,失焦才写入,眼睛按钮临时显示。

import { useEffect, useState } from 'react'
import { DEFAULT_SYNC_IGNORE } from '@shared/notes'
import type { NotesSyncProvider, NotesSyncSettings } from '@shared/settings'
import type { NotesSyncStatus } from '@shared/ipc'
import { useT, useFmt } from '../../hooks/useT'
import { useSettingsStore } from '../../state/settings-store'
import { dataSource } from '../../data'
import { showToast } from '../../lib/utils'
import { SettingsSection, SettingsRow } from './SettingsBits'
import { Toggle } from '../../components/ui/Toggle'

const PROVIDERS: { id: NotesSyncProvider; icon: string }[] = [
  { id: 'github', icon: 'fa-brands fa-github' },
  { id: 'gitlab', icon: 'fa-brands fa-gitlab' },
  { id: 'webdav', icon: 'fa-solid fa-folder-tree' },
  { id: 'smb', icon: 'fa-solid fa-network-wired' },
  { id: 's3', icon: 'fa-solid fa-box' }
]

const idle: NotesSyncStatus = { phase: 'idle', lastSyncAt: 0, conflicts: [], errors: [], hasSecret: {} }

export function NotesSyncPane(): React.JSX.Element {
  const t = useT()
  const fmt = useFmt()
  const settings = useSettingsStore((s) => s.settings)
  const set = useSettingsStore((s) => s.set)
  const sync = settings?.notesSync
  const provider = sync?.provider ?? 'github'

  const [status, setStatus] = useState<NotesSyncStatus>(idle)
  const [secretDraft, setSecretDraft] = useState('')
  const [storedSecret, setStoredSecret] = useState('')
  const [secretVisible, setSecretVisible] = useState(false)
  const [busy, setBusy] = useState<'sync' | 'test' | null>(null)
  const [tested, setTested] = useState<'ok' | 'fail' | null>(null)

  useEffect(() => {
    const repo = dataSource().notesSync
    void repo.status().then(setStatus).catch(() => {})
    return repo.onChanged(setStatus)
  }, [])

  // 切协议时把那一枝已存的秘密取回来。SMB 没有秘密
  useEffect(() => {
    setTested(null)
    setSecretVisible(false)
    if (provider === 'smb') {
      setSecretDraft('')
      setStoredSecret('')
      return
    }
    let alive = true
    void dataSource()
      .notesSync.revealSecret(provider)
      .then((value) => {
        if (!alive) return
        setSecretDraft(value)
        setStoredSecret(value)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [provider])

  if (!sync) return <></>

  const patch = (next: Partial<NotesSyncSettings>): void => {
    set({ notesSync: { ...sync, ...next } })
  }

  const saveSecret = async (): Promise<void> => {
    if (provider === 'smb') return
    const value = secretDraft.trim()
    if (value === storedSecret) return
    try {
      const next = await dataSource().notesSync.setSecret(provider, value)
      setStatus(next)
      setStoredSecret(value)
      showToast(t('toast.prefsSaved'), '#4ade80', 'fa-key')
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('settings.notes.sync.testFail'), '#ef8080', 'fa-triangle-exclamation')
    }
  }

  const syncNow = async (): Promise<void> => {
    if (busy) return
    setBusy('sync')
    try {
      setStatus(await dataSource().notesSync.syncNow())
    } finally {
      setBusy(null)
    }
  }

  const test = async (): Promise<void> => {
    if (busy) return
    setBusy('test')
    setTested(null)
    try {
      const result = await dataSource().notesSync.test()
      setTested(result.ok ? 'ok' : 'fail')
      showToast(
        result.ok ? t('settings.notes.sync.testOk') : result.message || t('settings.notes.sync.testFail'),
        result.ok ? '#4ade80' : '#ef8080',
        result.ok ? 'fa-circle-check' : 'fa-circle-xmark'
      )
    } catch {
      setTested('fail')
    } finally {
      setBusy(null)
    }
  }

  const resolve = async (path: string, keep: 'local' | 'remote'): Promise<void> => {
    setStatus(await dataSource().notesSync.resolve(path, keep))
  }

  const resolveAll = async (keep: 'local' | 'remote'): Promise<void> => {
    let next = status
    for (const path of status.conflicts) next = await dataSource().notesSync.resolve(path, keep)
    setStatus(next)
  }

  const when =
    status.lastSyncAt > 0
      ? fmt(t('settings.notes.sync.last'), { T: new Date(status.lastSyncAt).toLocaleString() })
      : t('settings.notes.sync.never')

  return (
    <SettingsSection icon="fa-solid fa-arrows-rotate" title={t('settings.notes.sync.sectionTitle')} desc={t('settings.notes.sync.sectionDesc')}>
      <div className="ai-prov-grid">
        {PROVIDERS.map((item) => {
          const on = item.id === provider
          return (
            <div
              key={item.id}
              className={`ai-prov-card${on ? ' selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => patch({ provider: item.id })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') patch({ provider: item.id })
              }}
            >
              <div className="ai-prov-card-hd">
                <i className={`${item.icon} ai-prov-card-icon`} />
                <span className="ai-prov-card-name">{t(`settings.notes.sync.${item.id}.name`)}</span>
                <i className="fa-solid fa-circle-check ai-prov-check" />
              </div>
              <div className="ai-prov-card-sub">{t(`settings.notes.sync.${item.id}.desc`)}</div>
            </div>
          )
        })}
      </div>

      {(provider === 'github' || provider === 'gitlab') && (
        <>
          <SettingsRow
            title={t('settings.notes.sync.repo')}
            control={
              <input
                className="f-input mono ai-cfg-input"
                value={sync[provider].repo}
                placeholder={t(`settings.notes.sync.${provider}.repoPh`)}
                spellCheck={false}
                onChange={(e) => patch({ [provider]: { ...sync[provider], repo: e.target.value } })}
              />
            }
          />
          <SettingsRow
            title={t('settings.notes.sync.branch')}
            control={
              <input
                className="f-input mono ai-cfg-input"
                value={sync[provider].branch}
                placeholder={t('settings.notes.sync.branchPh')}
                spellCheck={false}
                onChange={(e) => patch({ [provider]: { ...sync[provider], branch: e.target.value } })}
              />
            }
          />
          <SettingsRow
            title={t('settings.notes.sync.api')}
            control={
              <input
                className="f-input mono ai-cfg-input"
                value={sync[provider].apiBaseUrl}
                placeholder={t(`settings.notes.sync.${provider}.apiPh`)}
                spellCheck={false}
                onChange={(e) => patch({ [provider]: { ...sync[provider], apiBaseUrl: e.target.value } })}
              />
            }
          />
          <SecretRow
            title={t('settings.notes.sync.token')}
            draft={secretDraft}
            visible={secretVisible}
            configured={status.hasSecret[provider] === true}
            onChange={setSecretDraft}
            onBlur={() => void saveSecret()}
            onToggle={() => setSecretVisible((v) => !v)}
          />
        </>
      )}

      {provider === 'webdav' && (
        <>
          <SettingsRow
            title={t('settings.notes.sync.webdav.url')}
            control={
              <input
                className="f-input mono ai-cfg-input"
                value={sync.webdav.url}
                spellCheck={false}
                onChange={(e) => patch({ webdav: { ...sync.webdav, url: e.target.value } })}
              />
            }
          />
          <SettingsRow
            title={t('settings.notes.sync.webdav.user')}
            control={
              <input
                className="f-input ai-cfg-input"
                value={sync.webdav.username}
                spellCheck={false}
                onChange={(e) => patch({ webdav: { ...sync.webdav, username: e.target.value } })}
              />
            }
          />
          <SecretRow
            title={t('settings.notes.sync.webdav.password')}
            draft={secretDraft}
            visible={secretVisible}
            configured={status.hasSecret.webdav === true}
            onChange={setSecretDraft}
            onBlur={() => void saveSecret()}
            onToggle={() => setSecretVisible((v) => !v)}
          />
        </>
      )}

      {provider === 'smb' && (
        <SettingsRow
          title={t('settings.notes.sync.smb.mount')}
          control={
            <input
              className="f-input mono ai-cfg-input"
              value={sync.smb.mountPath}
              placeholder={t('settings.notes.sync.smb.mountPh')}
              spellCheck={false}
              onChange={(e) => patch({ smb: { mountPath: e.target.value } })}
            />
          }
        />
      )}

      {provider === 's3' && (
        <>
          <SettingsRow
            title={t('settings.notes.sync.s3.endpoint')}
            control={
              <input
                className="f-input mono ai-cfg-input"
                value={sync.s3.endpoint}
                spellCheck={false}
                onChange={(e) => patch({ s3: { ...sync.s3, endpoint: e.target.value } })}
              />
            }
          />
          <SettingsRow
            title={t('settings.notes.sync.s3.region')}
            control={
              <input
                className="f-input mono ai-cfg-input"
                value={sync.s3.region}
                spellCheck={false}
                onChange={(e) => patch({ s3: { ...sync.s3, region: e.target.value } })}
              />
            }
          />
          <SettingsRow
            title={t('settings.notes.sync.s3.bucket')}
            control={
              <input
                className="f-input mono ai-cfg-input"
                value={sync.s3.bucket}
                spellCheck={false}
                onChange={(e) => patch({ s3: { ...sync.s3, bucket: e.target.value } })}
              />
            }
          />
          <SettingsRow
            title={t('settings.notes.sync.s3.prefix')}
            control={
              <input
                className="f-input mono ai-cfg-input"
                value={sync.s3.prefix}
                placeholder={t('settings.notes.sync.s3.prefixPh')}
                spellCheck={false}
                onChange={(e) => patch({ s3: { ...sync.s3, prefix: e.target.value } })}
              />
            }
          />
          <SettingsRow
            title={t('settings.notes.sync.s3.accessKey')}
            control={
              <input
                className="f-input mono ai-cfg-input"
                value={sync.s3.accessKeyId}
                spellCheck={false}
                onChange={(e) => patch({ s3: { ...sync.s3, accessKeyId: e.target.value } })}
              />
            }
          />
          <SecretRow
            title={t('settings.notes.sync.s3.secret')}
            draft={secretDraft}
            visible={secretVisible}
            configured={status.hasSecret.s3 === true}
            onChange={setSecretDraft}
            onBlur={() => void saveSecret()}
            onToggle={() => setSecretVisible((v) => !v)}
          />
          <SettingsRow
            title={t('settings.notes.sync.s3.pathStyle')}
            desc={t('settings.notes.sync.s3.pathStyleDesc')}
            control={<Toggle checked={sync.s3.forcePathStyle} onChange={(v) => patch({ s3: { ...sync.s3, forcePathStyle: v } })} />}
          />
        </>
      )}

      <SettingsRow
        title={t('settings.notes.sync.test')}
        control={
          <button className="d-btn" type="button" disabled={busy !== null} onClick={() => void test()}>
            <i className={`fa-solid ${busy === 'test' ? 'fa-circle-notch ai-spin' : 'fa-plug-circle-check'}`} />
            <span>{busy === 'test' ? t('settings.notes.sync.testing') : t('settings.notes.sync.test')}</span>
          </button>
        }
      />
      {tested !== null && (
        <div className={`ai-cfg-test-st ${tested === 'ok' ? 'ok' : 'fail'}`}>
          {t(tested === 'ok' ? 'settings.notes.sync.testOk' : 'settings.notes.sync.testFail')}
        </div>
      )}

      <SettingsRow
        title={t('settings.notes.sync.enabled')}
        desc={t('settings.notes.sync.enabledDesc')}
        control={<Toggle checked={sync.enabled} onChange={(v) => patch({ enabled: v })} />}
      />
      <SettingsRow
        title={t('settings.notes.sync.ignore')}
        desc={t('settings.notes.sync.ignoreDesc')}
        control={
          <textarea
            className="f-input mono"
            rows={4}
            value={sync.ignore}
            spellCheck={false}
            onChange={(e) => patch({ ignore: e.target.value })}
          />
        }
      />
      <SettingsRow
        title={t('settings.notes.sync.ignoreReset')}
        desc={(provider === 'github' || provider === 'gitlab') ? t('settings.notes.sync.emptyDirs') : undefined}
        control={
          <button className="d-btn" type="button" onClick={() => patch({ ignore: DEFAULT_SYNC_IGNORE })}>
            <span>{t('settings.notes.sync.ignoreReset')}</span>
          </button>
        }
      />

      <SettingsRow
        title={status.phase === 'running' || busy === 'sync' ? t('settings.notes.sync.running') : when}
        desc={status.message}
        control={
          <button className="d-btn" type="button" disabled={busy !== null || !sync.enabled} onClick={() => void syncNow()}>
            <i className="fa-solid fa-arrows-rotate" />
            <span>{t('settings.notes.sync.syncNow')}</span>
          </button>
        }
      />

      {status.errors.length > 0 && (
        <ul className="settings-sync-errors">
          {status.errors.map((err) => (
            <li key={`${err.path}:${err.message}`}>{err.path === '' ? err.message : `${err.path}: ${err.message}`}</li>
          ))}
        </ul>
      )}

      {status.conflicts.length > 0 && (
        <>
          <SettingsRow
            title={t('settings.notes.sync.conflicts')}
            control={
              <>
                <button className="d-btn" type="button" onClick={() => void resolveAll('local')}>
                  <span>{t('settings.notes.sync.keepAllLocal')}</span>
                </button>
                <button className="d-btn" type="button" onClick={() => void resolveAll('remote')}>
                  <span>{t('settings.notes.sync.keepAllRemote')}</span>
                </button>
              </>
            }
          />
          {status.conflicts.map((path) => (
            <SettingsRow
              key={path}
              title={path}
              control={
                <>
                  <button className="d-btn" type="button" onClick={() => void resolve(path, 'local')}>
                    <span>{t('settings.notes.sync.keepLocal')}</span>
                  </button>
                  <button className="d-btn" type="button" onClick={() => void resolve(path, 'remote')}>
                    <span>{t('settings.notes.sync.keepRemote')}</span>
                  </button>
                </>
              }
            />
          ))}
        </>
      )}
    </SettingsSection>
  )
}

function SecretRow({
  title,
  draft,
  visible,
  configured,
  onChange,
  onBlur,
  onToggle
}: {
  title: string
  draft: string
  visible: boolean
  configured: boolean
  onChange: (value: string) => void
  onBlur: () => void
  onToggle: () => void
}): React.JSX.Element {
  const t = useT()
  return (
    <SettingsRow
      title={title}
      desc={t(configured ? 'settings.notes.sync.secretSet' : 'settings.notes.sync.secretEmpty')}
      control={
        <div className="ai-cfg-key-wrap">
          <div className="ai-cfg-key-field">
          <input
            className="f-input mono ai-cfg-input"
            type={visible ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            value={draft}
            placeholder={configured ? t('settings.notes.sync.secretSet') : ''}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
          />
          <button
            className="ai-cfg-eye"
            type="button"
            title={t(visible ? 'settings.notes.sync.secretHide' : 'settings.notes.sync.secretShow')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onToggle}
          >
            <i className={`fa-solid ${visible ? 'fa-eye-slash' : 'fa-eye'}`} />
          </button>
          </div>
        </div>
      }
    />
  )
}
