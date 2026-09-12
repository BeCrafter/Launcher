// ported-from: docs/demo/index.html #editAgentFloat + drawer.js(头部/ops/switchDrawerTab) @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// Agent 编辑抽屉(demo #editAgentFloat/#editDrawer:头部状态 chip + ops bar 5 态 + 4 tab + 遮罩关闭)
import { useT } from '../../hooks/useT'
import { Modal } from '../../components/Modal'
import { Toggle } from '../../components/ui/Toggle'
import { deriveOpsBar } from '../../lib/ops-bar'
import { useDrawerStore, type DrawerTab } from '../../state/drawer-store'
import { EditTab } from './tabs/EditTab'
import { StatusTab } from './tabs/StatusTab'
import { LogTab } from './tabs/LogTab'
import { XmlTab } from './tabs/XmlTab'

const TABS: { id: DrawerTab; icon: string; labelKey: string }[] = [
  { id: 'edit', icon: 'fa-solid fa-pen-to-square', labelKey: 'drawer.tab.edit' },
  { id: 'status', icon: 'fa-solid fa-chart-bar', labelKey: 'drawer.tab.status' },
  { id: 'log', icon: 'fa-solid fa-scroll', labelKey: 'drawer.tab.log' },
  { id: 'xml', icon: 'fa-solid fa-code', labelKey: 'drawer.tab.xml' }
]

// demo openEditFloat 的 scope 文案映射
const SCOPE_LABEL: Record<string, string> = {
  user: '用户级 · ~/Library/LaunchAgents',
  system: '全局 · /Library/LaunchAgents',
  daemon: '系统 · /Library/LaunchDaemons'
}

export function AgentDrawer(): React.JSX.Element {
  const t = useT()
  const open = useDrawerStore((s) => s.open)
  const close = useDrawerStore((s) => s.close)
  const agentLabel = useDrawerStore((s) => s.agentLabel)
  const scope = useDrawerStore((s) => s.scope)
  const isDraft = useDrawerStore((s) => s.isDraft)
  const ops = useDrawerStore((s) => s.ops)
  const opsAction = useDrawerStore((s) => s.opsAction)
  const tab = useDrawerStore((s) => s.tab)
  const setTab = useDrawerStore((s) => s.setTab)

  const bar = deriveOpsBar({ ...ops, isDraft })

  return (
    <Modal id="editAgentFloat" kind="drawer" open={open} onClose={close}>
      <div className="edit-drawer" id="editDrawer">
        {/* 抽屉顶栏 */}
        <div className="drawer-hdr">
          <div className="drawer-title-area">
            <div className="drawer-title-icon">
              <i className="fa-solid fa-pen-to-square" />
            </div>
            <div className="drawer-title-text">
              <div className="drawer-title-main" id="efLabel">{agentLabel}</div>
              <div className="drawer-title-sub" id="efScope">{SCOPE_LABEL[scope] ?? scope}</div>
              {/* 未来时句:说清"接下来会发生什么"(联动表达);放在标题区,右侧只留控件 */}
              {bar.futureHintKey && <div className="ops-future-hint" id="opsFutureHint">{t(bar.futureHintKey)}</div>}
            </div>
          </div>
          <div className="drawer-hdr-right">
            <div className="hdr-state-chip" id="opsStateChip" style={{ color: bar.chip.color }}>
              <span className={`hdr-state-dot ${bar.chip.dot}`} id="opsStateDot" />
              <span id="opsStateLabel">{t(bar.chip.labelKey)}</span>
            </div>
            <div className="hdr-ops-group">
              <button
                className={bar.primary.cls}
                id="opsBtnPrimary"
                type="button"
                disabled={bar.primary.disabled}
                onClick={() => void opsAction(bar.primary.action)}
              >
                <i className={bar.primary.icon} />
                <span id="opsBtnPrimaryLabel">{t(bar.primary.labelKey)}</span>
              </button>
              <button
                className={bar.restart.cls}
                id="opsBtnRestart"
                type="button"
                disabled={bar.restart.disabled}
                onClick={() => void opsAction('restart')}
              >
                <i className={bar.restart.icon} />
                <span>{t(bar.restart.labelKey)}</span>
              </button>
              <div className="hdr-ops-divider" />
              {/* 开机自启:只管下次登录,不动当前运行状态 */}
              <span className="hdr-ops-switch">
                <span className="hdr-ops-switch-label">{t(bar.autostart.labelKey)}</span>
                <Toggle
                  checked={bar.autostart.on}
                  onChange={() => {
                    if (!bar.autostart.disabled) void opsAction('autostart')
                  }}
                />
              </span>
            </div>
            <button className="modal-close" type="button" onClick={close} title={t('common.close')}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        </div>

        {/* Tab 导航 */}
        <div className="drawer-nav">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              className={`drawer-nav-btn${tab === tb.id ? ' active' : ''}`}
              data-tab={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
            >
              <i className={tb.icon} />
              <span>{t(tb.labelKey)}</span>
            </button>
          ))}
        </div>

        {/* 抽屉内容区 */}
        <div className="drawer-body">
          {tab === 'edit' && <EditTab />}
          {tab === 'status' && <StatusTab />}
          {tab === 'log' && <LogTab />}
          {tab === 'xml' && <XmlTab />}
        </div>
      </div>
    </Modal>
  )
}

