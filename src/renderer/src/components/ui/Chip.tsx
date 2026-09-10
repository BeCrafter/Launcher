// 过滤 chip(过滤栏按钮:icon + 文案,active 态由 filter bar 管理)
export function Chip({
  active,
  icon,
  label,
  onClick
}: {
  active?: boolean
  icon?: string
  label: React.ReactNode
  onClick?: () => void
}): React.JSX.Element {
  return (
    <button type="button" className={`chip${active ? ' active' : ''}`} onClick={onClick}>
      {icon && <i className={icon} />} {label}
    </button>
  )
}
