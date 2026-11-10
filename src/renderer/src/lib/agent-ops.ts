// Agent 意图动作统一入口(抽屉头部与列表卡片共用——两处各写一份会让语义漂移,上一轮就是这么出的问题)
// 负责:提权说明 → 联动询问 → 调 main 意图动作 → toast。顺序逻辑本身在 main,这里只管交互外壳。
import type { Agent, OpsState } from '@shared/models'
import { dataSource } from '../data'
import { ELEVATION } from './elevation'
import { CHOICE } from './choice'
import { showToast } from './utils'
import { cronErrorToast } from './cron'
import { makeT, getCurrentLang } from '../i18n'
import { useAgentsStore } from '../state/agents-store'

/** 用户语义的意图动作 */
export type AgentIntent = 'start' | 'stop' | 'restart' | 'autostart'

const LABEL_KEY: Record<AgentIntent, string> = {
  start: 'ops.start',
  stop: 'ops.stop',
  restart: 'ops.restart',
  autostart: 'ops.autostart'
}

/** 返回动作后的 OpsState;用户取消(提权/询问被否)返回 null */
export async function runAgentIntent(agent: Agent, action: AgentIntent): Promise<OpsState | null> {
  const next = await dispatch(agent, action)
  // 列表刷新不阻塞调用方:动作结果(OpsState)由 main 直接返回,UI 据此立即翻面。
  // 整表刷新要重扫目录 + launchctl 表 + ps(约 0.5-1s),等它会让按钮看起来「点了没反应」。
  if (next) {
    void useAgentsStore.getState().load()
    // 开机自启只改覆盖位,不碰进程。启动/停止/重启都要等到这一条的状态稳住:
    // kickstart 之后常有几秒「已载入、还没 pid」。不 await,按钮先按返回的 OpsState 翻面。
    if (action === 'start' || action === 'restart' || action === 'stop') void refreshUntilSettled(agent.id, action)
  }
  return next
}

/**
 * launchd 拉起是异步的(`kickstart -k` 先杀后起;实测刚启动过的任务有 ~3s 的
 * 「已载入未运行」窗口)。非阻塞地轮询整表,直到这一条进入目标状态(最多 ~6s)。
 * 启动/重启等到运行中;停止等到不再运行。到点就停,不一直刷。
 */
async function refreshUntilSettled(id: string, action: 'start' | 'stop' | 'restart', maxMs = 6000): Promise<void> {
  const deadline = Date.now() + maxMs
  const settled = (status: string | undefined): boolean =>
    action === 'stop' ? status !== 'running' : status === 'running'
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 700))
    await useAgentsStore.getState().load()
    if (settled(useAgentsStore.getState().agents.find((a) => a.id === id)?.status)) return
  }
}

async function dispatch(agent: Agent, action: AgentIntent): Promise<OpsState | null> {
  const tr = makeT(getCurrentLang())
  const label = agent.label
  try {
    // 联动询问:停止一个「开机自启」的任务时,它下次登录仍会回来——唯一的真正矛盾决定
    // Homebrew 的停止走 brew services:它自己删掉 LaunchAgents 副本,和开机自启不是同一件事。
    if (action === 'stop' && agent.isBrew) {
      if (!(await elevate(agent, tr(LABEL_KEY[action])))) return null
      const next = await dataSource().agents.ops(agent.id, 'stop')
      showToast(tr('ops.toast.stopped').replace('{L}', label), '#60a5fa', 'fa-stop')
      return next
    }
    if (action === 'stop' && !agent.isDisabledByOverride) {
      const pick = await CHOICE.request({
        header: tr('ops.stopConfirm.header'),
        title: tr('ops.stopConfirm.title'),
        options: [
          { label: tr('ops.stopConfirm.only'), value: 'only' },
          { label: tr('ops.stopConfirm.andAutostart'), value: 'andAutostart' }
        ]
      })
      if (pick === null) return null
      if (!(await elevate(agent, tr(LABEL_KEY[action])))) return null
      let next = await dataSource().agents.ops(agent.id, 'stop')
      if (pick === 'andAutostart') next = await dataSource().agents.ops(agent.id, 'disable')
      showToast(tr('ops.toast.stopped').replace('{L}', label), '#60a5fa', 'fa-stop')
      return next
    }
    const wasEnabled = !agent.isDisabledByOverride
    if (action === 'start' && !wasEnabled) {
      // launchd 硬约束:disable 阻塞 bootstrap → macOS 上不存在「仅本次启动」。
      // 不把这个副作用藏在 start 内部:先让用户明确选择(取消则不动作)。
      const pick = await CHOICE.request({
        header: tr('ops.startDisabled.header'),
        title: tr('ops.startDisabled.title'),
        options: [
          { label: tr('ops.startDisabled.enableAndStart'), value: 'go' },
          { label: tr('ops.startDisabled.cancel'), value: 'cancel' }
        ]
      })
      if (pick !== 'go') return null
    }
    if (!(await elevate(agent, tr(LABEL_KEY[action])))) return null
    if (action === 'start') {
      const next = await dataSource().agents.ops(agent.id, 'start')
      showToast(tr('ops.toast.started').replace('{L}', label), '#4ade80', 'fa-play')
      // 启动会连带开启开机自启(launchd:disable 阻塞 bootstrap)→ 明示该副作用
      if (!wasEnabled) showToast(tr('ops.toast.autostartByStart'), '#fbbf24', 'fa-circle-check')
      return next
    }
    if (action === 'restart') {
      const next = await dataSource().agents.ops(agent.id, 'restart')
      showToast(tr('ops.toast.restarted').replace('{L}', label), '#a78bfa', 'fa-rotate-right')
      return next
    }
    // 开机自启开关:只改覆盖位,不动当前运行状态
    const next = await dataSource().agents.ops(agent.id, wasEnabled ? 'disable' : 'enable')
    showToast(tr(next.enabled ? 'ops.toast.autostartOn' : 'ops.toast.autostartOff'), next.enabled ? '#4ade80' : '#fbbf24', 'fa-circle-check')
    return next
  } catch (err) {
    cronErrorToast(err, tr)
    return null
  }
}

async function elevate(agent: Agent, actionName: string): Promise<boolean> {
  // 只有 daemon(system 域)必然提权;user/system 都落在用户自己的 gui 域,main 侧会先试无提权执行,
  // 仅当系统拒绝才升级 —— 那种情况由系统密码框直接接管,不再多弹一层应用说明框(见 launchctl-service)
  if (agent.scope !== 'daemon') return true
  const tr = makeT(getCurrentLang())
  return ELEVATION.request({
    detail: tr('elev.ops.detail').replace('{A}', actionName).replace('{L}', agent.label),
    command: `launchctl <domain>/${agent.label}`
  })
}
