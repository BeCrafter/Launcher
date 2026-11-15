// 全局更新横幅该显示哪一种形态。
//
// 抽成纯函数是因为判定条件比看起来多:available 只在「自动检查发现新版本、且这条路
// 真能装」(mode !== none)、用户没点过稍后、且不是 unsupported 错误时才弹;
// ready 则是下载校验完成后的既有提示(用户点过「稍后」就不弹)。
// 组件只负责按 kind 渲染,单测直接盯这张真值表。

import type { UpdateMode, UpdatePhase } from '@shared/ipc'

export type UpdateBannerKind = 'none' | 'available' | 'ready'

export interface UpdateBannerInput {
  phase: UpdatePhase | null
  mode: UpdateMode | null
  targetVersion: string | null
  /** 用户对哪个目标版本点过「稍后」;只静音这一个版本 */
  dismissedVersion: string | null
  /** ready 阶段用户点了「稍后」 */
  postponed: boolean
  /** 状态机是否带着错误(例如安装位置不支持) */
  hasError: boolean
}

export function updateBannerKind(input: UpdateBannerInput): UpdateBannerKind {
  if (input.phase === 'ready') return input.postponed ? 'none' : 'ready'
  if (input.phase !== 'available') return 'none'
  // 横幅的唯一动作是「下载」:安装位置不支持应用内升级时不弹,升级命令在设置 › 关于里
  if (input.mode === null || input.mode === 'none' || input.hasError) return 'none'
  const target = input.targetVersion
  if (target === null || target === '') return 'none'
  if (input.dismissedVersion !== null && input.dismissedVersion === target) return 'none'
  return 'available'
}
