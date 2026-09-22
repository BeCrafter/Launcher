// 工具层共用:作用域解析、目标定位、输出行的统一口径
//
// 目标定位是这一层最容易出错的地方:launchd 的 Label **只在作用域内唯一**,
// 同一个 label 出现在 user 与 daemon 是两回事。工具必须把这个歧义说出来,不能随便挑一个。

import type { Agent, AgentScope } from '../../../shared/models'
import type { AgentService } from '../../services/agent-service'
import type { ToolOutputLine } from '../tool-types'

export const SCOPES: AgentScope[] = ['user', 'system', 'daemon']

export function line(level: ToolOutputLine['level'], text: string): ToolOutputLine {
  return { level, text }
}

/** 作用域的中文说明(模型与用户都要看得懂 plist 落在哪个目录) */
export function scopeLabel(scope: AgentScope): string {
  if (scope === 'user') return 'user · ~/Library/LaunchAgents'
  if (scope === 'system') return 'system · /Library/LaunchAgents（仍属当前用户 gui 域）'
  return 'daemon · /Library/LaunchDaemons（系统域）'
}

/** 一行摘要:标签 + 状态 + pid/退出码(非任务/损坏文件如实标注,不伪装成任务) */
export function agentLine(a: Agent): ToolOutputLine {
  if (a.isNotTask) {
    return line('warn', `${a.fileName ?? a.label}（非任务文件：plist 未定义 Label，launchd 会忽略它）· ${a.scope}`)
  }
  if (a.parseError) {
    return line('err', `${a.fileName ?? a.label}（plist 无法解析：${a.parseError}）· ${a.scope}`)
  }
  const bits: string[] = [
    a.status === 'running' ? `运行中 pid ${a.pid ?? '—'}` : a.status === 'loaded' ? '已载入未运行' : '未运行'
  ]
  if (a.exitCode != null && a.exitCode !== 0) bits.push(`last exit ${a.exitCode}`)
  if (a.restarts > 0) bits.push(`重启 ${a.restarts} 次`)
  if (a.isDisabledByOverride) bits.push('已被 launchctl 停用')
  if (a.isBrew) bits.push('brew 管理')
  return line(a.status === 'stopped' && a.exitCode != null && a.exitCode !== 0 ? 'err' : 'info', `${a.label} · ${bits.join(' · ')} · ${a.scope}`)
}

export interface TargetHit {
  agent: Agent
  scope: AgentScope
}

export type TargetLookup =
  | { kind: 'found'; hit: TargetHit }
  | { kind: 'not-found'; message: string }
  /** 同名跨作用域:必须由调用方裁决,工具不得自行挑一个 */
  | { kind: 'ambiguous'; hits: TargetHit[] }

/**
 * 按 label 定位 agent;没有 Label 的文件(占位/损坏)退回按原文件名匹配 ——
 * 这类文件在列表里就是靠文件名认的,不按文件名找就永远找不到它们。
 * scope 显式给出时按它过滤;未给出且命中多个作用域 → 返回 ambiguous。
 */
export async function locateAgent(
  agents: AgentService,
  label: string,
  scope?: AgentScope
): Promise<TargetLookup> {
  const { agents: list } = await agents.list()
  const wanted = label.trim()
  const hits = list
    .filter((a) => (a.label !== '' ? a.label === wanted : (a.fileName ?? '') === wanted))
    .filter((a) => !scope || a.scope === scope)
    .map((a) => ({ agent: a, scope: a.scope }))

  if (hits.length === 0) {
    const where = scope ? `作用域 ${scope}` : '全部作用域'
    return { kind: 'not-found', message: `${where}下找不到 ${label}` }
  }
  if (hits.length > 1) return { kind: 'ambiguous', hits }
  return { kind: 'found', hit: hits[0] }
}

/** 列表截断:工具输出既进模型上下文也进界面,不能无限长 */
export function cap<T>(items: T[], max: number): { shown: T[]; omitted: number } {
  return items.length <= max ? { shown: items, omitted: 0 } : { shown: items.slice(0, max), omitted: items.length - max }
}

/** 把多出来的条数写成一行提示(而不是静默丢弃) */
export function omittedLine(omitted: number): ToolOutputLine[] {
  return omitted > 0 ? [line('', `… 另有 ${omitted} 项未列出`)] : []
}
