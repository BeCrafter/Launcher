// 抽屉头部操作栏:意图层模型(应用新增,非 demo 移植)
// 用户只表达意图(启动/停止/重启/开机自启),launchctl 的三轴
// (bootstrap/bootout · enable/disable · kickstart)顺序逻辑全部下沉在 main 的意图动作里。
// 因此这里没有任何"因顺序而置灰"的按钮——约束不需要用户学,也不会以灰按钮形式出现。
// 维度之间的联动用「未来时句」(futureHintKey)表达:直接告诉用户接下来会发生什么。
import type { OpsState } from '@shared/models'

export interface OpsBarModel {
  state: 'draft' | 'stopped' | 'pending' | 'running'
  /** 主操作:未运行→启动 / 运行中→停止 */
  primary: { action: 'start' | 'stop'; labelKey: string; icon: string; cls: string; disabled: boolean }
  restart: { labelKey: string; icon: string; cls: string; disabled: boolean }
  /** 开机自启开关(与当前运行状态无关:只管下次登录) */
  autostart: { on: boolean; labelKey: string; disabled: boolean }
  chip: { labelKey: string; dot: string; color: string }
  /** 未来时句:说清"接下来会发生什么"(联动表达;草稿态为 null) */
  futureHintKey: string | null
}

export function deriveOpsBar(s: OpsState & { isDraft: boolean }): OpsBarModel {
  if (s.isDraft) {
    return {
      state: 'draft',
      primary: { action: 'start', labelKey: 'ops.start', icon: 'fa-solid fa-play', cls: 'hdr-ops-btn', disabled: true },
      restart: { labelKey: 'ops.restart', icon: 'fa-solid fa-rotate-right', cls: 'hdr-ops-btn', disabled: true },
      autostart: { on: false, labelKey: 'ops.autostart', disabled: true },
      chip: { labelKey: 'ops.state.draft', dot: 'unloaded', color: 'var(--dim)' },
      futureHintKey: null
    }
  }
  // 待运行 := 仍由 launchd 管理但当前没有进程(定时/触发型任务在两次执行之间)
  const pending = s.loaded && !s.running
  const state = s.running ? 'running' : pending ? 'pending' : 'stopped'
  const chip = {
    running: { labelKey: 'ops.state.running', dot: 'running', color: 'var(--green)' },
    pending: { labelKey: 'ops.state.pending', dot: 'loaded', color: 'var(--accent2)' },
    stopped: { labelKey: 'ops.state.stopped', dot: 'unloaded', color: 'var(--dim)' }
  }[state]
  // 联动:待运行时最该知道的是"它仍会被自动触发";否则说清"下次登录会不会自动起"
  const futureHintKey = pending ? 'ops.hint.pending' : s.enabled ? 'ops.hint.autoOn' : 'ops.hint.autoOff'
  return {
    state,
    primary: s.running
      ? { action: 'stop', labelKey: 'ops.stop', icon: 'fa-solid fa-stop', cls: 'hdr-ops-btn active-blue', disabled: false }
      : { action: 'start', labelKey: 'ops.start', icon: 'fa-solid fa-play', cls: 'hdr-ops-btn active-green', disabled: false },
    restart: { labelKey: 'ops.restart', icon: 'fa-solid fa-rotate-right', cls: 'hdr-ops-btn', disabled: false },
    autostart: {
      on: s.enabled,
      labelKey: 'ops.autostart',
      disabled: false
    },
    chip,
    futureHintKey
  }
}
