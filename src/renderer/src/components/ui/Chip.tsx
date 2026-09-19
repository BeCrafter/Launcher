// 过滤 chip(过滤栏按钮:icon + 文案,active 态由 filter bar 管理)
// variant='sub' = 次级 chip(应用新增):同一过滤栏里作为次要维度使用,视觉更轻(见 views.css .chip-sub)
export function Chip({
  active,
  icon,
  label,
  variant,
  onClick
}: {
  active?: boolean
  icon?: string
  label: React.ReactNode
  variant?: 'sub'
  onClick?: () => void
}): React.JSX.Element {
  return (
    <button type="button" className={`chip${variant === 'sub' ? ' chip-sub' : ''}${active ? ' active' : ''}`} onClick={onClick}>
      {icon && <i className={icon} />} {label}
    </button>
  )
}
