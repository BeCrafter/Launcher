// 数据源工厂:整个应用唯一的数据入口
// 阶段 1 起三域全部真实后端(IPC);mock 数据源已退场(仅 MOCK_DATA.urls 等静态链接仍保留)

import type { DataSource } from './ports'
import { createIpcAgentRepo } from './ipc/agents-source'
import { createIpcCronRepo } from './ipc/cron-source'
import { createIpcServicesRepo } from './ipc/services-source'

let instance: DataSource | null = null

export function dataSource(): DataSource {
  if (!instance) {
    instance = {
      agents: createIpcAgentRepo(),
      crons: createIpcCronRepo(),
      services: createIpcServicesRepo()
    }
  }
  return instance
}
