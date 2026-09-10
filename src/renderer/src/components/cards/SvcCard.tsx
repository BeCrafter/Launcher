// ported-from: docs/demo/js/components.js svcCard + services.js svcCardHtml @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 端口服务卡片(demo services.js svcCardHtml + components.js svcCard;meta chips 内联样式逐字)
import { StatusDot } from '../ui/StatusDot'
import { TagChip } from '../ui/TagChip'
import { ActBtn } from '../ui/ActBtn'
import { classifySvc, SVC_GROUP_META } from '../../lib/classify'
import { fmt } from '../../i18n'
import type { PortService } from '@shared/models'

export function SvcCard({
  svc,
  brewManaged,
  t,
  onOpen,
  onCopy,
  onKill
}: {
  svc: PortService
  brewManaged: ReadonlySet<string>
  t: (k: string) => string
  onOpen: () => void
  onCopy: () => void
  onKill: () => void
}): React.JSX.Element {
  const type = classifySvc(svc, brewManaged)
  const meta = SVC_GROUP_META[type]
  return (
    <div className="svc-col-card" id={`svc_${svc.id}`}>
      <div className="svc-r1">
        <StatusDot status={svc.status} />
        <span className="svc-name" title={svc.name}>
          {svc.name}
        </span>
        <span className="svc-port">:{svc.port}</span>
      </div>
      <div className="svc-cmd" title={svc.cmd}>
        {svc.cmd}
      </div>
      <div className="svc-meta">
        <div className="svc-meta-left" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          {meta && (
            <TagChip
              text={t('svc.type.' + type)}
              cls={type === 'brew' ? 'brew' : 'purple'}
              icon={meta.icon}
              title={fmt(t(meta.clsKey), { C: svc.command })}
            />
          )}
          <span className="tag blue" style={{ fontFamily: "'SF Mono',Menlo,monospace;" }}>
            PID {svc.pid}
          </span>
          <span className="tag cyan" style={{ fontFamily: "'SF Mono',Menlo,monospace;" }}>
            {svc.addr}:{svc.port} {svc.proto || ''}
          </span>
          <span className="tag dim">
            <i className="fa-regular fa-clock" style={{ marginRight: 2 }} />
            {svc.uptime}
          </span>
        </div>
        <div className="row-actions" onClick={(e) => e.stopPropagation()}>
          <ActBtn icon="fa-solid fa-arrow-up-right-from-square" opts={{ title: t('svc.open'), onPress: onOpen }} />
          <ActBtn icon="fa-solid fa-copy" opts={{ title: t('common.copy'), onPress: onCopy }} />
          <ActBtn icon="fa-solid fa-stop" opts={{ cls: 'red', title: t('common.kill'), onPress: onKill }} />
        </div>
      </div>
    </div>
  )
}
