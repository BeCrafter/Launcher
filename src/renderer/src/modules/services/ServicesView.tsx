// 端口服务视图(Phase 1 占位:列表在 Phase 5 落地)
import { useT } from '../../hooks/useT'

export function ServicesView(): React.JSX.Element {
  const t = useT()
  return (
    <div id="view-services" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>
      <div className="list-container" id="svcList" />
      <div style={{ padding: '16px 4px', color: 'var(--dim)', fontSize: 11 }}>{t('svc.empty')}</div>
    </div>
  )
}
