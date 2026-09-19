// 分组块(demo .cfg-group + drawer.js toggleCfg:头点击切 body display + chevron open 类)
// ported-from: docs/demo/js/drawer.js toggleCfg + index.html .cfg-group @ 06ff9ba
// 抽屉编辑页与状态页共用(原为 EditTab 局部组件;StatusTab 曾手写一份不可点的假折叠头)
import { useState } from 'react'

export function CfgGroup({
  icon,
  title,
  children,
  defaultOpen = true
}: {
  icon: string
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="cfg-group">
      <div className="cfg-group-hdr" onClick={() => setOpen(!open)}>
        <i className={icon} />
        <span className="cfg-group-title">{title}</span>
        <i className={`fa-solid fa-chevron-down cfg-chevron${open ? ' open' : ''}`} />
      </div>
      <div className="cfg-group-body" style={{ display: open ? 'flex' : 'none' }}>
        {children}
      </div>
    </div>
  )
}
