// 顶栏(demo index.html L67-84):菜单钮 + 面包屑 + 搜索 + 模块操作区
// 面包屑/搜索占位来自 MODULES 记录;操作区组件按模块切换(demo actions() 模板等价)
import { useT } from '../hooks/useT'
import { MODULES } from '../lib/modules'
import { useUiStore } from '../state/ui-store'
import { useSettingsStore } from '../state/settings-store'
import { useAgentsStore } from '../state/agents-store'
import { useDrawerStore } from '../state/drawer-store'
import { showToast } from '../lib/utils'

export function Topbar(): React.JSX.Element {
  const t = useT()
  const module = useUiStore((s) => s.module)
  const searchQuery = useUiStore((s) => s.searchQuery)
  const setSearch = useUiStore((s) => s.setSearch)
  const rec = MODULES[module]
  const label = rec.breadcrumb ?? (rec.breadcrumbKey ? t(rec.breadcrumbKey) : module)
  const placeholder = rec.searchPlaceholderKey ? t(rec.searchPlaceholderKey) : t('topbar.search')
  const resetSettings = useSettingsStore((s) => s.reset)

  return (
    <div className="topbar">
      <button className="topbar-btn" style={{ display: 'none' }} id="menuToggle" type="button">
        <i className="fa-solid fa-bars" />
      </button>
      <div className="topbar-breadcrumb" id="topBreadcrumb">
        <i className={`fa-solid ${rec.icon}`} style={{ color: 'var(--accent2)', fontSize: 12 }} />
        <span>{label}</span>
      </div>
      <div className="topbar-spacer" />
      <div className="topbar-actions">
        <SearchBox placeholder={placeholder} value={searchQuery} onChange={setSearch} />
        {module === 'agents' && <AgentsActions />}
        {module === 'crontab' && <CrontabActions />}
        {module === 'services' && <ServicesActions />}
        {module === 'settings' && (
          <>
            <button
              className="topbar-btn"
              type="button"
              onClick={() => showToast(t('toast.autosaveNote'), '#4ade80', 'fa-circle-check')}
            >
              <i className="fa-solid fa-circle-check" />
              <span>{t('topbar.autosave')}</span>
            </button>
            <button className="topbar-btn" type="button" onClick={() => void resetSettings()}>
              <i className="fa-solid fa-rotate-left" />
              <span>{t('topbar.restoreDefault')}</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export function SearchBox({
  placeholder,
  value,
  onChange
}: {
  placeholder: string
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <div className="search-wrap">
      <i className="fa-solid fa-magnifying-glass" />
      <input
        type="text"
        placeholder={placeholder}
        id="globalSearch"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

// ── 模块操作区(demo config.js actions() 模板对应;交互随各视图阶段接线) ──

function AgentsActions(): React.JSX.Element {
  const t = useT()
  // demo newAgentWithScope:label 前缀 + taskname 去重 → 草稿入抽屉
  const newWithScope = async (scope: 'user' | 'system' | 'daemon'): Promise<void> => {
    const prefix = useSettingsStore.getState().settings?.labelPrefix ?? 'com.user.'
    let label = prefix + 'taskname'
    let idx = 1
    const agents = useAgentsStore.getState().agents
    while (agents.some((a) => a.id === label)) label = prefix + 'taskname.' + idx++
    const draft = await useAgentsStore.getState().createDraft(scope, label)
    await useDrawerStore.getState().openDraft(draft)
  }
  return (
    <>
      <button
        className="topbar-btn"
        type="button"
        onClick={() => useUiStore.getState().openOverlay('importModal')}
      >
        <i className="fa-solid fa-file-import" />
        <span>{t('topbar.importConfig')}</span>
      </button>
      <div className="new-agent-group">
        <button className="topbar-btn accent" type="button">
          <i className="fa-solid fa-plus" />
          <span>{t('topbar.newTask')}</span>
        </button>
        <div className="new-agent-menu" id="newAgentMenu">
          <button className="new-agent-menu-item" type="button" onClick={() => void newWithScope('user')}>
            <i className="fa-solid fa-user" />
            {t('modal.newAgent.scopeUser')}
          </button>
          <button className="new-agent-menu-item" type="button" onClick={() => void newWithScope('system')}>
            <i className="fa-solid fa-building" />
            {t('modal.newAgent.scopeSystem')}
          </button>
          <button className="new-agent-menu-item" type="button" onClick={() => void newWithScope('daemon')}>
            <i className="fa-solid fa-server" />
            {t('modal.newAgent.scopeDaemon')}
          </button>
        </div>
      </div>
    </>
  )
}

function CrontabActions(): React.JSX.Element {
  const t = useT()
  return (
    <>
      <button
        className="topbar-btn"
        type="button"
        onClick={() => showToast(t('toast.crontabReloaded'), '#4ade80', 'fa-arrows-rotate')}
      >
        <i className="fa-solid fa-arrows-rotate" />
        <span>{t('topbar.refresh')}</span>
      </button>
      <button className="topbar-btn accent" type="button">
        <i className="fa-solid fa-plus" />
        <span>{t('topbar.newCron')}</span>
      </button>
    </>
  )
}

function ServicesActions(): React.JSX.Element {
  const t = useT()
  return (
    <>
      <button
        className="topbar-btn"
        type="button"
        onClick={() => showToast(t('toast.scanRefreshed'), '#4ade80', 'fa-arrows-rotate')}
      >
        <i className="fa-solid fa-arrows-rotate" />
        <span>{t('topbar.rescan')}</span>
      </button>
      <button
        className="topbar-btn accent"
        type="button"
        onClick={() => showToast(t('toast.autoPollingOn'), '#22d3ee', 'fa-bolt')}
      >
        <i className="fa-solid fa-bolt" />
        <span>{t('topbar.watchState')}</span>
      </button>
    </>
  )
}
