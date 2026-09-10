// ══════════════ 测试数据 ══════════════
// 页面用到的全部测试/演示数据集中在此（JSON 结构），页面与逻辑中不再写死。
const MOCK_DATA = {
  // 页面元信息
  meta: {
    versionFull: 'Launcher v2.0.0 (Build 20250228)',
    footerVersion: 'Launcher v2.0'
  },
  urls: {
    github: 'https://github.com/BeCrafter/Launcher',
    help: 'https://github.com/BeCrafter/Launcher/blob/main/Help.md'
  },
  agents: [{
    id: 'com.user.sync-daemon',
    label: 'com.user.sync-daemon',
    desc: '实时监听文件变更并自动同步至远端存储，支持增量传输与冲突检测。',
    status: 'running',
    pid: 2847,
    uptime: '3h 24m',
    scope: 'user',
    tags: ['sync', 'daemon'],
    program: '/usr/local/bin/sync-daemon',
    exitCode: 0,
    restarts: 2
  },
  {
    id: 'homebrew.mxcl.nginx',
    label: 'homebrew.mxcl.nginx',
    desc: 'Nginx HTTP 服务器，由 Homebrew Services 管理。',
    status: 'running',
    pid: 3201,
    uptime: '5h 12m',
    scope: 'user',
    tags: ['brew', 'server'],
    isBrew: true,
    program: '/usr/local/opt/nginx/bin/nginx',
    exitCode: 0,
    restarts: 0
  },
  {
    id: 'com.user.backup-cron',
    label: 'com.user.backup-cron',
    desc: '每日凌晨执行全量备份，自动压缩并上传至对象存储，保留最近 30 份记录。',
    status: 'running',
    pid: 3102,
    uptime: '1h 05m',
    scope: 'user',
    tags: ['backup', 'cron'],
    program: '/usr/local/bin/backup.sh',
    exitCode: 0,
    restarts: 1
  },
  {
    id: 'com.corp.log-cleaner',
    label: 'com.corp.log-cleaner',
    desc: '定期扫描并删除超过 7 天的过期日志文件，释放磁盘空间。',
    status: 'loaded',
    pid: null,
    uptime: null,
    scope: 'system',
    tags: ['log', 'cleanup'],
    program: '/usr/local/bin/log-cleaner',
    exitCode: null,
    restarts: 0
  },
  {
    id: 'com.user.notify-push',
    label: 'com.user.notify-push',
    desc: '监听系统事件并通过 APNs 发送本地推送通知，当前已停止运行。',
    status: 'stopped',
    pid: null,
    uptime: null,
    scope: 'user',
    tags: ['notify'],
    program: '/usr/local/bin/notify-push',
    exitCode: 1,
    restarts: 3
  },
  {
    id: 'com.system.net-watchdog',
    label: 'com.system.net-watchdog',
    desc: '守护网络连通性，断网时执行回调并发送告警，系统 Daemon 级别运行。',
    status: 'stopped',
    pid: null,
    uptime: null,
    scope: 'daemon',
    tags: ['network', 'daemon'],
    program: '/usr/sbin/net-watchdog',
    exitCode: 0,
    restarts: 0
  },
],
  invalidPlists: [{
  path: '~/Library/LaunchAgents/com.old.broken.plist',
  reason: 'XML 解析失败：预期 </dict> 但遇到 EOF'
}],
  crons: [{
    id: 'c1',
    user: 'user',
    expr: '0 9 * * 1-5',
    cmd: '/usr/local/bin/report.sh',
    desc: '工作日早 9 点生成报告',
    enabled: true,
    log: true
  },
  {
    id: 'c2',
    user: 'user',
    expr: '*/30 * * * *',
    cmd: '/usr/local/bin/healthcheck.sh',
    desc: '每 30 分钟健康检查',
    enabled: true,
    log: true
  },
  {
    id: 'c3',
    user: 'root',
    expr: '0 2 * * 0',
    cmd: '/usr/local/sbin/weekly-clean.sh',
    desc: '每周日凌晨 2 点清理',
    enabled: false,
    system: true
  },
  {
    id: 'c4',
    user: 'user',
    expr: '0 18 * * 5',
    cmd: '/usr/local/bin/weekly-backup.sh',
    desc: '每周五下午 6 点备份',
    enabled: true,
    log: true
  },
],
  /* 端口服务（模拟 lsof -iTCP -sTCP:LISTEN 输出的关键列：COMMAND/PID/USER/NAME；
     type/isBrew 不在此标注——由 services.js 分类管线（classifySvc）从 command+brewServices 推导，
     对齐阶段 3 的 8-Resolver pipeline）*/
  services: [{
    id: 's1',
    port: 3000,
    name: 'Next.js Dev',
    pid: 7821,
    command: 'node',
    user: 'wangming',
    cmd: 'node .next/server',
    status: 'running',
    addr: '127.0.0.1',
    proto: 'TCP',
    uptime: '3d 2h'
  },
  {
    id: 's2',
    port: 8080,
    name: 'Nginx',
    pid: 3201,
    command: 'nginx',
    user: 'wangming',
    cmd: 'nginx: worker',
    status: 'running',
    addr: '0.0.0.0',
    proto: 'TCP',
    uptime: '5d 4h'
  },
  {
    id: 's3',
    port: 5432,
    name: 'PostgreSQL',
    pid: 4310,
    command: 'postgres',
    user: 'wangming',
    cmd: 'postgres -D /usr/local/var/postgres',
    status: 'running',
    addr: '127.0.0.1',
    proto: 'TCP',
    uptime: '42d'
  },
  {
    id: 's4',
    port: 6379,
    name: 'Redis',
    pid: 5001,
    command: 'redis-server',
    user: 'wangming',
    cmd: 'redis-server 127.0.0.1:6379',
    status: 'running',
    addr: '127.0.0.1',
    proto: 'TCP',
    uptime: '12h'
  },
  {
    id: 's5',
    port: 4040,
    name: 'ngrok',
    pid: 9100,
    command: 'ngrok',
    user: 'wangming',
    cmd: 'ngrok http 3000',
    status: 'running',
    addr: '0.0.0.0',
    proto: 'TCP',
    uptime: '1h 20m'
  },
],
  /* brew services list 交叉清单（模拟 `brew services list` 输出；classifySvc 以此判定 Brew 管理服务）*/
  brewServices: ['nginx', 'postgres', 'redis-server'],
  aiAgents: [{
    id: 'claude',
    name: 'Claude',
    cli: 'claude',
    version: '2.1.0',
    path: '/usr/local/bin/claude',
    status: 'installed',
    descKey: 'ai.agent.claude.desc',
    tags: ['anthropic', 'coding'],
    icon: 'fa-solid fa-clone'
  },
  {
    id: 'codex',
    name: 'Codex',
    cli: 'codex',
    version: '0.4.0',
    path: '/usr/local/bin/codex',
    status: 'installed',
    descKey: 'ai.agent.codex.desc',
    tags: ['openai', 'coding'],
    icon: 'fa-solid fa-code'
  },
  {
    id: 'aider',
    name: 'Aider',
    cli: 'aider',
    version: '0.62.0',
    path: '/opt/homebrew/bin/aider',
    status: 'installed',
    descKey: 'ai.agent.aider.desc',
    tags: ['openai', 'git'],
    icon: 'fa-solid fa-code-branch'
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    cli: 'gemini',
    version: '—',
    path: null,
    status: 'not_found',
    descKey: 'ai.agent.gemini.desc',
    tags: ['google'],
    icon: 'fa-solid fa-wand-magic-sparkles'
  }
],
  aiSkills: [{
    id: 'sk-plist',
    nameKey: 'ai.skill.plist.name',
    descKey: 'ai.skill.plist.desc',
    tag: 'plist',
    icon: 'fa-file-circle-plus'
  },
  {
    id: 'sk-diag',
    nameKey: 'ai.skill.diag.name',
    descKey: 'ai.skill.diag.desc',
    tag: 'diagnose',
    icon: 'fa-stethoscope'
  },
  {
    id: 'sk-refactor',
    nameKey: 'ai.skill.refactor.name',
    descKey: 'ai.skill.refactor.desc',
    tag: 'refactor',
    icon: 'fa-wand-magic-sparkles'
  },
  {
    id: 'sk-import',
    nameKey: 'ai.skill.import.name',
    descKey: 'ai.skill.import.desc',
    tag: 'import',
    icon: 'fa-file-import'
  }
],
  cronPresets: [{
    labelKey: 'cron.preset.minute',
    expr: '* * * * *',
    descKey: 'cron.preset.minuteDesc'
  },
  {
    labelKey: 'cron.preset.hourly',
    expr: '0 * * * *',
    descKey: 'cron.preset.hourlyDesc'
  },
  {
    labelKey: 'cron.preset.daily9',
    expr: '0 9 * * *',
    descKey: 'cron.preset.daily9Desc'
  },
  {
    labelKey: 'cron.preset.monday',
    expr: '0 9 * * 1',
    descKey: 'cron.preset.mondayDesc'
  },
  {
    labelKey: 'cron.preset.monthly1',
    expr: '0 0 1 * *',
    descKey: 'cron.preset.monthly1Desc'
  },
  {
    labelKey: 'cron.preset.weekday',
    expr: '0 9 * * 1-5',
    descKey: 'cron.preset.weekdayDesc'
  },
],
  liveLogs: [
  ['info', '[INFO] Heartbeat ping sent.'],
  ['ok', '[OK] Remote responded in 38ms.'],
  ['', 'Watching for file changes…'],
  ['warn', '[WARN] Rate limit approaching (87/100).'],
  ['ok', '[OK] Sync complete: notes.txt'],
  ['info', '[INFO] Memory: 18.4 MB · CPU: 1.2%']
],
  drawer: {
    title: 'com.user.sync-daemon',
    scope: '用户级 · ~/Library/LaunchAgents',
    /* 抽屉头部操作栏初始状态 */
    opsState: { loaded: true, enabled: true, running: true },
    /* 编辑表单默认值 */
    form: {
      label: 'com.user.sync-daemon',
      desc: '实时监听文件变更并自动同步至远端存储，支持增量传输与冲突检测。',
      processType: 'Background',
      program: '/usr/local/bin/sync-daemon',
      args: ['--config', '/Users/user/.sync/config.json', '--verbose'],
      workingDir: '/Users/user/Documents',
      nice: 0,
      throttleInterval: 10,
      env: { SYNC_TOKEN: 'sk-xxxxxx' },
      triggers: { runAtLoad: true, keepAlive: true, watchPaths: false, startCalendarInterval: false, startInterval: 300 },
      keepAliveMode: 'dict',
      keepAliveDict: { crashed: true, afterInitialDemand: false, successfulExit: false },
      watchPaths: ['/Users/user/Documents'],
      sciEntries: [{ Minute: 0, Hour: 10 }],
      stdout: '/tmp/sync-daemon.out',
      stderr: '/tmp/sync-daemon.err'
    },
    /* 状态 tab 默认展示 */
    status: {
      state: 'running',
      pid: 2847,
      uptime: '3h 24m',
      cpu: '1.2%',
      cpuWidth: '1.2%',
      mem: '18.4 MB',
      memWidth: '22%',
      exitCode: 0,
      restarts: 2,
      startTime: '14:32:01',
      plistPath: '~/Library/LaunchAgents/com.user.sync-daemon.plist',
      workDir: '/Users/user/Documents',
      scope: 'userAgent'
    },
    /* 日志 tab 初始日志行 [ts, type, text] */
    logLines: [
      ['14:32:01', 'info', '[INFO] Service started. PID=2847'],
      ['14:32:02', '', 'Loading config from /Users/user/.sync/config.json'],
      ['14:32:03', 'ok', '[OK] Connected to remote: s3://bucket-prod'],
      ['14:35:18', '', 'Detected 3 file changes, queuing sync…'],
      ['14:35:19', 'ok', '[OK] Synced: report.pdf (2.3 MB)'],
      ['14:38:44', 'warn', '[WARN] Retry #1 - network timeout for archive.zip'],
      ['14:38:52', 'ok', '[OK] Synced: archive.zip (18.7 MB)'],
      ['17:56:25', '', 'Heartbeat check passed. Uptime=3h24m']
    ],
    /* XML tab 初始 plist 原文 */
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.user.sync-daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/sync-daemon</string>
    <string>--config</string>
    <string>/Users/user/.sync/config.json</string>
    <string>--verbose</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/user/Documents</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>Crashed</key>
    <true/>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>/tmp/sync-daemon.out</string>
  <key>StandardErrorPath</key>
  <string>/tmp/sync-daemon.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SYNC_TOKEN</key>
    <string>sk-xxxxxx</string>
  </dict>
</dict>
</plist>`
  }
};

// 各模块引用的数据别名（保持原逻辑中的命名不变）
const agentData = MOCK_DATA.agents;
const invalidPlists = MOCK_DATA.invalidPlists;
const cronData = MOCK_DATA.crons;
const svcData = MOCK_DATA.services;
const aiAgentData = MOCK_DATA.aiAgents;
const aiSkillData = MOCK_DATA.aiSkills;
const CRON_PRESETS = MOCK_DATA.cronPresets;
const liveLogs = MOCK_DATA.liveLogs;
const GITHUB_REPO_URL = MOCK_DATA.urls.github;
const HELP_URL = MOCK_DATA.urls.help;
