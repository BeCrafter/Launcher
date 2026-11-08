// 全屏媒体查看器(阅读模式点击图片 / 图表后打开)。
//
// 为什么放 store 而不是各自组件里的本地 state:入口分散在 markdown 预览(事件委托)
// 和 MermaidBlock(正文 / 工具条),真正的展示层只在根部挂一份。payload 不带 DOM 节点,
// svg 用的是 mermaid 已净化的字符串(与 MermaidBlock 注入正文的是同一份)。

import { create } from 'zustand'

export type LightboxItem =
  | { kind: 'image'; src: string; alt?: string }
  | { kind: 'svg'; svg: string; label?: string }

interface LightboxState {
  item: LightboxItem | null
  /** 每次打开自增;作为 <LightboxView> 的 key,让缩放/平移自然回到初值 */
  seq: number
  open(item: LightboxItem): void
  close(): void
}

export const useLightboxStore = create<LightboxState>((set) => ({
  item: null,
  seq: 0,
  open: (item) => set((s) => ({ item, seq: s.seq + 1 })),
  close: () => set({ item: null })
}))
