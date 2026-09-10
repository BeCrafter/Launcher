// 设置页结构件(demo settings-section/settings-row 同构;六 pane 共用)
import { useT } from '../../hooks/useT'

export function SettingsSection({
  icon,
  title,
  desc,
  children
}: {
  icon: string
  title?: string
  desc?: string
  children: React.ReactNode
}): React.JSX.Element {
  const t = useT()
  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <div className="settings-section-icon">
          <i className={icon} />
        </div>
        <div>
          {title && <div className="settings-section-title">{title}</div>}
          {desc && <div className="settings-section-desc">{desc}</div>}
        </div>
      </div>
      <div className="settings-body">{children}</div>
    </section>
  )
}

export function SettingsRow({
  title,
  desc,
  descKey,
  control
}: {
  title: React.ReactNode
  desc?: React.ReactNode
  descKey?: string
  control?: React.ReactNode
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-title">{title}</div>
        {descKey && <div className="settings-row-desc">{t(descKey)}</div>}
        {!descKey && desc && <div className="settings-row-desc">{desc}</div>}
      </div>
      {control}
    </div>
  )
}

export function SettingsHero({
  title,
  subtitle
}: {
  title: string
  subtitle: string
}): React.JSX.Element {
  return (
    <div className="settings-hero">
      <div className="settings-title">{title}</div>
      <div className="settings-subtitle">{subtitle}</div>
    </div>
  )
}
