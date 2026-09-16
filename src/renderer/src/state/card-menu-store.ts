// 卡片「更多」菜单状态(根级浮层;锚点 = 触发按钮矩形)
// ⚠ 菜单必须渲染在根部:.agent-col-card 有 overflow:hidden 且 hover 带 transform,
// 卡片内下拉会被裁剪且 fixed 定位错乱(views.css 冻结不可改)
import { create } from 'zustand'

interface CardMenuState {
  agentId: string | null
  x: number
  y: number
  open(agentId: string, x: number, y: number): void
  close(): void
}

export const useCardMenuStore = create<CardMenuState>((set) => ({
  agentId: null,
  x: 0,
  y: 0,
  open: (agentId, x, y) => set({ agentId, x, y }),
  close: () => set({ agentId: null })
}))
