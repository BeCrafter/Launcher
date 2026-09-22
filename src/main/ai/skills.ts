// 内置技能 = 任务提示词 + 工具白名单(ai-capability.md「技能 = 任务提示词 + 工具白名单 + 上下文装载器」)
//
// 技能的 id / nameKey / descKey / tag / icon 与 demo 的 MOCK_DATA.aiSkills 一致(欢迎态技能卡直出),
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
}

export const SKILLS: SkillDef[] = [
  {
    id: 'sk-plist',
    nameKey: 'ai.skill.plist.name',
    descKey: 'ai.skill.plist.desc',
    tag: 'plist',
    icon: 'fa-file-circle-plus',
    task: `当前任务:根据用户的运行参数**生成一份 launchd plist 草稿**。
先向用户确认(或从描述中提取):可执行程序与参数、触发方式(RunAtLoad / StartInterval / StartCalendarInterval)、
是否需要 KeepAlive、工作目录、日志输出路径。
用 generate_plist 生成草稿并**必须**用 validate_plist 校验;校验不过就依据报错修正后重试,最多 3 次。
草稿产出后,逐项说明关键键的含义。**只有用户明确要求写入时**才调用 write_plist —— 生成草稿本身不落盘。`,
    tools: ['generate_plist', 'validate_plist', 'read_plist', 'list_services', 'write_plist', 'load_plist']
  },
  {
    id: 'sk-diag',
    nameKey: 'ai.skill.diag.name',
    descKey: 'ai.skill.diag.desc',
    tag: 'diagnose',
    icon: 'fa-stethoscope',
    task: `当前任务:**诊断某个任务为什么没在运行 / 反复退出**。
按 状态 → plist → 日志 的顺序取证(get_service_status → read_plist → tail_log),
不要跳过日志直接猜。结论按「症状 → 证据 → 根因 → 修复步骤 → 验证方式」组织,证据要引用具体的 pid / exit code / 日志行。
修复需要落盘时先说明再调用写工具,用户在授权卡上确认后才会执行。`,
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
    task: `当前任务:**盘点本机已安装的 Homebrew 服务,评估能否纳入 Launcher 统一管理**。
用 search_services(source=brew) 与 list_services 找出 brew 管理的服务及其现有 launchd 标签,
逐个说明:已有对应标签的(无需新建)、缺日志路径的、以及未被 Launcher 看到的。
需要补配置时生成草稿并校验,**写入前必须先向用户说明并取得确认**。
注意 brew 管理的 plist 不要手工改写 —— 下次 brew 操作会覆盖,这一点要如实告知用户。`,
    tools: ['search_services', 'list_services', 'read_plist', 'get_service_status', 'generate_plist', 'validate_plist']
  }
]

export function findSkill(id: string | undefined): SkillDef | undefined {
  if (!id) return undefined
  return SKILLS.find((s) => s.id === id)
}
