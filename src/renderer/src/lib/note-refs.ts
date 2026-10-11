// 笔记关联:构造关联条 + 对着实时服务解析它现在指向谁。
//
// 关联能不能用,全看**持久键**选得对不对(见 shared/service-identity.ts 的说明)。
// 但键会失效 —— 用户改了 cron 命令、换了 agent 作用域、进程重启 —— 所以解析要带回退链:
// 一级用持久键精确命中,二级用快照里的特征找回,都找不到才判「已失效」。
// 这样关联是「耐用」的,而不是「脆」的。

import type { Agent, CronJob, DockerContainer, PortService } from '@shared/models'
import type { NoteRef } from '@shared/notes'
import type { ServiceOverride } from '@shared/settings'
import { serviceIdentityKey } from '@shared/service-identity'
import { useAgentsStore } from '../state/agents-store'
import { useCronStore } from '../state/cron-store'
import { useServicesStore } from '../state/services-store'
import { useNotesStore } from '../state/notes-store'
import { useSettingsStore } from '../state/settings-store'
import { cardKey, connectHost, displayName } from './svc-override'

/**
 * 选择器里的空值兜底**必须是模块级同一个引用**。
 *
 * 写成 `useStore((s) => s.x ?? {})` 会在每次取值时新建对象,zustand 的相等判断看到引用变了
 * 就认为快照更新 → setState → 再取值 → 无限循环(React 会以
 * 「Maximum update depth exceeded」报出来)。这条踩过一次,别再写回内联字面量。
 */
export const EMPTY_OVERRIDES: Record<string, ServiceOverride> = {}

// ── 构造 ──

export function refForAgent(a: Agent): NoteRef {
  return {
    type: 'agent',
    key: a.id,
    label: a.label !== '' ? a.label : (a.fileName ?? a.id),
    detail: `scope=${a.scope}`
  }
}

export function refForCron(j: CronJob): NoteRef {
  return {
    type: 'cron',
    key: j.id,
    label: j.desc.trim() !== '' ? j.desc : j.cmd,
    // detail 是重解析依据:cron 的 id 是 (scope, expr, cmd) 的内容哈希,用户改了命令就失配
    detail: `${j.expr} · ${j.cmd}`
  }
}

export function refForService(svc: PortService, o?: ServiceOverride): NoteRef {
  const host = connectHost(svc.addr)
  return {
    type: 'service',
    key: serviceIdentityKey(svc),
    label: displayName(svc, o),
    detail: `${host}:${svc.port}`
  }
}

/** 关联类型的中文名 —— 用户要一眼看出「哪个 type 当中的哪个服务」 */
export function refTypeLabel(type: string, t: (k: string) => string): string {
  if (type === 'agent') return t('notes.ref.type.agent')
  if (type === 'cron') return t('notes.ref.type.cron')
  if (type === 'service') return t('notes.ref.type.service')
  return t('notes.ref.type.unknown')
}

export function refTypeIcon(type: string): string {
  if (type === 'agent') return 'fa-solid fa-rocket'
  if (type === 'cron') return 'fa-regular fa-clock'
  if (type === 'service') return 'fa-solid fa-network-wired'
  return 'fa-regular fa-circle-question'
}

// ── 解析 ──

export interface RefContext {
  agents: Agent[]
  crons: CronJob[]
  services: PortService[]
  containers: DockerContainer[]
  overrides: Record<string, ServiceOverride>
}

export type RefTarget =
  | { kind: 'agent'; id: string }
  | { kind: 'cron'; id: string }
  | { kind: 'service'; cardKey: string }

export type RefResolution =
  | { state: 'ok'; label: string; target: RefTarget }
  /** 靠回退规则命中:关联还能用,但键该更新了 */
  | { state: 'changed'; label: string; target: RefTarget }
  | { state: 'stale'; reason: 'missing' | 'unknown-type' }

