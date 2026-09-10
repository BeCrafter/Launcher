// 模块注册表(demo config.js MODULES 的 React 版;视图显隐/面包屑/顶栏/搜索/状态栏的单一事实来源)
// 字段与 demo 记录一一对应,便于逐项比对(docs/design/demo-react-migration-map.md)
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
  breadcrumb?: string // 直排文本(demo agents 用)
  breadcrumbKey?: string // i18n 键
  searchPlaceholderKey?: string
  showStatusBar: boolean
}

export const MODULES: Record<ModuleId, ModuleRecord> = {
  agents: {
    viewId: 'view-agents',
    icon: 'fa-rocket',
    breadcrumb: 'Launch Agents',
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
  settings: {
    viewId: 'view-settings',
    icon: 'fa-sliders',
    breadcrumbKey: 'module.settings',
    showStatusBar: true
  }
}

// demo 侧边栏入口顺序(4 项;ai 未迁移,不含)
export const SIDEBAR_MODULES: ModuleId[] = ['agents', 'crontab', 'services']
