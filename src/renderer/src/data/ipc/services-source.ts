// ServiceRepository 的 IPC 实现(阶段 3:lsof 发现 / 终止 / docker 容器,逻辑全在 main)
import type { ServiceRepository } from '../ports'

export function createIpcServicesRepo(): ServiceRepository {
  return {
    list: () => window.launcher.services.list(),
    kill: (id, opts) => window.launcher.services.kill(id, opts),
    restart: (id) => window.launcher.services.restart(id),
    containerAction: (id, action) => window.launcher.services.containerAction(id, action),
    setPolling: (enabled) => window.launcher.services.setPolling(enabled),
    setActive: (active) => window.launcher.services.setActive(active)
  }
}