export function resolveRef(ref: NoteRef, ctx: RefContext): RefResolution {
  if (ref.type === 'agent') {
    const exact = ctx.agents.find((a) => a.id === ref.key)
    if (exact) {
      return { state: 'ok', label: exact.label || (exact.fileName ?? exact.id), target: { kind: 'agent', id: exact.id } }
    }
    // 二级:作用域变了(id 里带 scope)也按 label 找回
    const byLabel = ctx.agents.filter((a) => a.label !== '' && a.label === ref.label)
    if (byLabel.length === 1) {
      const a = byLabel[0]
      return { state: 'changed', label: a.label, target: { kind: 'agent', id: a.id } }
    }
    return { state: 'stale', reason: 'missing' }
  }

  if (ref.type === 'cron') {
    const exact = ctx.crons.find((j) => j.id === ref.key)
    if (exact) {
      return { state: 'ok', label: exact.desc || exact.cmd, target: { kind: 'cron', id: exact.id } }
    }
    // 二级:从 detail 快照里解析 `expr · cmd` 重新定位(命令改过就靠这一级)
    const [expr, ...rest] = (ref.detail ?? '').split(' · ')
    const cmd = rest.join(' · ')
    if (expr !== undefined && expr.trim() !== '') {
      const hits = ctx.crons.filter((j) => j.expr === expr.trim() && (cmd === '' || j.cmd === cmd))
      if (hits.length === 1) {
        return { state: 'changed', label: hits[0].desc || hits[0].cmd, target: { kind: 'cron', id: hits[0].id } }
      }
    }
    // 三级:按说明/命令子串
    const loose = ctx.crons.filter((j) => (j.desc || j.cmd).includes(ref.label))
    if (loose.length === 1) {
      return { state: 'changed', label: loose[0].desc || loose[0].cmd, target: { kind: 'cron', id: loose[0].id } }
    }
    return { state: 'stale', reason: 'missing' }
  }

  if (ref.type === 'service') {
    const exact = ctx.services.find((s) => serviceIdentityKey(s) === ref.key)
    if (exact) {
      return {
        state: 'ok',
        label: displayName(exact, ctx.overrides[ref.key]),
        target: { kind: 'service', cardKey: cardKey(exact) }
      }
    }
    // 二级:程序名变了(身份键里的 stem 就变了)按端口 + 名字找回。
    // ⚠ 只比对 name / command,**不比对 cmd** —— 命令行里往往还留着旧程序名(如
    // `node server.js`),拿它当依据会把「同端口上换了个程序」误判成同一个服务;
    // 链到错的对象比报「已失效」糟得多。
    const port = Number.parseInt(ref.key.split(':')[0] ?? '', 10)
    if (Number.isInteger(port)) {
      const hits = ctx.services.filter(
        (s) => s.port === port && (ref.label === '' || `${s.name} ${s.command}`.includes(ref.label))
      )
      if (hits.length === 1) {
        const s = hits[0]
        return {
          state: 'changed',
          label: displayName(s, ctx.overrides[serviceIdentityKey(s)]),
          target: { kind: 'service', cardKey: cardKey(s) }
        }
      }
    }
    return { state: 'stale', reason: 'missing' }
  }

  return { state: 'stale', reason: 'unknown-type' }
}

/** 从各域 store 取当前数据拼出解析上下文(渲染层解析:主进程没有更便宜的答案) */
export function useRefContext(): RefContext {
  const agents = useAgentsStore((s) => s.agents)
  const crons = useCronStore((s) => s.crons)
  const services = useServicesStore((s) => s.services)
  const containers = useServicesStore((s) => s.containers)
  const overrides = useSettingsStore((s) => s.settings?.serviceOverrides ?? EMPTY_OVERRIDES)
  return { agents, crons, services, containers, overrides }
}

/** 反查:这个对象被几篇笔记关联着(服务侧卡片菜单显示「相关笔记 (N)」) */
export function useNoteCountForRef(ref: NoteRef): number {
  const notes = useNotesStore((s) => s.notes)
  return notes.filter((n) => n.refs.some((r) => r.type === ref.type && r.key === ref.key)).length
}
