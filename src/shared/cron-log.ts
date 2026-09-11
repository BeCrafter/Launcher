// cron 日志路径契约:main 侧写入/读取的唯一来源(main 用 os.homedir() 拼接)
// renderer 不自行拼路径——经 job.logPath 消费(路径是后端契约的一部分)
// 注意:不得引入 node:* 依赖(shared 同时被 renderer 打包)

export const CRON_LOG_DIR_SUFFIX = 'Library/Logs/BeCrafter-Launcher/cron'

export function cronLogDir(home: string): string {
  return `${home}/${CRON_LOG_DIR_SUFFIX}`
}

export function cronLogPath(home: string, id: string): string {
  return `${cronLogDir(home)}/${id}.log`
}

/** 判断路径是否位于本应用 cron 日志目录(解析日志包裹行时用于识别应用自有重定向) */
export function isLauncherCronLogPath(home: string, path: string): boolean {
  return path.startsWith(`${cronLogDir(home)}/`)
}
