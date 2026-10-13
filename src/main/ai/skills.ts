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
先向用户确认(或从描述中提取):可执行程序与参数、触发方式(RunAtLoad / StartInterval / StartCalendarInterval)、
是否需要 KeepAlive、工作目录、日志输出路径。

PATH 硬规则(踩过多次坑,必须遵守):
- launchd **不加载** ~/.zshrc / ~/.zprofile / ~/.bashrc —— 默认 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin。
- program 与 args 里的可执行文件一律用**绝对路径**;不知道 node/go 等在哪就直接问用户要 \`command -v node\` 的输出,不要猜。
- 程序内部还会调用外部命令时,必须在 EnvironmentVariables.PATH 里显式写入用户登录 shell 的 PATH(同样向用户索取 \`echo $PATH\`,不要猜)。

流程:
1. 用 generate_plist 生成草稿并**必须**用 validate_plist 校验;校验不过就依据报错修正后重试,最多 3 次。
2. 草稿产出后,逐项说明关键键的含义。**只有用户明确要求写入时**才调用 write_plist —— 生成草稿本身不落盘。
3. 用户确认写入后:write_plist → load_plist → **必须**用 get_service_status 查运行状态、tail_log 看启动输出。
4. 未在运行 / exit code 非 0 / 日志有报错 → 诊断根因,修复(重新 write_plist + load_plist)再验证,最多 2 轮。
5. 全部通过后才汇报交付,汇报里引用 status 与日志的真实读数(pid / exit code / 日志行),不要凭印象写。`,
    tools: [
      'generate_plist',
      'validate_plist',
      'read_plist',
      'list_services',
      'write_plist',
      'load_plist',
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
不要跳过日志直接猜。结论按「症状 → 证据 → 根因 → 修复步骤 → 验证方式」组织,证据要引用具体的 pid / exit code / 日志行。
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

PATH 硬规则(与 sk-plist 相同):launchd 不加载 shell 配置;补配置时 program 用绝对路径,
程序内部会调用外部命令时必须在 EnvironmentVariables.PATH 显式写入 —— 路径拿不到就问用户要,不要猜。

需要补配置时生成草稿并校验,**写入前必须先向用户说明并取得确认**。
写入并载入后,用 get_service_status + tail_log 验证任务真的在跑,异常则修复再验(最多 2 轮)。
注意 brew 管理的 plist 不要手工改写 —— 下次 brew 操作会覆盖,这一点要如实告知用户。`,
    tools: [
      'search_services',
      'list_services',
      'read_plist',
      'get_service_status',
      'generate_plist',
      'validate_plist',
      'write_plist',
      'load_plist',
      'tail_log'
    ]
  }
]

export function findSkill(id: string | undefined): SkillDef | undefined {
  if (!id) return undefined
  return SKILLS.find((s) => s.id === id)
}
