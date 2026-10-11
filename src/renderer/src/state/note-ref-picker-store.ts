// 关联选择器的开合与锚点坐标(数据在 store、组件只读 —— 同 card-menu-store 的模式)。
//
// 为什么必须挂到根级:rail 与编辑区都是 overflow:auto,浮层挂在里面会被裁掉。
// 同 AgentCardMenu 的注释里记着的那条理由。

import { create } from 'zustand'

interface NoteRefPickerState {
  open: boolean
  x: number
  y: number
  openAt(x: number, y: number): void
  close(): void
}

export const useNoteRefPickerStore = create<NoteRefPickerState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  openAt(x, y) {
    set({ open: true, x, y })
  },
  close() {
    set({ open: false })
  }
}))
