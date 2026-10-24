// 设置 › 关于 里的更新面板:检查进度 / 下载进度 / 重启并升级 / 失败兜底命令。
//
// 所有状态都来自 main(update-store 镜像),组件本身没有「检查中」之类本地态 ——
// 切走设置页再回来,进度仍然正确。

import { useT, useFmt } from '../../hooks/useT'
import { copyText, showToast } from '../../lib/utils'
import { useUpdateStore } from '../../state/update-store'
import type { UpdateErrorCode, UpdatePhase } from '@shared/ipc'

const PHASE_KEY: Record<UpdatePhase, string> = {
  idle: 'settings.update.phase.idle',
  checking: 'settings.update.phase.checking',
  upToDate: 'settings.update.phase.upToDate',
  available: 'settings.update.phase.available',
  downloading: 'settings.update.phase.downloading',
  verifying: 'settings.update.phase.verifying',
  ready: 'settings.update.phase.ready',
  applying: 'settings.update.phase.applying',
  restarting: 'settings.update.phase.restarting',
  error: 'settings.update.phase.error'
}

const ERROR_KEY: Record<UpdateErrorCode, string> = {
  network: 'settings.update.error.network',
  manifest: 'settings.update.error.manifest',
  download: 'settings.update.error.download',
  verify: 'settings.update.error.verify',
  permission: 'settings.update.error.permission',
  unsupported: 'settings.update.error.unsupported',
  apply: 'settings.update.error.apply',
  unknown: 'settings.update.error.unknown'
}

/** 这些错误重试下载有意义;unsupported/permission/apply 重试只会再失败一次(apply 有单独的重试入口) */
const RETRYABLE: ReadonlySet<UpdateErrorCode> = new Set([
  'manifest',
  'download',
  'verify',
  'unknown'
])

function bytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${n} B`
}

export function UpdatePanel(): React.JSX.Element | null {
  const t = useT()
  const fmt = useFmt()
  const state = useUpdateStore((s) => s.state)
  const countdown = useUpdateStore((s) => s.countdown)
  const postponed = useUpdateStore((s) => s.postponed)
  const dirtyBlocked = useUpdateStore((s) => s.dirtyBlocked)
  const result = useUpdateStore((s) => s.result)
  const check = useUpdateStore((s) => s.check)
  const retryDownload = useUpdateStore((s) => s.retryDownload)
  const applyUpdate = useUpdateStore((s) => s.apply)
  const cancel = useUpdateStore((s) => s.cancel)
  const postpone = useUpdateStore((s) => s.postpone)
  const revealLog = useUpdateStore((s) => s.revealLog)
  const dismissResult = useUpdateStore((s) => s.dismissResult)

  // 从未检查过、也没有上次升级结果 → 整个面板不占位置(按钮在版本行里)
  if ((!state || state.phase === 'idle') && !result) return null

  const phase = state?.phase ?? 'idle'
  const busy = phase === 'checking' || phase === 'applying' || phase === 'restarting'
  const downloadPercent =
    phase === 'downloading' || phase === 'verifying'
      ? (state?.progress?.percent ?? null)
      : null
  const detailsTitle =
    phase === 'idle' && result
      ? t('settings.update.result.title')
      : state?.error
        ? t(ERROR_KEY[state.error.code])
        : t(PHASE_KEY[phase])

  const copyFallback = async (): Promise<void> => {
    if (!state) return
    await copyText(state.fallbackCommand)
    showToast(t('settings.update.copied'), '#4ade80', 'fa-copy')
  }

  return (
    <div className="update-panel" data-phase={phase}>
      <div className="update-panel-head">
        <div className="update-panel-title">
          <i className="fa-solid fa-cloud-arrow-down" />
          <span>{detailsTitle}</span>
          {state?.targetVersion && phase !== 'upToDate' && (
            <span className="update-version-chip">v{state.targetVersion}</span>
          )}
        </div>
        {downloadPercent !== null && (
          <span className="update-percent">{downloadPercent}%</span>
        )}
      </div>

      {(phase === 'downloading' || phase === 'verifying') && (
        <div className={`update-progress${downloadPercent === null ? ' indeterminate' : ''}`}>
          <div
            className="update-progress-bar"
            style={downloadPercent === null ? undefined : { width: `${downloadPercent}%` }}
          />
        </div>
      )}

      {state?.progress && phase === 'downloading' && state.progress.total !== null && (
        <div className="update-detail">
          {fmt(t('settings.update.msg.progress'), {
            D: bytes(state.progress.received),
            T: bytes(state.progress.total)
          })}
        </div>
      )}
      {/* 服务端没给 content-length:没有百分比可看,至少把正在下载的文件名显示出来 */}
      {state?.progress && phase === 'downloading' && state.progress.total === null && state.message && (
        <div className="update-detail">{state.message}</div>
      )}

      {phase === 'checking' && <div className="update-detail">{t('settings.update.msg.checking')}</div>}
      {phase === 'upToDate' && (
        <div className="update-detail">
          {state?.message ??
            fmt(t('settings.update.msg.upToDate'), { V: state?.currentVersion ?? '' })}
        </div>
      )}
      {phase === 'available' && !state?.error && (
        <div className="update-detail">{state?.message ?? ''}</div>
      )}
      {phase === 'downloading' && !state?.progress && (
        <div className="update-detail">{state?.message ?? t('settings.update.msg.preparing')}</div>
      )}
      {phase === 'verifying' && (
        <div className="update-detail">{state?.message ?? t('settings.update.msg.verifying')}</div>
      )}
      {phase === 'ready' && (
        <div className="update-detail">
          {countdown !== null
            ? fmt(t('settings.update.msg.countdown'), { N: countdown })
            : postponed
              ? t('settings.update.msg.postponed')
              : dirtyBlocked
                ? t('settings.update.msg.dirtyBlocked')
                : (state?.message ?? '')}
        </div>
      )}
      {(phase === 'applying' || phase === 'restarting') && (
        <div className="update-detail">{state?.message ?? ''}</div>
      )}

      {state?.error && (
        <div className="update-error">
          <div className="update-error-text">{state.error.message}</div>
          <div className="update-fallback">
            <div className="update-fallback-label">{t('settings.update.fallback')}</div>
            <div className="update-fallback-row">
              <code>{state.fallbackCommand}</code>
              <button className="d-btn" type="button" onClick={() => void copyFallback()}>
                <i className="fa-regular fa-copy" />
                <span>{t('settings.update.btn.copy')}</span>
              </button>
              <button className="d-btn" type="button" onClick={() => void revealLog()}>
                <i className="fa-solid fa-file-lines" />
                <span>{t('settings.update.btn.log')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="update-result">
          <div className="update-result-text">
            <span>
              {result.status === 'installed'
                ? fmt(t('settings.update.result.installed'), { FROM: result.from, TO: result.to })
                : result.status === 'rolled-back'
                  ? fmt(t('settings.update.result.rolledBack'), { FROM: result.from, TO: result.to })
                  : fmt(t('settings.update.result.failed'), { FROM: result.from, TO: result.to })}
            </span>
            {/* 回滚也失败时旧版本只剩这份备份,把路径直接显示出来,别让用户去翻日志 */}
            {result.status === 'failed' && result.backup && (
              <code className="update-result-backup">{result.backup}</code>
            )}
          </div>
          <button className="update-link-btn" type="button" onClick={dismissResult}>
            {t('settings.update.btn.dismiss')}
          </button>
        </div>
      )}

      <div className="update-actions">
        {phase === 'ready' && (
          <>
            <button className="d-btn green" type="button" onClick={() => void applyUpdate()}>
              <i className="fa-solid fa-rotate-right" />
              <span>{t('settings.update.btn.restartNow')}</span>
            </button>
            {countdown !== null && (
              <button className="d-btn" type="button" onClick={postpone}>
                <i className="fa-solid fa-clock" />
                <span>{t('settings.update.btn.later')}</span>
              </button>
            )}
          </>
        )}
        {(phase === 'downloading' || phase === 'verifying') && (
          <button className="d-btn" type="button" onClick={() => void cancel()}>
            <i className="fa-solid fa-xmark" />
            <span>{t('settings.update.btn.cancel')}</span>
          </button>
        )}
        {phase === 'available' && state?.mode !== 'none' && (
          <button className="d-btn blue" type="button" onClick={() => void retryDownload()}>
            <i className="fa-solid fa-download" />
            <span>{t('settings.update.btn.download')}</span>
          </button>
        )}
        {phase === 'error' && state?.error?.code === 'apply' && (
          <button className="d-btn blue" type="button" onClick={() => void applyUpdate()}>
            <i className="fa-solid fa-rotate-right" />
            <span>{t('settings.update.btn.retryApply')}</span>
          </button>
        )}
        {phase === 'error' && state?.error && RETRYABLE.has(state.error.code) && state.mode !== 'none' && state.targetVersion && (
          <button className="d-btn blue" type="button" onClick={() => void retryDownload()}>
            <i className="fa-solid fa-rotate-right" />
            <span>{t('settings.update.btn.retry')}</span>
          </button>
        )}
        {(phase === 'error' || phase === 'upToDate') && (
          <button className="d-btn" type="button" disabled={busy} onClick={() => void check()}>
            <i className="fa-solid fa-arrows-rotate" />
            <span>{t('settings.update.btn.recheck')}</span>
          </button>
        )}
      </div>
    </div>
  )
}
