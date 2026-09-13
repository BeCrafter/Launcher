// ══════════════ 测试数据 ══════════════
// 页面用到的全部测试/演示数据集中在此（JSON 结构），页面与逻辑中不再写死。
// AI 对话页「生成 LaunchAgent」场景与预置会话共用的 plist 草稿（避免两处漂移）
const AI_PLIST_DRAFT = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.user.backup-nightly</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/backup.sh</string>
    <string>--full</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>2</integer>
    <key>Minute</key>
    <integer>30</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/tmp/backup-nightly.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/backup-nightly.err.log</string>
</dict>
</plist>`;
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
  /* AI 对话页：预置已完成会话（点击加载为静态全量对话，不走动画） */
  aiChats: [
    {
      id: 'chat-diag',
      title: '诊断 notify-push 未运行',
      ts: '今天 14:32',
      messages: [
        { role: 'user', text: 'com.user.notify-push 好像挂了，帮我看看怎么回事' },
        {
          role: 'bot',
          steps: {
            collapsed: true,
            elapsedMs: 1420,
            items: [
              { tool: 'get_service_status', args: 'com.user.notify-push', status: 'err', ms: 150,
                out: [['err', '-  1  com.user.notify-push（last exit 1 · restarts 3）'], ['', 'state = not running · pid = —']] },
              { tool: 'read_plist', args: '~/Library/LaunchAgents/com.user.notify-push.plist', status: 'ok', ms: 120,
                out: [['info', 'Program = /usr/local/bin/notify-push'], ['warn', 'KeepAlive = true（退出后立即重拉）']] },
              { tool: 'tail_log', args: 'com.user.notify-push · stderr', status: 'err', ms: 300,
                out: [['err', 'dyld: Library not loaded: libssl.1.1.dylib'], ['err', 'Reason: image not found']] }
            ]
          },
          text: '根因是动态库依赖失效：notify-push 链接的 openssl@1.1 已从 Homebrew 移除，进程启动 0.2s 后即被 dyld 终止（exit 1）。KeepAlive = true 让 launchd 反复重拉，于是留下了 3 次重启记录。\n\n修复路径：① brew reinstall notify-push 重建链接，或改用 openssl@3 重新编译；② 修复前先把 KeepAlive 临时改为 false，避免无意义的重启循环。'
        }
      ]
    },
    {
      id: 'chat-plist',
      title: '生成 backup-nightly LaunchAgent',
      ts: '今天 11:05',
      messages: [
        { role: 'user', text: '帮我生成一个每天 02:30 跑全量备份的 LaunchAgent' },
        {
          role: 'bot',
          steps: {
            collapsed: true,
            elapsedMs: 980,
            items: [
              { tool: 'generate_plist', args: 'label=com.user.backup-nightly', status: 'ok', ms: 420,
                out: [['ok', '生成草稿：RunAtLoad + StartCalendarInterval 02:30']] },
              { tool: 'validate_plist', args: 'plutil -lint', status: 'ok', ms: 110,
                out: [['ok', 'plutil -lint：OK（schema 校验通过）']] }
            ]
          },
          cards: [
            { kind: 'plist', path: '~/Library/LaunchAgents/com.user.backup-nightly.plist', xml: AI_PLIST_DRAFT },
            { kind: 'approve', tool: 'write_plist',
              detail: '写入 com.user.backup-nightly.plist 到 ~/Library/LaunchAgents 并载入',
              command: 'cat > ~/Library/LaunchAgents/com.user.backup-nightly.plist && launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.user.backup-nightly.plist',
              state: 'approved' }
          ],
          text: '已写入并载入。任务将在每天 02:30 触发全量备份，登录时也会补跑一次（RunAtLoad）。'
        }
      ]
    },
    {
      id: 'chat-cron',
      title: '新增磁盘检查定时任务',
      ts: '昨天 18:20',
      messages: [
        { role: 'user', text: '加一条每天 18:30 的磁盘检查任务' },
        {
          role: 'bot',
          steps: {
            collapsed: true,
            elapsedMs: 640,
            items: [
              { tool: 'list_services', args: 'domain=gui · source=cron', status: 'ok', ms: 200,
                out: [['info', '现有 cron 4 条，无 18:30 时段的重复任务']] },
              { tool: 'add_cron', args: '30 18 * * * /usr/local/bin/disk-check.sh', status: 'ok', ms: 180,
                out: [['ok', '已写入用户 crontab']] }
            ]
          },
          cards: [
            { kind: 'cron', expr: '30 18 * * *', cmd: '/usr/local/bin/disk-check.sh' },
            { kind: 'approve', tool: 'add_cron',
              detail: '向用户 crontab 追加磁盘检查任务（每天 18:30）',
              command: 'crontab -l | { cat; echo "30 18 * * * /usr/local/bin/disk-check.sh"; } | crontab -',
              state: 'approved' }
          ],
          text: '已写入 crontab。下一次执行：今天 18:30；输出默认写入任务日志，可在定时任务页的日志抽屉中查看。',
          suggest: ['再跑一次系统体检', '诊断 notify-push 为什么退出']
        }
      ]
    },
    {
      id: 'chat-refactor',
      title: '重复 plist 合并建议',
      ts: '09-11 09:40',
      messages: [
        { role: 'user', text: '帮我看看有没有重复的 plist 配置' },
        {
          role: 'bot',
          steps: {
            collapsed: true,
            elapsedMs: 1180,
            items: [
              { tool: 'read_plist', args: '~/Library/LaunchAgents/*', status: 'ok', ms: 350,
                out: [['info', '读取 6 份 plist（用户域 4 · 系统域 2）']] },
              { tool: 'search_services', args: 'keyword=backup', status: 'ok', ms: 160,
                out: [['info', '命中 2 项：com.user.backup-cron · c4 weekly-backup']] }
            ]
          },
          text: '发现一组语义重复的备份任务：launchd 的 com.user.backup-cron（每日）与 cron 的「每周五下午 6 点备份」都在执行 backup.sh 全量备份。\n\n建议保留 launchd 任务（有 KeepAlive 看护、可在本应用统一管理），把每周任务改为 backup.sh --incremental 并挂到同一任务的 StartCalendarInterval 数组里，减少一份独立调度配置。'
        }
      ]
    }
  ],
  /* AI 对话页：可运行场景时间线（技能卡 / 体检卡 / 自由输入命中；t=步骤联合类型） */
  aiScenes: [
    {
      id: 'health',
      title: '系统体检',
      match: ['体检', '检查'],
      steps: [
        { t: 'user', text: '先帮我做一次系统体检' },
        { t: 'think' },
        { t: 'tool', tool: 'list_services', args: 'domain=gui + system', status: 'ok', ms: 200, res: true,
          out: [['info', 'launchd {N_AGENTS} 项 · cron {N_CRONS} 条 · 端口 {N_SVCS} 个'], ['', '运行中 Agent {N_AG_RUN} · 启用 cron {N_CRON_ON}']] },
        { t: 'tool', tool: 'check_port', args: '3000, 6379', status: 'ok', ms: 90,
          out: [['ok', '3000 LISTEN node · 6379 LISTEN redis-server']] },
        { t: 'tool', tool: 'collect_diagnostic_context', status: 'ok', ms: 260, res: true,
          out: [['warn', '已停止任务 {N_AG_BAD} 个（含 com.user.notify-push）'], ['warn', '停用的系统级 cron：c3 weekly-clean']] },
        { t: 'card', card: { kind: 'report', items: [
          { level: 'err', text: 'com.user.notify-push 反复退出（exit 1 · 重启 3 次），当前已停止', goto: 'agents' },
          { level: 'warn', text: '系统级 cron「每周日凌晨 2 点清理」处于停用状态', goto: 'crontab' },
          { level: 'ok', text: '{N_SVCS} 个监听端口全部正常（3000 · 8080 · 5432 · 6379 · 4040）' }
        ] } },
        { t: 'stream', text: '体检完成，整体健康。优先处理 1 个异常任务：notify-push 的动态库依赖失效导致反复退出；cron 侧仅有一条系统任务被停用，确认后可直接启用。' },
        { t: 'suggest', items: ['诊断 notify-push 为什么退出', '扫描重复的 plist 配置', '生成一个开机自启的 LaunchAgent'] }
      ]
    },
    {
      id: 'sk-diag',
      title: '诊断任务',
      match: ['诊断', '异常', '排查', '退出', '没运行', '停止'],
      steps: [
        { t: 'user', text: '诊断一下 notify-push 为什么退出了' },
        { t: 'think' },
        { t: 'tool', tool: 'get_service_status', args: 'com.user.notify-push', status: 'err', ms: 150,
          out: [['err', '-  1  com.user.notify-push（last exit 1 · restarts 3）'], ['', 'state = not running · pid = —']] },
        { t: 'tool', tool: 'read_plist', args: '~/Library/LaunchAgents/com.user.notify-push.plist', status: 'ok', ms: 120,
          out: [['info', 'Program = /usr/local/bin/notify-push'], ['warn', 'KeepAlive = true（退出后立即重拉）']] },
        { t: 'tool', tool: 'tail_log', args: 'com.user.notify-push · stderr', status: 'err', ms: 300,
          out: [['err', 'dyld: Library not loaded: /usr/local/opt/openssl@1.1/lib/libssl.1.1.dylib'], ['err', 'Reason: image not found'], ['', '进程启动后 0.2s 即退出']] },
        { t: 'stream', text: '根因定位：notify-push 链接的 openssl@1.1 已从 Homebrew 移除，dyld 加载动态库失败，进程启动即终止（exit 1）；KeepAlive = true 造成反复重拉。\n\n修复建议：① brew reinstall notify-push 重建链接，或改用 openssl@3 重新编译；② 修复前先把 KeepAlive 改为 false，终止重启循环。' },
        { t: 'suggest', items: ['生成修复后的 plist 草稿', '扫描重复的 plist 配置', '再跑一次系统体检'] }
      ]
    },
    {
      id: 'sk-refactor',
      title: '批量重构建议',
      match: ['重构', '合并', '重复', '整理'],
      steps: [
        { t: 'user', text: '扫描一下重复的 plist 配置，给合并建议' },
        { t: 'think' },
        { t: 'tool', tool: 'read_plist', args: '~/Library/LaunchAgents/*', status: 'ok', ms: 350,
          out: [['info', '读取 6 份 plist（用户域 4 · 系统域 2）']] },
        { t: 'tool', tool: 'search_services', args: 'keyword=backup', status: 'ok', ms: 160,
          out: [['info', '命中 2 项：com.user.backup-cron · c4 weekly-backup']] },
        { t: 'stream', text: '发现一组语义重复的备份任务：launchd 的 com.user.backup-cron（每日）与 cron 的「每周五下午 6 点备份」都在执行 backup.sh 全量备份。\n\n建议保留 launchd 任务，把每周任务改为 backup.sh --incremental 并挂到同一任务的 StartCalendarInterval 数组，减少一份独立调度配置。' },
        { t: 'suggest', items: ['生成合并后的 plist 草稿', '把 Homebrew 服务导入为受管任务', '再跑一次系统体检'] }
      ]
    },
    {
      id: 'sk-import',
      title: '导入现网配置',
      match: ['导入', 'brew', '迁移'],
      steps: [
        { t: 'user', text: '把 Homebrew 服务导入为受管任务' },
        { t: 'think' },
        { t: 'tool', tool: 'search_services', args: 'source=brew', status: 'ok', ms: 260,
          out: [['info', 'brew services：nginx · postgres · redis-server（3 项均已存在 launchd 标签）']] },
        { t: 'tool', tool: 'list_services', args: 'domain=gui', status: 'ok', ms: 150,
          out: [['ok', '已匹配 2 项现存标签 · 0 项需新建']] },
        { t: 'tool', tool: 'generate_plist', args: 'dry-run', status: 'ok', ms: 380,
          out: [['ok', 'dry-run：1 项改进建议（redis-server 缺少日志输出路径）']] },
        { t: 'stream', text: '导入分析完成：3 个 Homebrew 服务都已有对应 launchd 标签，无需新建。唯一建议是为 redis-server 补充 StandardOutPath / StandardErrorPath，让日志纳入本应用统一查看。' },
        { t: 'card', card: { kind: 'approve', tool: 'write_plist',
          detail: '为 homebrew.mxcl.redis 的 plist 补充日志输出路径',
          command: 'plutil -insert StandardOutPath -string /usr/local/var/log/redis.log ~/Library/LaunchAgents/homebrew.mxcl.redis.plist',
          state: 'pending' } }
      ],
      afterApprove: [
        { t: 'tool', tool: 'write_plist', args: 'homebrew.mxcl.redis', status: 'ok', ms: 200,
          out: [['ok', '已更新 · 下次载入后生效']] },
        { t: 'stream', text: '完成：redis 日志路径已补齐，之后在「Agent 日志」抽屉里可以直接查看 redis-server 的输出。' },
        { t: 'suggest', items: ['扫描重复的 plist 配置', '再跑一次系统体检', '诊断 notify-push 为什么退出'] }
      ]
    },
    {
      id: 'sk-plist',
      title: '生成 LaunchAgent',
      match: ['生成', 'plist', 'LaunchAgent', '开机', '自启'],
      steps: [
        { t: 'user', text: '帮我生成一个开机自动启动的备份 LaunchAgent' },
        { t: 'think' },
        { t: 'tool', tool: 'generate_plist', args: 'label=com.user.backup-nightly', status: 'ok', ms: 420,
          out: [['ok', '生成草稿：RunAtLoad + StartCalendarInterval 02:30']] },
        { t: 'tool', tool: 'validate_plist', args: 'plutil -lint', status: 'ok', ms: 110,
          out: [['ok', 'plutil -lint：OK（schema 校验通过）']] },
        { t: 'card', card: { kind: 'plist', path: '~/Library/LaunchAgents/com.user.backup-nightly.plist', xml: AI_PLIST_DRAFT } },
        { t: 'stream', text: '草稿已通过 plutil 校验。写入后登录时自动载入，并每天 02:30 触发一次全量备份。' },
        { t: 'card', card: { kind: 'approve', tool: 'write_plist',
          detail: '写入 com.user.backup-nightly.plist 到 ~/Library/LaunchAgents 并载入',
          command: 'cat > ~/Library/LaunchAgents/com.user.backup-nightly.plist && launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.user.backup-nightly.plist',
          state: 'pending' } }
      ],
      afterApprove: [
        { t: 'tool', tool: 'write_plist', args: 'com.user.backup-nightly', status: 'ok', ms: 180,
          out: [['ok', '已写入 · 权限 644']] },
        { t: 'tool', tool: 'load_plist', args: 'launchctl bootstrap gui/501', status: 'ok', ms: 220,
          out: [['ok', 'bootstrap 成功 · 已载入']] },
        { t: 'stream', text: '完成：com.user.backup-nightly 已写入并载入，当前状态「已载入 · 等待触发」，将在每天 02:30 运行。' },
        { t: 'suggest', items: ['扫描重复的 plist 配置', '诊断 notify-push 为什么退出', '再跑一次系统体检'] }
      ]
    },
    {
      id: 'fallback',
      title: '当前状态概览',
      match: [],
      steps: [
        { t: 'think' },
        { t: 'tool', tool: 'list_services', args: 'domain=gui + system', status: 'ok', ms: 200, res: true,
          out: [['info', 'launchd {N_AGENTS} 项 · cron {N_CRONS} 条 · 端口 {N_SVCS} 个'], ['', '运行中 Agent {N_AG_RUN} · 启用 cron {N_CRON_ON}']] },
        { t: 'tool', tool: 'collect_diagnostic_context', status: 'ok', ms: 240, res: true,
          out: [['warn', '{N_AG_BAD} 个任务已停止，其中 com.user.notify-push 因依赖缺失反复退出']] },
        { t: 'stream', res: true, text: '我先扫了一遍当前环境：{N_AGENTS} 个 launchd 任务（{N_AG_RUN} 个运行中）、{N_CRONS} 条 cron（{N_CRON_ON} 条启用）、{N_SVCS} 个监听端口，整体正常。\n\n有一处值得注意：com.user.notify-push 已停止（exit 1）。你可以让我诊断它，或者直接告诉我你想做什么——生成配置、加定时任务、排查端口都可以。' },
        { t: 'suggest', items: ['诊断 notify-push 为什么退出', '生成一个开机自启的 LaunchAgent', '再跑一次系统体检'] }
      ]
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
const aiChatData = MOCK_DATA.aiChats;
const aiSceneData = MOCK_DATA.aiScenes;
const CRON_PRESETS = MOCK_DATA.cronPresets;
const liveLogs = MOCK_DATA.liveLogs;
const GITHUB_REPO_URL = MOCK_DATA.urls.github;
const HELP_URL = MOCK_DATA.urls.help;
