// 模态/抽屉受控壳:DOM 常驻 + .open 类切换(与 demo CSS 过渡契约一致)
// modal-mask = 居中模态;edit-drawer-mask = 右侧抽屉;遮罩自点关闭(demo closeModalBg)
export function Modal({
  id,
  open,
  kind = 'modal',
  onClose,
  children
}: {
  id: string
  open: boolean
  kind?: 'modal' | 'drawer'
  onClose?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const cls = kind === 'drawer' ? 'edit-drawer-mask' : 'modal-mask'
  return (
    <div
      className={cls + (open ? ' open' : '')}
      id={id}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      {children}
    </div>
  )
}
