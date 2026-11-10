// 笔记设置里的同步区。
// 协议是一排切换,不是五张大卡片:选中哪个才渲染哪一块,字段两列排。
// 排除规则默认收着,改过的才展开。各块的值分开存在 notesSync 里,切走再切回来还在。
// 秘密不进设置文件:失焦才写入,眼睛按钮临时显示。

import { useEffect, useId, useRef, useState } from 'react'
import { DEFAULT_SYNC_IGNORE } from '@shared/notes'
import type { NotesSyncGitConfig, NotesSyncProvider, NotesSyncSettings } from '@shared/settings'
import type { NotesSyncStatus } from '@shared/ipc'
import { useT, useFmt } from '../../hooks/useT'
import { useSettingsStore } from '../../state/settings-store'
import { dataSource } from '../../data'
import { showToast } from '../../lib/utils'
import { SettingsSection } from './SettingsBits'
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
  const [ignoreOpen, setIgnoreOpen] = useState(false)
  const ignoreSeen = useRef(false)

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

  // 设置是异步进来的。第一次看到时,规则已经不是默认就展开;之后由用户自己收放
  useEffect(() => {
    if (!sync || ignoreSeen.current) return
    ignoreSeen.current = true
    if (sync.ignore !== DEFAULT_SYNC_IGNORE) setIgnoreOpen(true)
  }, [sync])

  if (!sync) return <></>

  const patch = (next: Partial<NotesSyncSettings>): void => {
    set({ notesSync: { ...sync, ...next } })
  }

  const patchGit = (field: keyof NotesSyncGitConfig, value: string): void => {
    if (provider === 'github') patch({ github: { ...sync.github, [field]: value } })
    else if (provider === 'gitlab') patch({ gitlab: { ...sync.gitlab, [field]: value } })
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
  const ignoreCustom = sync.ignore !== DEFAULT_SYNC_IGNORE
  const git = provider === 'github' || provider === 'gitlab' ? sync[provider] : null

  return (
    <SettingsSection icon="fa-solid fa-arrows-rotate" title={t('settings.notes.sync.sectionTitle')} desc={t('settings.notes.sync.sectionDesc')}>
      <div className="sync-protocols" role="group" aria-label={t('settings.notes.sync.sectionTitle')}>
        {PROVIDERS.map((item) => {
          const on = item.id === provider
          return (
            <button
              key={item.id}
              type="button"
              className={`sync-protocol${on ? ' selected' : ''}`}
              aria-pressed={on}
              onClick={() => patch({ provider: item.id })}
            >
              <i className={item.icon} />
              <span className="sync-protocol-name">{t(`settings.notes.sync.${item.id}.name`)}</span>
            </button>
          )
        })}
      </div>
      <div className="sync-protocol-desc">{t(`settings.notes.sync.${provider}.desc`)}</div>

      <div className="sync-fields">
        {git && (
          <>
            <Field label={t('settings.notes.sync.repo')}>
              <input
                className="f-input mono"
                value={git.repo}
                placeholder={t(`settings.notes.sync.${provider}.repoPh`)}
                spellCheck={false}
                onChange={(e) => patchGit('repo', e.target.value)}
              />
            </Field>
            <Field label={t('settings.notes.sync.branch')}>
              <input
                className="f-input mono"
                value={git.branch}
                placeholder={t('settings.notes.sync.branchPh')}
                spellCheck={false}
                onChange={(e) => patchGit('branch', e.target.value)}
              />
            </Field>
            <Field label={t('settings.notes.sync.api')} wide>
              <input
                className="f-input mono"
                value={git.apiBaseUrl}
                placeholder={t(`settings.notes.sync.${provider}.apiPh`)}
                spellCheck={false}
                onChange={(e) => patchGit('apiBaseUrl', e.target.value)}
              />
            </Field>
            <SecretField
              wide
              title={t('settings.notes.sync.token')}
              draft={secretDraft}
              visible={secretVisible}
              configured={status.hasSecret[provider === 'gitlab' ? 'gitlab' : 'github'] === true}
              onChange={setSecretDraft}
              onBlur={() => void saveSecret()}
              onToggle={() => setSecretVisible((v) => !v)}
            />
          </>
        )}

        {provider === 'webdav' && (
          <>
            <Field label={t('settings.notes.sync.webdav.url')} wide>
              <input
                className="f-input mono"
                value={sync.webdav.url}
                spellCheck={false}
                onChange={(e) => patch({ webdav: { ...sync.webdav, url: e.target.value } })}
              />
            </Field>
            <Field label={t('settings.notes.sync.webdav.user')}>
              <input
                className="f-input"
                value={sync.webdav.username}
                spellCheck={false}
                onChange={(e) => patch({ webdav: { ...sync.webdav, username: e.target.value } })}
              />
            </Field>
            <SecretField
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
          <Field label={t('settings.notes.sync.smb.mount')} wide>
            <input
              className="f-input mono"
              value={sync.smb.mountPath}
              placeholder={t('settings.notes.sync.smb.mountPh')}
              spellCheck={false}
              onChange={(e) => patch({ smb: { mountPath: e.target.value } })}
            />
          </Field>
        )}

        {provider === 's3' && (
          <>
            <Field label={t('settings.notes.sync.s3.endpoint')} wide>
              <input
                className="f-input mono"
                value={sync.s3.endpoint}
                spellCheck={false}
                onChange={(e) => patch({ s3: { ...sync.s3, endpoint: e.target.value } })}
              />
            </Field>
            <Field label={t('settings.notes.sync.s3.region')}>
              <input
                className="f-input mono"
                value={sync.s3.region}
                spellCheck={false}
                onChange={(e) => patch({ s3: { ...sync.s3, region: e.target.value } })}
              />
            </Field>
            <Field label={t('settings.notes.sync.s3.bucket')}>
              <input
                className="f-input mono"
                value={sync.s3.bucket}
                spellCheck={false}
                onChange={(e) => patch({ s3: { ...sync.s3, bucket: e.target.value } })}
              />
            </Field>
            <Field label={t('settings.notes.sync.s3.prefix')} wide>
              <input
                className="f-input mono"
                value={sync.s3.prefix}
                placeholder={t('settings.notes.sync.s3.prefixPh')}
                spellCheck={false}
                onChange={(e) => patch({ s3: { ...sync.s3, prefix: e.target.value } })}
              />
            </Field>
            <Field label={t('settings.notes.sync.s3.accessKey')}>
              <input
                className="f-input mono"
                value={sync.s3.accessKeyId}
                spellCheck={false}
                onChange={(e) => patch({ s3: { ...sync.s3, accessKeyId: e.target.value } })}
              />
            </Field>
            <SecretField
              title={t('settings.notes.sync.s3.secret')}
              draft={secretDraft}
              visible={secretVisible}
              configured={status.hasSecret.s3 === true}
              onChange={setSecretDraft}
              onBlur={() => void saveSecret()}
              onToggle={() => setSecretVisible((v) => !v)}
            />
            <div className="sync-field wide sync-field-switch">
              <div>
                <div className="sync-field-label">{t('settings.notes.sync.s3.pathStyle')}</div>
                <div className="sync-field-hint">{t('settings.notes.sync.s3.pathStyleDesc')}</div>
              </div>
              <Toggle checked={sync.s3.forcePathStyle} onChange={(v) => patch({ s3: { ...sync.s3, forcePathStyle: v } })} />
            </div>
          </>
        )}
      </div>

      <div className="sync-bar">
        <div className="sync-bar-enable">
          <div>
            <div>{t('settings.notes.sync.enabled')}</div>
            <div className="sync-field-hint">{t('settings.notes.sync.enabledDesc')}</div>
          </div>
          <Toggle checked={sync.enabled} onChange={(v) => patch({ enabled: v })} />
        </div>
        <div className="sync-bar-status">
          <div>{status.phase === 'running' || busy === 'sync' ? t('settings.notes.sync.running') : when}</div>
          {status.message && <div className="sync-bar-msg">{status.message}</div>}
        </div>
        <div className="sync-bar-actions">
          <button className="d-btn" type="button" disabled={busy !== null} onClick={() => void test()}>
            <i className={`fa-solid ${busy === 'test' ? 'fa-circle-notch ai-spin' : 'fa-plug-circle-check'}`} />
            <span>{busy === 'test' ? t('settings.notes.sync.testing') : t('settings.notes.sync.test')}</span>
          </button>
          {tested !== null && (
            <span className={`ai-cfg-test-st ${tested === 'ok' ? 'ok' : 'fail'}`}>
              {t(tested === 'ok' ? 'settings.notes.sync.testOk' : 'settings.notes.sync.testFail')}
            </span>
          )}
          <button className="d-btn" type="button" disabled={busy !== null || !sync.enabled} onClick={() => void syncNow()}>
            <i className={`fa-solid fa-arrows-rotate${busy === 'sync' ? ' ai-spin' : ''}`} />
            <span>{t('settings.notes.sync.syncNow')}</span>
          </button>
        </div>
      </div>

      {status.errors.length > 0 && (
        <ul className="settings-sync-errors">
          {status.errors.map((err) => (
            <li key={`${err.path}:${err.message}`}>{err.path === '' ? err.message : `${err.path}: ${err.message}`}</li>
          ))}
        </ul>
      )}

      {status.conflicts.length > 0 && (
        <div className="sync-conflicts">
          <div className="sync-conflicts-hd">
            <span>{t('settings.notes.sync.conflicts')}</span>
            <button className="d-btn" type="button" onClick={() => void resolveAll('local')}>
              <span>{t('settings.notes.sync.keepAllLocal')}</span>
            </button>
            <button className="d-btn" type="button" onClick={() => void resolveAll('remote')}>
              <span>{t('settings.notes.sync.keepAllRemote')}</span>
            </button>
          </div>
          <div className="sync-conflicts-list">
            {status.conflicts.map((path) => (
              <div className="sync-conflict" key={path}>
                <span className="sync-conflict-path" title={path}>
                  {path}
                </span>
                <button className="d-btn" type="button" onClick={() => void resolve(path, 'local')}>
                  <span>{t('settings.notes.sync.keepLocal')}</span>
                </button>
                <button className="d-btn" type="button" onClick={() => void resolve(path, 'remote')}>
                  <span>{t('settings.notes.sync.keepRemote')}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        className="sync-fold"
        type="button"
        aria-expanded={ignoreOpen}
        onClick={() => setIgnoreOpen((open) => !open)}
      >
        <i className={`fa-solid fa-chevron-right${ignoreOpen ? ' open' : ''}`} />
        <span>{t('settings.notes.sync.ignore')}</span>
        <span className="sync-fold-hint">
          {t(ignoreCustom ? 'settings.notes.sync.ignoreStateCustom' : 'settings.notes.sync.ignoreStateDefault')}
        </span>
      </button>
      {ignoreOpen && (
        <div className="sync-ignore">
          <div className="sync-field-hint">{t('settings.notes.sync.ignoreDesc')}</div>
          <textarea
            className="f-input mono"
            rows={4}
            value={sync.ignore}
            spellCheck={false}
            onChange={(e) => patch({ ignore: e.target.value })}
          />
          <div className="sync-ignore-actions">
            {git ? <div className="sync-field-hint">{t('settings.notes.sync.emptyDirs')}</div> : <span />}
            <button className="d-btn" type="button" onClick={() => patch({ ignore: DEFAULT_SYNC_IGNORE })}>
              <span>{t('settings.notes.sync.ignoreReset')}</span>
            </button>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}

function Field({
  label,
  wide,
  children
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className={`sync-field${wide ? ' wide' : ''}`}>
      <span className="sync-field-label">{label}</span>
      {children}
    </label>
  )
}

function SecretField({
  title,
  draft,
  visible,
  configured,
  wide,
  onChange,
  onBlur,
  onToggle
}: {
  title: string
  draft: string
  visible: boolean
  configured: boolean
  wide?: boolean
  onChange: (value: string) => void
  onBlur: () => void
  onToggle: () => void
}): React.JSX.Element {
  const t = useT()
  const id = useId()
  return (
    <div className={`sync-field${wide ? ' wide' : ''}`}>
      <label className="sync-field-label" htmlFor={id}>
        {title}
      </label>
      <div className="ai-cfg-key-field">
        <input
          id={id}
          className="f-input mono"
          type={visible ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          value={draft}
          placeholder={configured ? t('settings.notes.sync.secretSet') : t('settings.notes.sync.secretEmpty')}
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
  )
}
