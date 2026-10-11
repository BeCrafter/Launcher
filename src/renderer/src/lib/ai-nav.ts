// 从别处把内容挂到 AI 助手的输入框上。
//
// 与 notes-nav.ts 的分工:那个是「关联 chip → 跳到对应模块」,这个是「把一段内容交给 AI」。
//
// 为什么要走 ai-store 的待领队列:切模块会卸载 AI 视图(ViewHost 条件渲染),
// 此刻 composer 还不存在,没有别的地方能接住这个引用。

import type { AiMention } from '@shared/ai'
import { useAiStore } from '../state/ai-store'
import { useUiStore } from '../state/ui-store'

/**
 * 把一篇笔记挂到 AI 输入框上(整篇,或选中的那一段)。
 *
 * ⚠ 调用前**必须**先 `flush()` 笔记草稿:正文是 main 在发送时现读盘上的,
 * 草稿还在防抖窗口里的话,模型拿到的是上一版 —— 而用户看到的明明是刚改过的。
 */
export function referenceNoteInAi(note: { id: string; title: string }, quote?: string): void {
  const sel = quote !== undefined && quote.trim() !== ''
  const mention: AiMention = {
    // 整篇与片段是两个 key:同一篇笔记可以「整篇引一次 + 再引其中一段」
    key: sel ? `note:${note.id}#sel` : `note:${note.id}`,
    type: 'note',
    id: note.id,
    label: note.title,
    ...(sel ? { quote } : {})
  }
  useAiStore.getState().attachMentions([mention])
  useUiStore.getState().switchModule('ai')
}
