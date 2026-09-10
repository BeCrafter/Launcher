// ported-from: docs/demo/js/components.js groupBlock + utils.js toggleGroupBlock @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 分组块(demo components.js groupBlock:分组头 + 卡片网格容器,可折叠)
import { useState } from 'react'

export function GroupBlock({
  id,
  icon,
  color,
  label,
  count,
  labelTitle,
  children
}: {
  id: string
  icon: string
  color: string
  label: string
  count: number
  labelTitle?: string
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div className="group-block">
      <div className="group-block-header" onClick={() => setOpen(!open)}>
        <i className={icon} style={{ fontSize: 11, color }} />
        <span className="group-block-label" title={labelTitle}>
          {label}
        </span>
        <span className="group-block-count">{count}</span>
        <i className={`fa-solid fa-chevron-right group-block-chevron${open ? ' open' : ''}`} />
      </div>
      <div className="group-card-grid" id={id} style={{ display: open ? undefined : 'none' }}>
        {children}
      </div>
    </div>
  )
}
