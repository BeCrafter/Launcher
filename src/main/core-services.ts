// 核心服务栈的单一装配点(主进程与独立的 launcher-mcp 进程共用)
//
// 为什么抽出来:AI 工具层需要同一套领域服务,而 MCP 的 stdio 形态是**外部 Agent 拉起的独立进程**,
// 它没有 Electron、也没有设置存储。若两处各自 new 一遍,diff 迟早漂移(工具在应用内跑得通、
// 在 MCP 里行为不同),所以装配只此一份,差异只通过回调注入(onServicesChange / log)。

import { userInfo } from 'node:os'
import type { ShellRunner } from './services/shell-runner'
import { createAgentService, type AgentService } from './services/agent-service'
import { createCrontabService, type CrontabService } from './services/crontab-service'
import { createProcessDiscovery, type ProcessDiscovery, type ScanResult } from './services/process-discovery'
import { createDockerService, type DockerService } from './services/docker-service'
import { createTermination, type TerminationService } from './services/termination'
import { createPlistService, type PlistService } from './services/plist-service'
import { createLaunchctlService, type LaunchctlService } from './services/launchctl-service'
import { createBrewAgentService, type BrewAgentService } from './services/brew-agent-service'
import type { ElevationExecutor } from './services/elevation'

export interface CoreServices {
  plists: PlistService
  agents: AgentService
  cron: CrontabService
  discovery: ProcessDiscovery
  termination: TerminationService
  docker: DockerService
  /** AI 工具层需要直接下 launchctl 动词(载入/卸载/诊断),故连同底层门面一起给出 */
  launchctl: LaunchctlService
  brew: BrewAgentService
}

export function createCoreServices(opts: {
  runner: ShellRunner
  elevate: ElevationExecutor
  home: string
  /** xmlIndent 设置('2' | '4' | 'tab');独立进程里给固定值即可 */
  getXmlIndent(): string
  getCronRetainDays(): number
  /** 服务发现结果变化(应用内推给渲染层;独立进程不需要) */
  onServicesChange?(r: ScanResult, polling: boolean): void
  log?(msg: string): void
}): CoreServices {
  const log = opts.log ?? ((): void => {})
  const plists = createPlistService({ runner: opts.runner, elevate: opts.elevate, home: opts.home })

  const cron = createCrontabService({
    runner: opts.runner,
    elevate: opts.elevate,
    home: opts.home,
    username: userInfo().username,
    getRetainDays: opts.getCronRetainDays
  })

  const launchctl = createLaunchctlService({
    runner: opts.runner,
    elevate: opts.elevate,
    uid: process.getuid?.() ?? 501
  })
  const brew = createBrewAgentService({ runner: opts.runner, elevate: opts.elevate })
  const agents = createAgentService({
    runner: opts.runner,
    launchctl,
    plists,
    brew,
    getXmlIndent: opts.getXmlIndent
  })

  const docker = createDockerService({ runner: opts.runner })
  const termination = createTermination({ runner: opts.runner, elevate: opts.elevate })
  // onServicesChange 里的 polling 由调用方的 discovery 实例读出,故这里延迟绑定
  let discovery!: ProcessDiscovery
  discovery = createProcessDiscovery({
    runner: opts.runner,
    docker,
    log,
    onChange: (r) => opts.onServicesChange?.(r, discovery.polling)
  })

  return { plists, agents, cron, discovery, termination, docker, launchctl, brew }
}
