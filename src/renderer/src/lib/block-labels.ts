import type { MarkdownBlock } from './markdown-blocks'

/**
 * 块类型名的 i18n key。块菜单标题与拖拽预览卡片共用这一份 ——
 * 列表项有三种形态（任务 / 有序 / 无序），对齐块按方向命名，判断抄两份就会漂。
 */
export function blockTypeLabelKey(block: MarkdownBlock): string {
  if (block.kind === 'align') return `notes.align.${block.align ?? 'left'}`
  if (block.kind === 'listItem') {
    if (block.task === true) return 'notes.blockMenu.type.taskItem'
    if (block.ordered === true) return 'notes.blockMenu.type.orderedItem'
    return 'notes.blockMenu.type.listItem'
  }
  return `notes.blockMenu.type.${block.kind}`
}
