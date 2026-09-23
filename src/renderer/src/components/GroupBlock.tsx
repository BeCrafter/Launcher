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
  hidden,
  children
}: {
  id: string
  icon: string
  color: string
  label: string
  count: number
  labelTitle?: string
  /**
   * 空组时**隐藏而不是卸载**(应用新增,端口服务视图用):
   * 卸载会连 `open` 状态一起丢掉 —— 组内条目下次回来时折叠状态被重置成展开,
   * 整块内容突然铺开,正是「每 3s 刷新一次」下最容易被看见的闪动。
   */
  hidden?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div className="group-block" style={hidden ? { display: 'none' } : undefined}>
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
