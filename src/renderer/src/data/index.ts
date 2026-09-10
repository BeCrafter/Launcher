// 数据源工厂:整个应用唯一的数据入口
// 当前 = mock;阶段 1-3 起按 refactor-plan 替换为 ipcDataSource()(接口不变,组件/store 零改动)

import type { DataSource } from './ports'
import { createMockDataSource } from './mock/mock-source'

let instance: DataSource | null = null

export function dataSource(): DataSource {
  if (!instance) instance = createMockDataSource()
  return instance
}
