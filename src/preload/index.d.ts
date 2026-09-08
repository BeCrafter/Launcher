import type { LauncherApi } from '../shared/api'

declare global {
  interface Window {
    launcher: LauncherApi
  }
}

export {}
