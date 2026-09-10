// ported-from: docs/demo/index.html .app-shell + statusbar.js @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 应用外壳(demo .app-shell 布局):侧边栏 + 主内容(顶栏/视图/状态栏)+ Toast
// 状态栏显隐由 MODULES[module].showStatusBar 驱动;模型按模块从数据 store 派生
import { useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { ViewHost } from './ViewHost'
import { StatusBar } from '../components/StatusBar'
import { Toast } from '../components/ui/Toast'
import { MODULES, type StatusBarModel } from '../lib/modules'
import { useUiStore } from '../state/ui-store'
import { useSettingsStore } from '../state/settings-store'
import { useSidebarLayout, toggleSidebarCollapse } from '../hooks/useSidebarLayout'
import { useT, useFmt } from '../hooks/useT'
import { agentsStatusBar, crontabStatusBar, servicesStatusBar } from '../lib/statusbars'
import { themeLabelKey, languageLabel } from '../lib/labels'
import { archLabel } from '../lib/arch'
import { showToast } from '../lib/utils'
import { useAgentsStore } from '../state/agents-store'
import { useCronStore } from '../state/cron-store'
import { useServicesStore } from '../state/services-store'
import { MOCK_DATA } from '../data/mock/mock-data'
import type { AppInfo } from '@shared/ipc'

export function AppShell(): React.JSX.Element {
  const t = useT()
  const fmt = useFmt()
  const module = useUiStore((s) => s.module)
  const sidebarCollapsed = useSettingsStore((s) => s.settings?.sidebarCollapsed ?? false)
  const agents = useAgentsStore((s) => s.agents)
  const crons = useCronStore((s) => s.crons)
  const services = useServicesStore((s) => s.services)
  const theme = useSettingsStore((s) => s.settings?.theme ?? 'system')
  const language = useSettingsStore((s) => s.settings?.language ?? 'zh-CN')
  const [arch, setArch] = useState('')
  useSidebarLayout(sidebarCollapsed)

  useEffect(() => {
    void window.launcher
      .getAppInfo()
      .then((i: AppInfo) => setArch(archLabel(i.arch)))
      .catch(() => setArch(''))
  }, [])

  // 设置页默认折叠侧边栏(demo switchModule('settings') 行为,toast 文案同款)
  useEffect(() => {
    if (module === 'settings') {
      toggleSidebarCollapse(true, (collapsed) => {
        useSettingsStore.getState().set({ sidebarCollapsed: collapsed })
        showToast(
          collapsed ? '侧边栏已折叠' : '侧边栏已展开',
          '#a78bfa',
          collapsed ? 'fa-angles-right' : 'fa-angles-left'
        )
      })
    }
  }, [module])

  const rec = MODULES[module]
  let model: StatusBarModel | null = null
  if (module === 'agents') model = agentsStatusBar({ agents }, t, fmt)
  else if (module === 'crontab') model = crontabStatusBar({ crons }, t, fmt)
  else if (module === 'services') model = servicesStatusBar({ services }, t, fmt)
  else if (module === 'settings')
    model = {
      summaryIcon: 'fa-sliders',
      summaryHtml: `Launcher <strong>${MOCK_DATA.meta.versionFull.replace('Launcher ', '')}</strong>`,
      items: [
        { dot: 'running', textHtml: `${t('statusbar.theme')} <strong>${t(themeLabelKey(theme))}</strong>` },
        { dot: 'loaded', textHtml: `${t('statusbar.language')} <strong>${languageLabel(language, t)}</strong>` },
        { dot: 'unloaded', textHtml: `${t('statusbar.arch')} <strong>${arch}</strong>` }
      ],
      pathIcon: 'fa-brands fa-github',
      path: MOCK_DATA.urls.github.replace(/^https?:\/\//, ''),
      pathHref: MOCK_DATA.urls.github,
      monitor: t('statusbar.prefsAutoSave')
    }

  return (
    <div className="window-root">
      {/* 标题栏接管色带:与侧边栏同色(--surface),兼作拖动区(styles/app-chrome.css) */}
      <div className="titlebar-drag" />
      <div className="app-shell">
        <Sidebar />
        <div className="main-content">
          <Topbar />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            <ViewHost module={module} />
          </div>
          {rec.showStatusBar && model ? (
            <StatusBar model={model} />
          ) : (
            <div className="launch-statusbar hidden" id="launchStatusBar" />
          )}
        </div>
        <Toast />
      </div>
    </div>
  )
}
