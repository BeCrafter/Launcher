// 服务「配置」浮层状态(根级浮层;锚点 = 触发按钮矩形)
// ⚠ 浮层必须渲染在根部:.svc-col-card 有 overflow:hidden(views.css:605),卡片内会被裁剪。
//   (.svc-col-card:hover 无 transform,故 position:fixed 本身不受影响 —— 与 agent 菜单不同)
// 另起而非泛化 card-menu-store:此处携带 PortService 快照 —— 合并列表
// [...services, ...containers.map(containerToService)] 算在 ServicesView 内部,根级浮层够不着。
import { create } from 'zustand'
import type { PortService } from '@shared/models'

interface SvcConfigState {
  svc: PortService | null
  x: number
  y: number
  open(svc: PortService, x: number, y: number): void
  close(): void
}

export const useSvcConfigStore = create<SvcConfigState>((set) => ({
  svc: null,
  x: 0,
  y: 0,
  open: (svc, x, y) => set({ svc, x, y }),
  close: () => set({ svc: null })
}))
