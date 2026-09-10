// 一次性应用引导:StrictMode 双跑安全(幂等守卫)
import { initSettingsFromMain } from './settings-store'
import { useAgentsStore } from './agents-store'
import { useCronStore } from './cron-store'
import { useServicesStore } from './services-store'

let booted = false

export function bootstrap(): void {
  if (booted) return
  booted = true
  // 移除「启动中」过渡页(与 index.html #boot-splash 契约)
  document.getElementById('boot-splash')?.remove()
  initSettingsFromMain()
  // 数据模块首屏加载(mock 立即 resolve;失败不阻断外壳)
  void useAgentsStore.getState().load().catch((e) => console.error('[bootstrap] agents', e))
  void useCronStore.getState().load().catch((e) => console.error('[bootstrap] crons', e))
  void useServicesStore.getState().load().catch((e) => console.error('[bootstrap] services', e))
}
