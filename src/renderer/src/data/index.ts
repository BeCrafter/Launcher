// 数据源工厂:整个应用唯一的数据入口
// 三域全部真实后端(IPC);静态链接(仓库地址 / 帮助)在 @shared/constants

import type { DataSource } from './ports'
import { createIpcAgentRepo } from './ipc/agents-source'
import { createIpcCronRepo } from './ipc/cron-source'
import { createIpcServicesRepo } from './ipc/services-source'
import { createIpcAiRepo } from './ipc/ai-source'

let instance: DataSource | null = null

export function dataSource(): DataSource {
  if (!instance) {
    instance = {
      agents: createIpcAgentRepo(),
      crons: createIpcCronRepo(),
      services: createIpcServicesRepo(),
      ai: createIpcAiRepo()
    }
  }
  return instance
}
