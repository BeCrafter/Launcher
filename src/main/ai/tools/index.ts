// ToolRegistry 组装:内置聊天与 MCP 服务共用的唯一工具来源
//
// 9 个只读 + 5 个写(与界面状态栏的「只读工具 9 / 写工具 5」一致)。
// 写工具必须实现 summarize —— 授权卡要展示「将要执行什么」,拿不到摘要等于让用户盲签。
import type { AgentService } from '../../services/agent-service'
import type { CrontabService } from '../../services/crontab-service'
import type { ProcessDiscovery } from '../../services/process-discovery'
import type { PlistService } from '../../services/plist-service'
import type { LaunchctlService } from '../../services/launchctl-service'
import type { BrewAgentService } from '../../services/brew-agent-service'
import type { ToolDef, ToolRegistry } from '../tool-types'
import { createServiceTools } from './service-tools'
import { createPlistTools } from './plist-tools'
import { createCronTools } from './cron-tools'
import { createLogTools } from './log-tools'

export function createToolRegistry(deps: {
  agents: AgentService
  cron: CrontabService
  discovery: ProcessDiscovery
  plists: PlistService
  launchctl: LaunchctlService
  brew: BrewAgentService
  home: string
}): ToolRegistry {
  // brew 通过 agent 列表的 isBrew 标记暴露,工具层不直接下 brew 命令
  // (brew 启停走 AgentService.brewAction,由界面按钮触发;AI 侧只做识别与劝阻)
  void deps.brew

  const tools: ToolDef[] = [
    ...createServiceTools({
      agents: deps.agents,
      cron: deps.cron,
      discovery: deps.discovery,
      plists: deps.plists,
      launchctl: deps.launchctl,
      home: deps.home
    }),
    ...createPlistTools({ agents: deps.agents, plists: deps.plists, getXmlIndent: () => '  ' }),
    ...createCronTools({ cron: deps.cron }),
    ...createLogTools({ agents: deps.agents, cron: deps.cron })
  ]

  return {
    all: () => tools,
    get: (name) => tools.find((t) => t.name === name),
    readOnly: () => tools.filter((t) => !t.write),
    writable: () => tools.filter((t) => t.write)
  }
}
