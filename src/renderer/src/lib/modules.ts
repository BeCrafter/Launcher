// 模块注册表(视图显隐/面包屑/顶栏/搜索/状态栏的单一事实来源)
import type { ModuleId } from '../state/ui-store'

export type StatusDotTone = 'running' | 'loaded' | 'unloaded'

export interface StatusBarModel {
  summaryIcon: string
  // 文案来自生成字典,含 <strong> 等 demo 内联标签(demo 走 innerHTML);受信静态内容
  summaryHtml: string
  items: { dot: StatusDotTone; textHtml: string }[]
  pathIcon: string
  path: string
  pathHref?: string
  monitor: string
}

export interface ModuleRecord {
  viewId: string // demo #view-* id 保留(对照用;React 由 module id 直达组件)
  icon: string // FontAwesome class(data 形态保留,icons.test.ts 兜底)
  breadcrumbKey?: string // i18n 键
  searchPlaceholderKey?: string
  showStatusBar: boolean
  /**
   * 不渲染顶栏。笔记页用它:该页的操作(新建、目录)都在 rail 里,顶栏只剩一个面包屑 ——
   * 而侧边栏本来就高亮了当前模块,再占 44px 说一遍是纯浪费,不如整条让给内容。
   */
  hideTopbar?: boolean
}

export const MODULES: Record<ModuleId, ModuleRecord> = {
  agents: {
    viewId: 'view-agents',
    icon: 'fa-rocket',
    breadcrumbKey: 'module.agents',
    searchPlaceholderKey: 'topbar.phAgents',
    showStatusBar: true
  },
  crontab: {
    viewId: 'view-crontab',
    icon: 'fa-clock',
    breadcrumbKey: 'module.crontab',
    searchPlaceholderKey: 'topbar.phCron',
    showStatusBar: true
  },
  services: {
    viewId: 'view-services',
    icon: 'fa-network-wired',
    breadcrumbKey: 'module.services',
    searchPlaceholderKey: 'topbar.phServices',
    showStatusBar: true
  },
  // 笔记页:搜索框在 rail 内(同 AI 页的先例),故**不设** searchPlaceholderKey。
  // 状态栏也不给:笔记目录与篇数放在 rail 底部常驻,比缩在窗口最下一行更好用。
  notes: {
    viewId: 'view-notes',
    icon: 'fa-pen-to-square',
    breadcrumbKey: 'module.notes',
    showStatusBar: false,
    hideTopbar: true
  },
  // AI 对话页:无顶栏搜索(demo MODULES.ai 有意省略 searchPlaceholderKey);操作区仅「接入 MCP」
  ai: {
    viewId: 'view-ai',
    icon: 'fa-wand-magic-sparkles',
    breadcrumbKey: 'ai.module',
    showStatusBar: true
  },
  settings: {
    viewId: 'view-settings',
    icon: 'fa-sliders',
    breadcrumbKey: 'module.settings',
    showStatusBar: true
  }
}

// 侧边栏入口顺序:三个系统域在前,笔记与 AI 两个「工作台」在后(设置页是底部按钮,不在此列)
export const SIDEBAR_MODULES: ModuleId[] = ['agents', 'crontab', 'services', 'notes', 'ai']
