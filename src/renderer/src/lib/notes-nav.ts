// 笔记关联的跳转:chip → 对应模块并定位到那个实体;反向入口 → 笔记页并按该关联过滤。
//
// 两个环境坑(都在这里集中处理,别在调用点各自踩一遍):
//   · **必须 `behavior: 'instant'`** —— Electron 44 里程序化平滑滚动不工作(同 HelpModal);
//   · **绝不用 `CSS.escape`** —— cron.id 是可能以数字开头的 8 位 hex,CSS.escape 会把它转成
//     `\33 f9a1c07`,而属性选择器 `[id="…"]` 的引号内既不接受也不需要这种转义 → 永远匹配不到。

import type { NoteRef } from '@shared/notes'
import { useAgentsStore } from '../state/agents-store'
import { useCronStore } from '../state/cron-store'
import { useNotesStore } from '../state/notes-store'
import { useServicesStore } from '../state/services-store'
import { useUiStore } from '../state/ui-store'
import { resolveRef, type RefContext, type RefTarget } from './note-refs'

function scrollToId(id: string): void {
  document.querySelector(`[id="${id}"]`)?.scrollIntoView({ behavior: 'instant', block: 'center' })
}

/** 切模块后要等一帧才有 DOM —— rAF 太早(React 19 的提交在微任务之后),给一点余量 */
const AFTER_SWITCH_MS = 60

export function goToTarget(target: RefTarget): void {
  const ui = useUiStore.getState()
  if (target.kind === 'agent') {
    ui.switchModule('agents')
    useAgentsStore.getState().select(target.id)
    setTimeout(() => scrollToId(`rc_${target.id}`), AFTER_SWITCH_MS)
    return
  }
  if (target.kind === 'cron') {
    ui.switchModule('crontab')
    useCronStore.getState().setEditingId(target.id)
    setTimeout(() => scrollToId(`cronPresets_${target.id}`), AFTER_SWITCH_MS)
    return
  }
  ui.switchModule('services')
  // 卡片定位交给 ServicesView 的 effect:它用 cardKey(跨轮询稳定),不是会变的 svc.id
  useServicesStore.getState().setFocusKey(target.cardKey)
}

/** chip 点击:解析 → 跳过去。已失效则什么都不做(调用方会先拦一道) */
export function navigateToRef(ref: NoteRef, ctx: RefContext): void {
  const res = resolveRef(ref, ctx)
  if (res.state === 'stale') return
  goToTarget(res.target)
}

/** 服务侧的「相关笔记 (N)」:切到笔记页并按该关联过滤 */
export function openNotesFor(ref: NoteRef): void {
  useUiStore.getState().switchModule('notes')
  useNotesStore.getState().filterByRef(ref)
}
