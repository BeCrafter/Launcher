// 视图宿主:module → 视图组件(条件渲染)
import { AgentsView } from '../modules/agents/AgentsView'
import { CronView } from '../modules/cron/CronView'
import { ServicesView } from '../modules/services/ServicesView'
import { SettingsView } from '../modules/settings/SettingsView'
import { AiView } from '../modules/ai/AiView'
import type { ModuleId } from '../state/ui-store'

export function ViewHost({ module }: { module: ModuleId }): React.JSX.Element {
  switch (module) {
    case 'agents':
      return <AgentsView />
    case 'crontab':
      return <CronView />
    case 'services':
      return <ServicesView />
    case 'ai':
      return <AiView />
    case 'settings':
      return <SettingsView />
  }
}
