// CronRepository 的 IPC 实现(阶段 2:真实 crontab 读写,逻辑全在 main)
import type { CronRepository } from '../ports'

export function createIpcCronRepo(): CronRepository {
  return {
    list: () => window.launcher.cron.list(),
    create: (job) => window.launcher.cron.create(job),
    update: (job, patch) => window.launcher.cron.update(job, patch),
    remove: (job) => window.launcher.cron.remove(job),
    readLog: (id) => window.launcher.cron.readLog(id),
    writeHeader: (scope, text) => window.launcher.cron.writeHeader(scope, text)
  }
}
