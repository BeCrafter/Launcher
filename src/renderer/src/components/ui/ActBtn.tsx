// ported-from: docs/demo/js/components.js actBtn @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 操作按钮(demo components.js actBtn / PendingActionButton;props 形状对齐 demo opts)
export interface ActBtnOpts {
  cls?: string
  title?: string
  onPress?: (e: React.MouseEvent) => void
  btnStyle?: React.CSSProperties
  iconStyle?: React.CSSProperties
  disabled?: boolean
}

export function ActBtn({ icon, opts }: { icon: string; opts?: ActBtnOpts }): React.JSX.Element {
  const o = opts ?? {}
  return (
    <button
      type="button"
      className={`act-btn${o.cls ? ' ' + o.cls : ''}`}
      style={o.btnStyle}
      title={o.title}
      onClick={o.onPress}
      disabled={o.disabled}
    >
      <i className={icon} style={o.iconStyle} />
    </button>
  )
}
