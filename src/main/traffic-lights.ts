// 交通灯悬停显隐(仅 macOS)。
//
// 顶部 12px 是窗口拖动带(`-webkit-app-region: drag`),Chromium 把那一块交给系统做
// 非客户区命中测试,渲染层收不到 mousemove / mouseenter —— 所以「要不要露出交通灯」
// 只能在主进程按光标位置判断(见 index.ts 里的轮询)。这里只放可单测的纯判定。
import type { Point, Rectangle } from 'electron'

/** 触发带:12px 拖动带 + 12px 容差,光标进入窗口后这么高以内才显示交通灯 */
export const TRAFFIC_LIGHT_REVEAL_ZONE = 24

/**
 * 光标是否落在窗口顶部的触发带内。
 * 两个参数都是 DIP 坐标:多屏(含负坐标)时窗口 bounds 与 screen 模块一致。
 * 上边界用 `< zone`,所以刚好停在 24px 时不算,避免在边界上抖。
 */
export function shouldRevealTrafficLights(
  cursor: Point,
  bounds: Rectangle,
  zone: number = TRAFFIC_LIGHT_REVEAL_ZONE
): boolean {
  return (
    cursor.x >= bounds.x &&
    cursor.x < bounds.x + bounds.width &&
    cursor.y >= bounds.y &&
    cursor.y < bounds.y + zone
  )
}
