// ported-from: docs/demo/js/components.js emptyState @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 空状态(demo components.js emptyState)
export function EmptyState({ icon, text }: { icon: string; text: string }): React.JSX.Element {
  return (
    <div className="empty-state">
      <i className={icon} />
      <p>{text}</p>
    </div>
  )
}
