// 卡片动作区画哪些按钮。纯函数:组件只按返回值渲染,单测不依赖 DOM。
import type { Agent, AgentStatus } from '@shared/models'

export type CardActionKind = 'intent'

export interface CardActions {
  /** 非任务 / 解析失败:启停、brew、更多都不画。铅笔始终画。 */
  abnormal: boolean
  /** 铅笔不禁用。动作区也不压暗,否则看起来像不能编辑。 */
  edit: true
  /** abnormal 时为 null。 */
  toggle: { kind: CardActionKind; action: 'start' | 'stop' } | null
  more: boolean
}

export function cardActions(agent: Pick<Agent, 'status' | 'isBrew' | 'isNotTask' | 'parseError'>): CardActions {
  if (agent.isNotTask || agent.parseError) {
    return { abnormal: true, edit: true, toggle: null, more: false }
  }
  const action = agent.status === 'running' ? 'stop' : 'start'
  // 卡片和抽屉走同一个意图入口。brew 管理的启停在 main 的 ops 里走 brew services,不是 launchctl。
  return {
    abnormal: false,
    edit: true,
    toggle: { kind: 'intent', action },
    more: true
  }
}

/**
 * 退出码的颜色。运行中的码只是上一次进程的,不能染红。
 * 红色只给「已载入、没有进程、且退出码非 0」。
 */
export function exitCodeTone(status: AgentStatus, exitCode: number): 'ok' | 'bad' | 'muted' {
  if (exitCode === 0) return 'ok'
  if (status === 'loaded') return 'bad'
  return 'muted'
}
