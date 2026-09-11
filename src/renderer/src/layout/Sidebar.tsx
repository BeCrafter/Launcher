// ported-from: docs/demo/index.html L22-62 @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 侧边栏(demo index.html L22-62 骨架;4 入口 → 本轮 3 入口,AI 未迁移)
// Logo 用 v2 双主题 Logo 组件(等效 demo logo-dark/light img 对,32px 同款;差异记对照表)
import Logo from '../components/Logo'
import { useT } from '../hooks/useT'
import { MODULES, SIDEBAR_MODULES } from '../lib/modules'
import { useUiStore } from '../state/ui-store'
import { useSettingsStore } from '../state/settings-store'
import { toggleSidebarCollapse } from '../hooks/useSidebarLayout'
import { HELP_URL } from '../data/mock/mock-data'
import { openExternal, showToast } from '../lib/utils'

// demo 侧边栏图标(nav markup 硬编码完整 class;crontab 为 fa-regular)
const NAV_ICONS: Record<string, string> = {
  agents: 'fa-solid fa-rocket',
  crontab: 'fa-regular fa-clock',
  services: 'fa-solid fa-network-wired'
}

export function Sidebar(): React.JSX.Element {
  const t = useT()
  const module = useUiStore((s) => s.module)
  const switchModule = useUiStore((s) => s.switchModule)
  const collapsed = useSettingsStore((s) => s.settings?.sidebarCollapsed ?? false)

  const onToggle = (): void => {
    toggleSidebarCollapse(undefined, (collapsed) => {
      useSettingsStore.getState().set({ sidebarCollapsed: collapsed })
      showToast(
        collapsed ? '侧边栏已折叠' : '侧边栏已展开',
        '#a78bfa',
        collapsed ? 'fa-angles-right' : 'fa-angles-left'
      )
    })
  }

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} id="sidebar">
      <div className="sidebar-header" onClick={onToggle} title={t('nav.toggleSidebar')}>
        <div className="app-logo">
          <Logo size={32} />
          <span className="sidebar-toggle-hint" />
        </div>
        <div>
          <div className="app-name">Launcher</div>
          <div className="app-ver">{t('app.tagline')}</div>
        </div>
      </div>
      <div className="sidebar-nav">
        <div className="nav-section-label">{t('nav.section')}</div>
        {SIDEBAR_MODULES.map((id) => {
          const active = module === id
          const label = id === 'agents' ? 'Launch Agents' : t(`nav.${id}`)
          return (
            <div key={id} className={`nav-item${active ? ' active' : ''}`} onClick={() => switchModule(id)}>
              <div className="nav-icon">
                <i className={NAV_ICONS[id]} />
              </div>
              <span className="nav-label">{label}</span>
            </div>
          )
        })}
      </div>
      <div className="sidebar-footer">
        <button
          className="sidebar-footer-btn"
          onClick={() => openExternal(HELP_URL)}
          title="打开在线帮助文档"
        >
          <i className="fa-regular fa-circle-question" />
          <span>{t('nav.help')}</span>
        </button>
        <button
          className="sidebar-footer-btn"
          onClick={() => switchModule('settings')}
          title={t('nav.settings')}
        >
          <i className="fa-solid fa-gear" />
          <span>{t('nav.settings')}</span>
        </button>
      </div>
    </aside>
  )
}
