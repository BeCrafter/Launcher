// L0 原语:首屏数据加载骨架(纯视觉,无文案;i18n 字典从冻结 demo 生成,不新增 loading 键)
// 消费点:三域视图在 !loaded && 数据为空 时渲染,替代把「加载中」误呈现为「没有数据」的 EmptyState
export function Skeleton({ rows = 5 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" style={{ width: `${100 - (i % 3) * 8}%` }} />
      ))}
    </div>
  )
}
