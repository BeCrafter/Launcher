// 全局更新提示条,两种形态共用同一个右下角位置:
//
//   available —— 自动检查发现新版本(只提示,不自动下载)。点「下载」走与设置页
//                「开始下载」同一个 IPC,之后交给既有的下载/校验/重启流程。
//   ready     —— 下载校验完成。自动重启倒计时不只在设置里可见:用户点完检查后通常
//                会切回别的页面,若只在设置页显示文案,10 秒后应用会像自己退出一样
//                重启。这里给出跨页面提示,并提供「立即重启 / 稍后」。
//
// 显示哪种形态由 lib/update-banner.ts 的真值表决定(可单测)。

import { useT, useFmt } from '../../hooks/useT'
import { updateBannerKind } from '../../lib/update-banner'
import { useUpdateStore } from '../../state/update-store'

export function UpdateReadyBanner(): React.JSX.Element | null {
  const t = useT()
  const fmt = useFmt()
  const phase = useUpdateStore((s) => s.state?.phase ?? null)
  const mode = useUpdateStore((s) => s.state?.mode ?? null)
  const target = useUpdateStore((s) => s.state?.targetVersion ?? null)
  const hasError = useUpdateStore((s) => s.state?.error != null)
  const countdown = useUpdateStore((s) => s.countdown)
  const postponed = useUpdateStore((s) => s.postponed)
  const dirtyBlocked = useUpdateStore((s) => s.dirtyBlocked)
  const dismissedVersion = useUpdateStore((s) => s.dismissedVersion)
  const download = useUpdateStore((s) => s.download)
  const dismissAvailable = useUpdateStore((s) => s.dismissAvailable)
  const applyUpdate = useUpdateStore((s) => s.apply)
  const postpone = useUpdateStore((s) => s.postpone)

  const kind = updateBannerKind({
    phase,
    mode,
    targetVersion: target,
    dismissedVersion,
    postponed,
    hasError
  })
  if (kind === 'none') return null

  if (kind === 'available') {
    return (
      <div className="update-ready-banner" data-phase="available">
        <i className="fa-solid fa-circle-down update-ready-icon" />
        <div className="update-ready-copy">
          <strong>{fmt(t('settings.update.banner.availableTitle'), { V: target ?? '' })}</strong>
          <span>{t('settings.update.msg.availableDetail')}</span>
        </div>
        <div className="update-ready-actions">
          <button
            className="d-btn blue"
            type="button"
            data-action="download"
            onClick={() => void download()}
          >
            <i className="fa-solid fa-download" />
            <span>{t('settings.update.btn.download')}</span>
          </button>
          <button className="d-btn" type="button" data-action="later" onClick={dismissAvailable}>
            <i className="fa-solid fa-clock" />
            <span>{t('settings.update.btn.later')}</span>
          </button>
        </div>
      </div>
    )
  }

  const detail =
    countdown !== null
      ? fmt(t('settings.update.msg.countdown'), { N: countdown })
      : dirtyBlocked
        ? t('settings.update.msg.dirtyBlocked')
        : t('settings.update.msg.readyDetail')

  return (
    <div className="update-ready-banner" data-phase="ready">
      <i className="fa-solid fa-arrow-up-from-bracket update-ready-icon" />
      <div className="update-ready-copy">
        <strong>
          {t('settings.update.phase.ready')}
          {target ? ` · v${target}` : ''}
        </strong>
        <span>{detail}</span>
      </div>
      <div className="update-ready-actions">
        <button className="d-btn green" type="button" data-action="restart" onClick={() => void applyUpdate()}>
          <i className="fa-solid fa-rotate-right" />
          <span>{t('settings.update.btn.restartNow')}</span>
        </button>
        <button className="d-btn" type="button" data-action="later" onClick={postpone}>
          <i className="fa-solid fa-clock" />
          <span>{t('settings.update.btn.later')}</span>
        </button>
      </div>
    </div>
  )
}
