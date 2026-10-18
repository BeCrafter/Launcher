// 内置技能 = 任务提示词 + 工具白名单 + 上下文装载器
//
// 技能的 id / nameKey / descKey / tag / icon 与欢迎态技能卡一致,
// 界面文案走既有 i18n 键(ai.skill.*.name / .desc),不在代码里写死中英文。

export interface SkillDef {
  id: string
  nameKey: string
  descKey: string
  tag: string
  icon: string
  /** 追加到专家提示词之后的任务段 */
  task: string
  /**
   * 工具白名单(null = 不限制)。收窄工具面既省 token 也降误用:
   * 例如「批量重构建议」只读,不给它任何写工具。
   */
  tools: string[] | null
  /**
   * 技能级轮数下限。闭环类技能(生成→写入→载入→验证)在默认 8 轮下会被
   * finishTurn 拦腰截断,验证环根本跑不完 —— 取 Math.max(全局设置, 此值),
   * 只抬高下限,不压过用户更高的全局设置。
   */
  turnLimit?: number
}

export const SKILLS: SkillDef[] = [
  {
    id: 'sk-plist',
    nameKey: 'ai.skill.plist.name',
    descKey: 'ai.skill.plist.desc',
    tag: 'plist',
    icon: 'fa-file-circle-plus',
    turnLimit: 16,
    task: `当前任务:根据用户的运行参数**生成并交付一份 launchd 任务**(草稿 → 用户确认 → 载入 → 自动验证)。

先判定服务形态(决定 KeepAlive 与验证判据):
- 常驻服务(HTTP / worker / 守护进程):RunAtLoad=true + KeepAlive=true;验证 running、端口与日志。
- 一次性任务(跑完就退出):**不要 KeepAlive**;成功判据是 exit code 0,未在运行不是故障。
- 定时任务(StartInterval / StartCalendarInterval):**不要 KeepAlive**(除非用户明确要求);两次触发之间未运行正常,重点看 last exit 与日志。
- 仅手动启动(无任何触发条件):不要 KeepAlive/定时;载入后会立即运行一次,之后未运行是正常终态。

页面表单支持的配置项(生成时只使用这些,不要引入页面无法表达的键):
RunAtLoad / KeepAlive(true 或 Crashed/SuccessfulExit 字典) / StartInterval / StartCalendarInterval(键名大写:Minute/Hour/Day/Weekday/Month) /
WatchPaths / Nice(-20~20) / UserName(仅 daemon) / ProcessType / ThrottleInterval / EnvironmentVariables / WorkingDirectory / stdout/stderr / desc。
ProcessType 默认 Standard;低优先级后台任务用 Background;需要及时响应/前台交互用 Interactive。

先向用户确认(能从命令/描述推断的先推断,只问会改变结果的):可执行程序与参数、工作目录、触发方式、作用域、监听端口、日志策略。

PATH(完整规则见专家提示词,这里只列本任务的具体查法):
- launchd 不加载 shell 配置;program 用绝对路径;程序内部调外部命令时写 EnvironmentVariables.PATH。
- 查路径用 \`zsh -lic 'command -v node'\` / \`node -p "process.execPath"\` / \`zsh -lic 'go env GOROOT GOPATH GOMODCACHE GOCACHE'\`;登录 PATH 用 \`zsh -lic 'echo $PATH'\`。不要猜。
- nvm / gvm / asdf 等版本管理器取真实工具链路径,不要用 shim。
- 命令含 \`&&\` / 管道 / \`$(...)\` / alias / shell function 时,生成带 \`exec\` 的 wrapper,不要把 \`sh -c\` 直接塞进 plist。

日志策略(默认要配,但按输出视情况调整):
- 常驻 CLI 服务默认配 StandardOutPath + StandardErrorPath;一次性/定时任务至少配 StandardErrorPath —— 输出是诊断与验证的唯一证据。
- 程序自己写日志文件(\`--log-file\` / \`LOG_FILE\` / 配置项)时,不要和 launchd 抢同一个文件;传 \`logs: 'none'\` 不自动派生日志路径,需要兜住崩溃输出时再显式传 \`stderr\`;并把程序自己的日志路径告诉用户。用户给出绝对路径后,可用 \`tail_log path=<绝对路径>\` 读取(仅允许标准日志目录或该任务已配置的路径)。
- 输出含 token/密钥时先警告,由用户决定是否落盘。
- 默认目录:user → \`~/Library/Logs/<Label>/\`;system/daemon → \`/Library/Logs/<Label>/\`;文件 \`stdout.log\` / \`stderr.log\`。给 generate_plist 传 \`scope\` 后,\`logs: 'auto'\`(默认)会按作用域自动派生这两个路径。
- 传给 generate_plist 的 \`logDir\` / \`stdout\` / \`stderr\` 必须解析成**绝对路径**(工具会展开 \`~/\`);launchd 不展开 \`~\`。
- launchd 不轮转日志:长期运行要提示用户配置轮转。

作用域:
- 默认 **user**(\`~/Library/LaunchAgents\`,不需要管理员授权,能访问用户 home / Keychain)。
- system/daemon 只在「未登录也要运行」或需要特权端口/系统资源时使用;说明提权、运行用户与日志属主。
- scope 一旦确定,\`generate_plist\` / \`write_plist\` / \`load_plist\` 三处必须一致(否则日志默认目录与实际写入目录会错位)。
- 同名 Label 先 list_services / read_plist 检查;已存在时说明差异,由用户决定覆盖 / 换 Label / 取消;覆盖前确认 write_plist 会生成 .bak。

流程:
1. 首选调用 prepare_agent(**传 scope、端口与日志策略**)：它只读地检查 program / WorkingDirectory / 同名任务 / Homebrew / 端口，并展示创建计划、风险、待确认项和验证方式；绝不因为计划卡写入或载入。
2. 计划有阻断项时先解决；计划就绪后，用 generate_plist 生成草稿(**同一份 scope + logs/logDir/stdout/stderr**)，工具已内置 plutil 校验；XML 被修改过时再显式调用 validate_plist。
3. 草稿产出后逐项说明关键键。**只有用户明确要求应用时**才调用 write_plist;必须把 generate_plist 返回的**完整 XML 原样作为 write_plist.xml**传入，绝不能只传 label/scope/overwrite。生成/准备阶段都不落盘。
4. 写入后 load_plist(已载入会先卸载再载入;RunAtLoad 立即运行,定时/WatchPaths 按计划等待,仅手动任务立即运行一次)→ get_service_status + tail_log;若服务监听端口,再 check_port 确认端口在监听且 pid 与 status 一致。
5. 判据:常驻服务 running=false / exit≠0 / 日志报错 → 诊断修复;一次性任务 exit code 0 即成功;定时任务未运行不一定是故障;仅手动任务未运行正常。修复后重新 write_plist + load_plist 再验证,最多 2 轮。
6. 载入失败或修复无效:可 unload_plist;恢复旧配置时 read_plist 指向 \`<path>.bak\`,再用 write_plist(overwrite=true) 写回,然后 load_plist(先向用户说明再操作)。
7. 全部通过后才汇报交付,引用真实读数(pid / exit code / 端口 / 日志行),不要凭印象写。`,
    tools: [
      'prepare_agent',
      'generate_plist',
      'validate_plist',
      'read_plist',
      'list_services',
      'check_port',
      'write_plist',
      'load_plist',
      'unload_plist',
      'get_service_status',
      'tail_log'
    ]
  },
  {
    id: 'sk-diag',
    nameKey: 'ai.skill.diag.name',
    descKey: 'ai.skill.diag.desc',
    tag: 'diagnose',
    icon: 'fa-stethoscope',
    turnLimit: 16,
    task: `当前任务:**诊断某个任务为什么没在运行 / 反复退出**。
按 状态 → plist → 日志 的顺序取证(get_service_status → read_plist → tail_log),
不要跳过日志直接猜。任务自己管理日志时,向用户要日志文件的**绝对路径**,用 \`tail_log path=<绝对路径>\` 读取(仅允许标准日志目录或该任务已配置的路径)。结论按「症状 → 证据 → 根因 → 修复步骤 → 验证方式」组织,证据要引用具体的 pid / exit code / 日志行。
修复需要落盘时先说明再调用写工具,用户在授权卡上确认后才会执行。
修复落盘并**载入之后,必须实际调用 get_service_status 与 tail_log 验证**(状态正常、日志无新报错)再给最终结论 —— 不要只说"应该好了"。`,
    tools: null
  },
  {
    id: 'sk-refactor',
    nameKey: 'ai.skill.refactor.name',
    descKey: 'ai.skill.refactor.desc',
    tag: 'refactor',
    icon: 'fa-wand-magic-sparkles',
    task: `当前任务:**扫描重复或冗余的任务配置,给出合并与抽象建议**。
用 list_services / search_services 找出语义重复的任务(例如 launchd 与 cron 都在做同一件事),
读它们的 plist 对比差异,再用 start_interval / calendar / StartCalendarInterval 等实际键给出**可落地的合并方案**。
本任务是**只读分析**:不要调用任何写工具,把建议交给用户决定。`,
    tools: ['list_services', 'search_services', 'read_plist', 'get_service_status', 'validate_plist', 'generate_plist']
  },
  {
    id: 'sk-import',
    nameKey: 'ai.skill.import.name',
    descKey: 'ai.skill.import.desc',
    tag: 'import',
    icon: 'fa-file-import',
    turnLimit: 16,
    task: `当前任务:**盘点本机已安装的 Homebrew 服务,评估能否纳入 Launcher 统一管理**。
用 search_services(source=brew) 与 list_services 找出 brew 管理的服务及其现有 launchd 标签,
逐个说明:已有对应标签的(无需新建)、缺日志路径的、以及未被 Launcher 看到的。

PATH(完整规则见专家提示词):launchd 不加载 shell 配置;补配置时 program 用绝对路径,
程序内部会调用外部命令时必须写 EnvironmentVariables.PATH —— 路径拿不到就问用户,不要猜。

日志与验证:
- 补配置时传 scope;brew 服务自己管理日志时传 \`logs: 'none'\`,并如实告诉用户日志在哪;否则按 scope 派生默认日志目录(可再用 tail_log path= 读取自定义路径)。
- 生成草稿前预检 program / WorkingDirectory;需要补配置时生成并校验,**写入前必须先向用户说明并取得确认**。
- 写入并载入后,用 get_service_status + tail_log 验证;已知监听端口时用 check_port 确认端口在监听且 pid 一致。
- 判据:常驻服务 running=false / exit≠0 / 日志报错 → 修复;一次性任务 exit code 0 即成功;定时任务两次触发之间未运行正常。
- 载入失败或需要回滚时可 unload_plist;覆盖前生成的 .bak 可用于恢复旧配置(先向用户说明)。
注意 brew 管理的 plist 不要手工改写 —— 下次 brew 操作会覆盖,这一点要如实告知用户。`,
    tools: [
      'search_services',
      'list_services',
      'read_plist',
      'get_service_status',
      'check_port',
      'generate_plist',
      'validate_plist',
      'write_plist',
      'load_plist',
      'unload_plist',
      'tail_log'
    ]
  }
]

export function findSkill(id: string | undefined): SkillDef | undefined {
  if (!id) return undefined
  return SKILLS.find((s) => s.id === id)
}
