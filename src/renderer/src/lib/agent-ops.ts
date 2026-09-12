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
  // main 侧的动作返回后刷新一次;重启另起非阻塞轮询(见 refreshUntilRunning)
  if (next) {
    await useAgentsStore.getState().load()
    if (action === 'restart') void refreshUntilRunning(agent.id)
  }
  return next
}

/**
 * 重启后 launchd 是异步拉起的(`kickstart -k` 先杀后起;实测刚启动过的任务有 ~3s 的
 * 「已载入未运行」窗口,期间 `launchctl print` 甚至报"服务找不到")。
 * 非阻塞地轮询刷新,直到该任务重新变为运行中(最多 ~6s),避免 UI 停在「待运行」。
 * 不用固定延迟:拿到运行中即停,任务起不来也不会一直刷。
 */
async function refreshUntilRunning(id: string, maxMs = 6000): Promise<void> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 700))
    await useAgentsStore.getState().load()
    if (useAgentsStore.getState().agents.find((a) => a.id === id)?.status === 'running') return
  }
}

async function dispatch(agent: Agent, action: AgentIntent): Promise<OpsState | null> {
  const tr = makeT(getCurrentLang())
  const label = agent.label
  try {
    // 联动询问:停止一个「开机自启」的任务时,它下次登录仍会回来——唯一的真正矛盾决定
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
    if (!(await elevate(agent, tr(LABEL_KEY[action])))) return null
    const wasEnabled = !agent.isDisabledByOverride
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
  if (agent.scope === 'user') return true
  const tr = makeT(getCurrentLang())
  return ELEVATION.request({
    detail: tr('elev.ops.detail').replace('{A}', actionName).replace('{L}', agent.label),
    command: `launchctl <domain>/${agent.label}`
  })
}
