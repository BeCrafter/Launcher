// 视图宿主(demo switchModule 的视图显隐等价物):module → 视图组件
// demo 中每个 #view-* 常驻 DOM、display 切换;React 以条件渲染等价(记录对照表)
import { AgentsView } from '../modules/agents/AgentsView'
import { CronView } from '../modules/cron/CronView'
import { ServicesView } from '../modules/services/ServicesView'
import { SettingsView } from '../modules/settings/SettingsView'
import type { ModuleId } from '../state/ui-store'

export function ViewHost({ module }: { module: ModuleId }): React.JSX.Element {
  switch (module) {
    case 'agents':
      return <AgentsView />
    case 'crontab':
      return <CronView />
    case 'services':
      return <ServicesView />
    case 'settings':
      return <SettingsView />
  }
}
