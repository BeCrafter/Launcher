// 状态栏构建器(demo config.js MODULES[*].statusbar 逐条对应;数据经参数注入)
import type { StatusBarModel } from './modules'
import type { Agent, CronJob, PortService } from '@shared/models'

type T = (k: string) => string
type FmtFn = (tpl: string, vars: Record<string, string | number>) => string

export function agentsStatusBar(
  d: { agents: Agent[] },
  t: T,
  fmtFn: FmtFn
): StatusBarModel {
  const total = d.agents.length
  const running = d.agents.filter((a) => a.status === 'running').length
  const loaded = d.agents.filter((a) => a.status === 'loaded').length
  const unloaded = d.agents.filter((a) => a.status === 'stopped').length
  return {
    summaryIcon: 'fa-layer-group',
    summaryHtml: fmtFn(t('statusbar.agentsSummary'), { N: total }),
    items: [
      { dot: 'running', textHtml: fmtFn(t('statusbar.agentsRunning'), { N: running }) },
      { dot: 'loaded', textHtml: fmtFn(t('statusbar.agentsLoaded'), { N: loaded }) },
      { dot: 'unloaded', textHtml: fmtFn(t('statusbar.agentsUnloaded'), { N: unloaded }) }
    ],
    pathIcon: 'fa-solid fa-folder',
    path: '~/Library/LaunchAgents',
    monitor: t('statusbar.watching')
  }
}

export function crontabStatusBar(
  d: { crons: CronJob[] },
  t: T,
  fmtFn: FmtFn
): StatusBarModel {
  const crons = d.crons
  return {
    summaryIcon: 'fa-clock',
    summaryHtml: fmtFn(t('statusbar.cronSummary'), { N: crons.length }),
    items: [
      {
        dot: 'running',
        textHtml: fmtFn(t('statusbar.cronEnabled'), { N: crons.filter((j) => j.enabled).length })
      },
      {
        dot: 'loaded',
        textHtml: fmtFn(t('statusbar.cronUser'), { N: crons.filter((j) => !j.system).length })
      },
      {
        dot: 'unloaded',
        textHtml: fmtFn(t('statusbar.cronSystem'), { N: crons.filter((j) => j.system).length })
      }
    ],
    pathIcon: 'fa-solid fa-terminal',
    path: 'crontab -l / /etc/crontab',
    monitor: t('statusbar.schedulerReady')
  }
}

export function servicesStatusBar(
  d: { services: PortService[]; error?: string | null },
  t: T,
  fmtFn: FmtFn
): StatusBarModel {
  const services = d.services
  return {
    summaryIcon: 'fa-network-wired',
    summaryHtml: fmtFn(t('statusbar.svcSummary'), { N: services.length }),
    items: [
      { dot: 'running', textHtml: fmtFn(t('statusbar.svcListening'), { N: services.length }) },
      { dot: 'loaded', textHtml: fmtFn(t('statusbar.svcTcp'), { N: services.length }) },
      { dot: 'unloaded', textHtml: fmtFn(t('statusbar.svcAbnormal'), { N: 0 }) }
    ],
    pathIcon: 'fa-solid fa-magnifying-glass',
    path: 'lsof -iTCP -sTCP:LISTEN',
    // 扫描失败时如实替换(数字此时是上次成功的结果,再写「每 3 秒扫描」就是谎报)
    monitor: d.error ? t('statusbar.svcScanFailed') : t('statusbar.scanEvery3s')
  }
}

// AI 模块状态栏(demo config.js MODULES.ai.statusbar;引擎行跟随配置,未配置时如实说未配置)
//
// ⚠ 摘要**不再重复「供应商 · 模型」** —— 那个信息由输入区上方的引擎 chip 承担(而且可点击跳配置),
// 状态栏再说一遍纯属冗余。这里只留一行子系统状态。
export function aiStatusBar(
  d: { ready: boolean; skills: number; calls: number },
  t: T,
  fmtFn: FmtFn
): StatusBarModel {
  return {
    summaryIcon: 'fa-wand-magic-sparkles',
    summaryHtml: d.ready ? t('ai.sb.engine') : t('ai.sb.engineOff'),
    items: [
      { dot: 'running', textHtml: t('ai.sb.tools') },
      { dot: 'loaded', textHtml: t('ai.sb.wtools') },
      { dot: 'loaded', textHtml: fmtFn(t('ai.sb.skills'), { N: d.skills }) },
      { dot: 'unloaded', textHtml: fmtFn(t('ai.sb.calls'), { N: d.calls }) }
    ],
    pathIcon: 'fa-solid fa-plug',
    path: t('ai.sb.path'),
    monitor: t('ai.sb.monitor')
  }
}
