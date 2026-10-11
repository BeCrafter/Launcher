// 引用 chip 上的图标:按类型区分。
// 三种引用混在一个输入框里,全用 @ 的话「引的是任务还是笔记」得读文字才知道。

import type { AiMention } from '@shared/ai'

export function mentionIcon(type: AiMention['type']): string {
  if (type === 'note') return 'fa-note-sticky'
  if (type === 'cron') return 'fa-clock'
  return 'fa-rocket'
}
