// 块手柄用的图标。几何数据来自 `lib/icon-paths.ts`（由 scripts/gen-icons.mjs 从 Lucide 生成），
// 与底部工具条、块菜单**同一份来源** —— 三处图标因此天然一致。

import { iconNode } from './icon-dom'
import type { IconName } from './icon-paths'
import type { CalloutKind } from './markdown'
import type { TextAlign } from './note-align'
import type { NoteAssetKind } from '@shared/notes'

/** 块类型 → 图标名。标题不走这里 —— 它显示 H1/H2/H3 文本（豆包与飞书都是）。 */
const BLOCK_ICON: Record<string, IconName> = {
  paragraph: 'pilcrow',
  listItem: 'list',
  quote: 'text-quote',
  callout: 'info',
  fence: 'square-code',
  table: 'table',
  details: 'square-chevron-down',
  thematicBreak: 'minus',
  // 围栏的两种特例：它们是图 / 网页嵌入，不是代码 —— 与工具栏那两个按钮同图标
  diagram: 'workflow',
  embed: 'globe'
}

/** 媒体按类型分开：图 / 视频 / 音频 / PDF 各一张，别都当成图片。 */
const MEDIA_ICON: Record<NoteAssetKind, IconName> = {
  image: 'image',
  video: 'file-video',
  audio: 'file-audio',
  pdf: 'file-text',
  // 本地网页（示例里那个）—— 和「网页嵌入」同一张图标
  page: 'globe'
}

/** 六点抓手。整颗胶囊都是拖拽源，这个图标只是「可以拖」的暗示。 */
export function dragIcon(): SVGSVGElement {
  return iconNode('grip-vertical', 14)
}

/** 对齐块的图标按方向区分:左 / 中 / 右各一张,与工具条同源。 */
const ALIGN_ICON: Record<TextAlign, IconName> = {
  left: 'align-left',
  center: 'align-center',
  right: 'align-right'
}

/**
 * 一个块该显示哪张图标。
 *
 * 四处「不能只看 kind」：
 *  · 提示块 —— 它自己是 note / tip / important / warning / caution 五种之一，
 *    手柄要出对应那张，而不是笼统的「引用」图标；
 *  · 媒体 —— 整段只有一个 `![](…)` 时按扩展名分成图 / 视频 / 音频 / PDF
 *    （用的是 shared/notes 那张**唯一**的附件类型表，与预览同一个判据）；
 *  · 对齐块 —— 按 align 方向出左 / 中 / 右对齐图标，而不是默认的段落图标；
 *  · 列表项 —— 任务项 / 有序 / 无序各一张图标，否则三种列表在左侧手柄上长得一样。
 */
export function blockIconName(block: {
  kind: string
  callout?: CalloutKind
  media?: NoteAssetKind
  align?: TextAlign
  ordered?: boolean
  task?: boolean
}): IconName {
  if (block.kind === 'callout') return CALLOUT_ICON_NAMES[block.callout ?? 'note']
  if (block.kind === 'media') return MEDIA_ICON[block.media ?? 'image']
  if (block.kind === 'align') return ALIGN_ICON[block.align ?? 'left']
  // 任务图标优先:有序任务(`1. [ ]`)也是任务,先认出勾选框
  if (block.kind === 'listItem') {
    if (block.task === true) return 'square-check-big'
    return block.ordered === true ? 'list-ordered' : 'list'
  }
  return BLOCK_ICON[block.kind] ?? 'pilcrow'
}

export function blockIcon(block: {
  kind: string
  callout?: CalloutKind
  media?: NoteAssetKind
  align?: TextAlign
  ordered?: boolean
  task?: boolean
}): SVGSVGElement {
  return iconNode(blockIconName(block), 14)
}

/**
 * 提示块五种类型在**编辑器 UI**（块菜单）里的图标。
 * ⚠ 预览区那一套仍是 FontAwesome（`lib/markdown.tsx` 的 `CALLOUT_ICON`）—— 两边故意分开：
 * 预览不在本轮范围内，动它要同步改一个测试断言。
 */
export const CALLOUT_ICON_NAMES: Record<CalloutKind, IconName> = {
  note: 'info',
  tip: 'lightbulb',
  important: 'circle-alert',
  warning: 'triangle-alert',
  caution: 'flame'
}

/** 空行上的「插入」按钮用。 */
export function plusIcon(): SVGSVGElement {
  return iconNode('plus', 12)
}

/**
 * 折叠三角:收起时朝右、展开时朝下。
 *
 * 用 Lucide 的**细描边**折角 —— 与工具条 / 块菜单同一套笔画语言。
 * (以前是自绘的实心三角:在浅色主题里它比周围所有图标都重,看着突兀。)
 * 两个方向直接用两张图标、不做旋转:根 `<svg>` 上的 transform 属性会推动布局(见 CLAUDE.md)。
 */
export function caretIcon(collapsed: boolean): SVGSVGElement {
  // 16px 铺满按钮:14px 时描边在浅色主题下偏淡,用户反馈「不够明显」
  return iconNode(collapsed ? 'chevron-right' : 'chevron-down', 16)
}

/** 标题的类型标识用文本（豆包与飞书都是这样），不画图标。 */
export function headingText(level: number): string {
  return `H${Math.min(Math.max(level, 1), 6)}`
}
