// 全局「更新已就绪」提示条。
//
// 自动重启倒计时不只在设置 › 关于里可见:用户点完检查后通常会切回别的页面,
// 若只在设置页显示文案,10 秒后应用会像自己退出一样重启。这里给出跨页面的固定提示,
// 并提供「立即重启 / 稍后」两个动作;窗口不可见时 store 会暂停倒计时(见 update-store)。

import { useT, useFmt } from '../../hooks/useT'
import { useUpdateStore } from '../../state/update-store'

export function UpdateReadyBanner(): React.JSX.Element | null {
  const t = useT()
  const fmt = useFmt()
  const phase = useUpdateStore((s) => s.state?.phase)
  const target = useUpdateStore((s) => s.state?.targetVersion)
  const countdown = useUpdateStore((s) => s.countdown)
  const postponed = useUpdateStore((s) => s.postponed)
  const dirtyBlocked = useUpdateStore((s) => s.dirtyBlocked)
  const applyUpdate = useUpdateStore((s) => s.apply)
  const postpone = useUpdateStore((s) => s.postpone)

  if (phase !== 'ready' || postponed) return null

  const detail =
    countdown !== null
      ? fmt(t('settings.update.msg.countdown'), { N: countdown })
      : dirtyBlocked
        ? t('settings.update.msg.dirtyBlocked')
        : t('settings.update.msg.readyDetail')

  return (
    <div className="update-ready-banner">
      <i className="fa-solid fa-arrow-up-from-bracket update-ready-icon" />
      <div className="update-ready-copy">
        <strong>
          {t('settings.update.phase.ready')}
          {target ? ` · v${target}` : ''}
        </strong>
        <span>{detail}</span>
      </div>
      <div className="update-ready-actions">
        <button className="d-btn green" type="button" onClick={() => void applyUpdate()}>
          <i className="fa-solid fa-rotate-right" />
          <span>{t('settings.update.btn.restartNow')}</span>
        </button>
        <button className="d-btn" type="button" onClick={postpone}>
          <i className="fa-solid fa-clock" />
          <span>{t('settings.update.btn.later')}</span>
        </button>
      </div>
    </div>
  )
}
