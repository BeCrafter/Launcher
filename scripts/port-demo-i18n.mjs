#!/usr/bin/env node
// 从冻结的 demo 原型生成 renderer i18n 字典(逐键字节一致):
//   node scripts/port-demo-i18n.mjs
// 产出:src/renderer/src/i18n/dict.zh-CN.ts / dict.en-US.ts(全量 555 键,含未迁移域)
// 只读 demo;demo 变更后重跑本脚本即可再生成。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEMO_I18N = join(ROOT, 'docs/demo/js/i18n.js')
const OUT_DIR = join(ROOT, 'src/renderer/src/i18n')

// 同 check.mjs 手法:vm 沙箱打桩 localStorage,取顶层 I18N
const ctx = {}
vm.createContext(ctx)
vm.runInContext(
  'const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };',
  ctx
)
vm.runInContext(readFileSync(DEMO_I18N, 'utf8') + '\nthis.I18N = I18N;', ctx)
const I18N = ctx.I18N

// 应用新增文案(demo 冻结后新增,demo 源不可改;合并写出,中英键一致性仍由 i18n.test.ts 保证)
const EXTRA = {
  'zh-CN': {
    'toast.update.upToDate': '当前已是最新版本 ({V})',
    'toast.update.available': '发现新版本 {V},请前往 GitHub 下载',
    'toast.update.noRelease': '仓库尚未发布任何版本',
    'toast.update.error': '检查更新失败,请检查网络后重试',
    // ── 定时任务(阶段 2) ──
    'cron.next.label': '下次执行',
    'cron.next.today': '今天 {T}',
    'cron.next.tomorrow': '明天 {T}',
    'cron.next.date': '{D} {T}',
    'cron.next.none': '无下次执行(表达式无匹配)',
    'cron.next.reboot': '开机时执行',
    'cron.header.title': '文件头(注释与环境变量)',
    'cron.header.edit': '编辑文件头',
    'cron.header.hasContent': '已解析头部内容',
    'cron.header.empty': '暂无头部内容',
    'cron.header.hint': '仅替换首个任务之前的区块;任务行原样保留',
    'cron.header.scopeUser': '用户级 crontab',
    'cron.header.scopeSystem': '系统级 /etc/crontab',
    'cron.header.notExists': '文件尚不存在;macOS 系统保护禁止新建,系统级任务在文件存在前不可用',
    'cron.log.retainHintDyn': '日志保留 {D} 天,超出自动清理',
    'cron.log.empty': '暂无日志(任务尚未执行,或日志已超保留期被清理)',
    'elev.cron.cmdEdit': '写回 /etc/crontab(编辑任务)',
    'elev.cron.cmdDelete': '写回 /etc/crontab(删除任务)',
    'elev.cron.cmdCreate': '写入 /etc/crontab(新建任务)',
    'elev.cron.cmdHeader': '写回 /etc/crontab(文件头)',
    'cron.parse.special.hourly': '每小时执行',
    'cron.parse.special.daily': '每天 0:00 执行',
    'cron.parse.special.weekly': '每周日 0:00 执行',
    'cron.parse.special.monthly': '每月 1 日 0:00 执行',
    'cron.parse.special.yearly': '每年 1 月 1 日 0:00 执行',
    'cron.parse.special.reboot': '开机时执行',
    'log.source.file': '日志文件',
    'log.source.system': '系统日志',
    'log.refresh': '刷新',
    'toast.xmlInvalid': 'plist 校验未通过',
    'xml.saveHint': '写入 plist 文件',
    'dialog.pickExecutable': '选择可执行文件',
    'dialog.pickPlist': '选择 plist 文件',
    'dialog.exportLog': '导出日志',
    'toast.logExportedTo': '日志已导出到 {P}',
    'toast.logFileMissing': '日志文件不存在(任务可能尚未产生输出)',
    'agents.missing.title': '已加载但 plist 已不存在',
    'agents.missing.hint': '该服务仍被 launchd 加载(管理目录中已无对应 plist 文件);可手工 bootout 或重建该 plist',
    'agent.override': '已禁用',
    'agent.override.title': 'launchctl 覆盖状态为 disabled(可用抽屉「启用」按钮恢复)',
    'toast.cronHeaderSaved': '文件头已保存',
    'toast.cronStale': '任务已被外部改动,已按最新内容更新',
    'toast.elevCancelled': '已取消管理员授权',
    'toast.elevFailed': '管理员授权失败或操作未完成',
    'toast.cronOpFailed': '操作失败,请重试',
    // ── 端口服务(阶段 3) ──
    'svc.restart': '重启服务(终止后按原命令行启动)',
    'svc.start': '启动容器',
    'svc.stop': '停止容器',
    'svc.containerRestart': '重启容器',
    'svc.type.docker': 'Docker',
    'svc.cls.python': 'lsof COMMAND={C} → Python(常规 Resolver)',
    'svc.cls.php': 'lsof COMMAND={C} → PHP(常规 Resolver)',
    'svc.cls.jvm': 'lsof COMMAND={C} → JVM(常规 Resolver)',
    'svc.cls.ruby': 'lsof COMMAND={C} → Ruby(常规 Resolver)',
    'svc.cls.docker': 'lsof COMMAND={C} → Docker 端口代理(常规 Resolver)',
    'svc.cls.dev': '命令行含开发服务器特征({C})→ Dev Server',
    'toast.svcRestarted': '已重启 {N}(新 PID {P})',
    'toast.svcRestartFailed': '{N} 已终止,但重新启动失败:请检查命令与工作目录',
    'toast.svcKilled': '已终止 {N}',
    'toast.svcKillDenied': '无权限终止该进程,可尝试管理员授权',
    'toast.pollingOff': '已暂停端口监听扫描',
    'toast.containerActionFailed': '容器操作失败,请查看 Docker 状态',
    'svc.dockerUnavailable': 'Docker 未运行',
    'cron.systemUnavailable': '系统级不可用:/etc/crontab 不存在(macOS 系统保护禁止新建)'
  },
  'en-US': {
    'toast.update.upToDate': 'Already up to date ({V})',
    'toast.update.available': 'New version {V} available on GitHub',
    'toast.update.noRelease': 'No releases published yet',
    'toast.update.error': 'Update check failed, check your network and retry',
    // ── Scheduled tasks (phase 2) ──
    'cron.next.label': 'Next run',
    'cron.next.today': 'today {T}',
    'cron.next.tomorrow': 'tomorrow {T}',
    'cron.next.date': '{D} {T}',
    'cron.next.none': 'Never (expression matches nothing)',
    'cron.next.reboot': 'at boot',
    'cron.header.title': 'File header (comments & env)',
    'cron.header.edit': 'Edit header',
    'cron.header.hasContent': 'header parsed',
    'cron.header.empty': 'no header content',
    'cron.header.hint': 'Only the block before the first job is replaced; job lines are preserved',
    'cron.header.scopeUser': 'User crontab',
    'cron.header.scopeSystem': 'System /etc/crontab',
    'cron.header.notExists': 'File does not exist; macOS protections forbid creating it until it exists',
    'cron.log.retainHintDyn': 'Logs kept for {D} days, then auto-cleaned',
    'cron.log.empty': 'No logs yet (job has not run, or logs aged out)',
    'elev.cron.cmdEdit': 'Write /etc/crontab (edit job)',
    'elev.cron.cmdDelete': 'Write /etc/crontab (delete job)',
    'elev.cron.cmdCreate': 'Write /etc/crontab (create job)',
    'elev.cron.cmdHeader': 'Write /etc/crontab (file header)',
    'cron.parse.special.hourly': 'Runs hourly',
    'cron.parse.special.daily': 'Runs daily at 00:00',
    'cron.parse.special.weekly': 'Runs weekly on Sunday 00:00',
    'cron.parse.special.monthly': 'Runs monthly on day 1 at 00:00',
    'cron.parse.special.yearly': 'Runs yearly on Jan 1 at 00:00',
    'cron.parse.special.reboot': 'Runs at boot',
    'log.source.file': 'Log file',
    'log.source.system': 'System log',
    'log.refresh': 'Refresh',
    'toast.xmlInvalid': 'plist validation failed',
    'xml.saveHint': 'Write plist file',
    'dialog.pickExecutable': 'Choose executable',
    'dialog.pickPlist': 'Choose plist file',
    'dialog.exportLog': 'Export log',
    'toast.logExportedTo': 'Log exported to {P}',
    'toast.logFileMissing': 'Log file does not exist yet (no output so far)',
    'agents.missing.title': 'Loaded but plist is missing',
    'agents.missing.hint': 'Still loaded by launchd while its plist no longer exists; boot it out manually or recreate the plist',
    'agent.override': 'Disabled',
    'agent.override.title': 'Disabled by launchctl override (use the Enable action in the drawer)',
    'toast.cronHeaderSaved': 'File header saved',
    'toast.cronStale': 'Job was changed externally; refreshed to the latest content',
    'toast.elevCancelled': 'Administrator authorization cancelled',
    'toast.elevFailed': 'Administrator authorization failed or the operation did not complete',
    'toast.cronOpFailed': 'Operation failed, please retry',
    // ── Port services (phase 3) ──
    'svc.restart': 'Restart service (terminate, then run original command)',
    'svc.start': 'Start container',
    'svc.stop': 'Stop container',
    'svc.containerRestart': 'Restart container',
    'svc.type.docker': 'Docker',
    'svc.cls.python': 'lsof COMMAND={C} → Python (generic Resolver)',
    'svc.cls.php': 'lsof COMMAND={C} → PHP (generic Resolver)',
    'svc.cls.jvm': 'lsof COMMAND={C} → JVM (generic Resolver)',
    'svc.cls.ruby': 'lsof COMMAND={C} → Ruby (generic Resolver)',
    'svc.cls.docker': 'lsof COMMAND={C} → Docker port proxy (generic Resolver)',
    'svc.cls.dev': 'Command matches dev-server pattern ({C}) → Dev Server',
    'toast.svcRestarted': 'Restarted {N} (new PID {P})',
    'toast.svcRestartFailed': '{N} was terminated but failed to restart: check the command and working directory',
    'toast.svcKilled': 'Terminated {N}',
    'toast.svcKillDenied': 'Not permitted to terminate this process; try administrator authorization',
    'toast.pollingOff': 'Port listening scan paused',
    'toast.containerActionFailed': 'Container action failed, check Docker status',
    'svc.dockerUnavailable': 'Docker is not running',
    'cron.systemUnavailable': 'System scope unavailable: /etc/crontab missing (macOS protection blocks creating it)'
  }
}

for (const [lang, dict] of Object.entries(I18N)) {
  const merged = { ...dict, ...EXTRA[lang] }
  const keys = Object.keys(merged)
  const file = lang === 'zh-CN' ? 'dict.zh-CN.ts' : 'dict.en-US.ts'
  const varName = lang === 'zh-CN' ? 'zhCN' : 'enUS'
  const lines = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(merged[k])}`)
  const body = `// GENERATED by scripts/port-demo-i18n.mjs — 勿手改;源:docs/demo/js/i18n.js @ 06ff9ba
// 全量键(含暂未迁移域 ai.* / login.* / plist.* / design.* + 应用内联 EXTRA 键),中英键集合一致性由 i18n.test.ts 保证

export const ${varName}: Record<string, string> = {
${lines.join(',\n')}
}
`
  writeFileSync(join(OUT_DIR, file), body, 'utf8')
  console.log(`✓ ${file}(${keys.length} 键)`)
}
