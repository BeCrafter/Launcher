// 空状态(demo components.js emptyState)
export function EmptyState({ icon, text }: { icon: string; text: string }): React.JSX.Element {
  return (
    <div className="empty-state">
      <i className={icon} />
      <p>{text}</p>
    </div>
  )
}
