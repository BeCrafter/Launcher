// main 侧业务错误的上浮:Electron invoke 的 rejection 形如
// "Error invoking remote method 'agents:save': Error: <正文>",而 cronErrorToast 会把一切
// 非提权错误折成通用文案 —— 表单守卫/同名冲突这类可读原因需要原样露给用户(先例见 migration-map 差异 37)。
import { ELEVATION_CANCELLED, ELEVATION_FAILED } from '@shared/ipc'
import { showToast } from './utils'

const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*/
const ERR_PREFIX = /^Error:\s*/

export function cleanIpcErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(IPC_PREFIX, '').replace(ERR_PREFIX, '').trim()
}

/** 抽屉保存/删除/克隆专用:提权取消/失败沿用标准文案,其余错误原文上浮(截断防长文撑爆 toast) */
export function agentErrorToast(err: unknown, tr: (k: string) => string): void {
  const msg = cleanIpcErrorMessage(err)
  if (msg.includes(ELEVATION_CANCELLED)) showToast(tr('toast.elevCancelled'), '#8888aa', 'fa-ban')
  else if (msg.includes(ELEVATION_FAILED)) showToast(tr('toast.elevFailed'), '#f87171', 'fa-circle-exclamation')
  else if (msg !== '') showToast(msg.slice(0, 160), '#f87171', 'fa-circle-exclamation')
  else showToast(tr('toast.cronOpFailed'), '#f87171', 'fa-circle-exclamation')
}
