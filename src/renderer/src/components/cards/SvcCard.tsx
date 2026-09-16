// ported-from: docs/demo/js/components.js svcCard + services.js svcCardHtml @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 端口服务卡片(demo services.js svcCardHtml + components.js svcCard;meta chips 内联样式逐字)
// 应用新增:双击名称就地改名、「配置」浮层(alias/host/path 覆写)、地址标签改为可连接 host:port
import { useRef, useState } from 'react'
import { StatusDot } from '../ui/StatusDot'
import { TagChip } from '../ui/TagChip'
import { ActBtn } from '../ui/ActBtn'
import { effectiveType, SVC_GROUP_META } from '../../lib/classify'
import { displayName, resolveHost, serviceIdentityKey, serviceUrl } from '../../lib/svc-override'
import { fmt } from '../../i18n'
import type { PortService } from '@shared/models'
import type { ServiceOverride } from '@shared/settings'

export function SvcCard({
  svc,
  brewManaged,
  overrides,
  t,
  onOpen,
  onCopy,
  onKill,
  onRestart,
  onContainerAction,
  onRename,
  onConfigure
}: {
  svc: PortService
  brewManaged: ReadonlySet<string>
  overrides: Record<string, ServiceOverride>
  t: (k: string) => string
  onOpen: () => void
  onCopy: () => void
  onKill: () => void
  onRestart: () => void
  onContainerAction?: (action: 'start' | 'stop' | 'restart') => void
  onRename: (alias: string) => void
  onConfigure: (anchor: { x: number; y: number }) => void
}): React.JSX.Element {
  const type = effectiveType(svc, brewManaged)
  const meta = SVC_GROUP_META[type]
  const isContainer = svc.containerId !== undefined
  const o = overrides[serviceIdentityKey(svc)]
  const label = displayName(svc, o)
  const host = resolveHost(svc, o)
  const url = serviceUrl(svc, o)
  const noPort = svc.port <= 0 // 无端口映射的容器:打开/复制无意义

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // Esc 取消后仍会触发 blur:用 ref 把「这次不提交」显式传递过去(React 19 卸载不派发合成 blur)
  const cancelRef = useRef(false)

  const commit = (): void => {
    if (cancelRef.current) {
      cancelRef.current = false
      return
    }
    if (!editing) return
    setEditing(false)
    onRename(draft.trim())
  }

  return (
    <div className="svc-col-card" id={`svc_${svc.id}`}>
      <div className="svc-r1">
        <StatusDot status={svc.status === 'running' ? 'running' : 'stopped'} />
        {editing ? (
          <input
            className="svc-name-edit"
            autoFocus
            value={draft}
            placeholder={svc.name}
            title={t('svc.renameHint')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelRef.current = true
                setEditing(false)
              }
            }}
            onBlur={commit}
          />
        ) : (
          <span
            className="svc-name"
            title={o?.alias ? fmt(t('svc.aliasedFrom'), { N: svc.name }) : t('svc.renameHint')}
            onDoubleClick={() => {
              setDraft(o?.alias ?? '')
              setEditing(true)
            }}
          >
            {label}
          </span>
        )}
        {svc.port > 0 && <span className="svc-port">:{svc.port}</span>}
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
              title={fmt(t('svc.cls.' + (svc.kind ?? type)), { C: svc.evidence ?? svc.command })}
            />
          )}
          {svc.pid ? (
            <span className="tag blue" style={{ fontFamily: "'SF Mono',Menlo,monospace;" }}>
              PID {svc.pid}
            </span>
          ) : null}
          {/* 可连接地址(绑定地址 `*` 不可连接);悬停可见打开/复制实际使用的完整 URL */}
          <span
            className="tag cyan"
            style={{ fontFamily: "'SF Mono',Menlo,monospace;" }}
            title={url}
          >
            {host}:{svc.port}
          </span>
          <span className="tag dim">
            <i className="fa-regular fa-clock" style={{ marginRight: 2 }} />
            {svc.uptime}
          </span>
        </div>
        <div className="row-actions" onClick={(e) => e.stopPropagation()}>
          <ActBtn
            icon="fa-solid fa-sliders"
            opts={{
              title: t('svc.configure'),
              onPress: (e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                onConfigure({ x: r.right, y: r.bottom })
              }
            }}
          />
          <ActBtn
            icon="fa-solid fa-arrow-up-right-from-square"
            opts={{ title: t('svc.open'), onPress: onOpen, disabled: noPort }}
          />
          <ActBtn
            icon="fa-solid fa-copy"
            opts={{ title: t('common.copy'), onPress: onCopy, disabled: noPort }}
          />
          {isContainer ? (
            svc.status === 'running' ? (
              <>
                <ActBtn icon="fa-solid fa-stop" opts={{ cls: 'red', title: t('svc.stop'), onPress: () => onContainerAction?.('stop') }} />
                <ActBtn icon="fa-solid fa-rotate-right" opts={{ cls: 'accent', title: t('svc.containerRestart'), onPress: () => onContainerAction?.('restart') }} />
              </>
            ) : (
              <ActBtn icon="fa-solid fa-play" opts={{ cls: 'green', title: t('svc.start'), onPress: () => onContainerAction?.('start') }} />
            )
          ) : (
            <>
              <ActBtn icon="fa-solid fa-rotate-right" opts={{ cls: 'accent', title: t('svc.restart'), onPress: onRestart }} />
              <ActBtn icon="fa-solid fa-stop" opts={{ cls: 'red', title: t('common.kill'), onPress: onKill }} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
