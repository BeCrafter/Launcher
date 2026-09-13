// cron 日志路径契约:main 侧写入/读取的唯一来源(main 用 os.homedir() 拼接)
// renderer 不自行拼路径——经 job.logPath 消费(路径是后端契约的一部分)
// 注意:不得引入 node:* 依赖(shared 同时被 renderer 打包)
//
// 两种形态并存:
//   新: <id>-YYYYMMDDHH.log —— 重定向目标写成日期模板 `$(date +%Y%m%d%H)` 由 shell 展开,
//       每小时一段 → 每段在周期结束后停止写入 → mtime 变旧 → 既有的「按 mtime 整文件清理」真正生效
//       (否则活跃任务的单文件 mtime 永远新鲜,永远不会被清理)
//   旧: <id>.log —— 历史条目遗留的单文件形式;不再新写,但仍可读取/清理

export const CRON_LOG_DIR_SUFFIX = 'Library/Logs/BeCrafter-Launcher/cron'

export function cronLogDir(home: string): string {
  return `${home}/${CRON_LOG_DIR_SUFFIX}`
}

/** 写回 crontab 用的**重定向目标模板**:含裸 `%(由 renderJobLine 统一转义为 \%)` */
export function cronLogTemplate(home: string, id: string): string {
  return `${cronLogDir(home)}/${id}-$(date +%Y%m%d%H).log`
}

/** 模板尾缀(解析时识别;调用方此时已把 `\%` 还原为 `%`) */
const TEMPLATE_TAIL = '-$(date +%Y%m%d%H).log'

/** 该路径是否为「日期模板」形式(是 → 实际文件需按 id 扫目录解析) */
export function isCronLogTemplate(path: string): boolean {
  return path.endsWith(TEMPLATE_TAIL)
}

/** 历史遗留的单文件路径(仍可读/可清,但不再新写) */
export function cronLogLegacyPath(home: string, id: string): string {
  return `${cronLogDir(home)}/${id}.log`
}

/**
 * 该文件名是否属于任务 id 的日志。
 * 精确匹配 `<id>-<YYYYMMDDHH>.log`(10 位)与旧式 `<id>.log` —— 不能用 `<id>-*` 前缀匹配,
 * 因为重复任务 id 会带 `-N` 后缀(如 `abc` 与 `abc-1`),前缀匹配会互相串。
 * ⚠ 位宽必须与 cronLogTemplate 的 `%Y%m%d%H` 一致(年月日时 = 10 位,不是 8)。
 */
export function matchCronLogFile(id: string, fileName: string): boolean {
  if (fileName === `${id}.log`) return true
  const escaped = id.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
  return new RegExp(`^${escaped}-\\d{10}\\.log$`).test(fileName)
}

/** 判断路径是否位于本应用 cron 日志目录(解析日志包裹行时用于识别应用自有重定向) */
export function isLauncherCronLogPath(home: string, path: string): boolean {
  return path.startsWith(`${cronLogDir(home)}/`)
}
