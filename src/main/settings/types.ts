// 设置副作用模块契约:applier 之间不互相依赖;electron 运行时经 ctx 注入(纯逻辑 applier 可单测)

import type { BrowserWindow } from 'electron'
import type { LauncherSettings } from '../../shared/settings'

// Tray 生命周期唯一持有者(appliers/tray.ts 工厂创建;IPC 角标计数经此注入)
export interface TrayController {
  ensure(visible: boolean): void
  setBadgeCount(count: number): void
  refreshBadge(enabled: boolean): void
  readonly badgeCount: number
}

export interface ApplyCtx {
  logoDir(): string
  getWindow(): BrowserWindow | null
  /**
   * 唤起主窗口(可选):走 main 的显示门控 —— 启动未就绪时不会露出未绘制的窗口底色。
   * 缺省(fsevents 等纯逻辑 applier 的测试上下文)回退到 `getWindow()?.show()`。
   */
  revealWindow?(): void
  tray: TrayController
  watchDirs: string[]
  broadcast(channel: string, payload?: unknown): void
}

export interface SettingsApplier {
  readonly key: string
  apply(s: LauncherSettings, prev: LauncherSettings | null, ctx: ApplyCtx): void
}
