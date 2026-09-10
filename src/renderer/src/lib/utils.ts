// 通用工具(truncate/copy/openExternal;demo utils.js 对应项)
import { useUiStore } from '../state/ui-store'

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 落到 execCommand 兜底
    }
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
  } catch {
    // 忽略:与 demo fallbackCopy 一致
  }
  ta.remove()
  return true
}

// 外链:经主进程 shell.openExternal(https? 白名单),对齐 demo openExternal 行为
export function openExternal(url: string): void {
  void window.launcher.openExternal(url).catch((err) => console.error('[openExternal]', err))
}

export function showToast(msg: string, color?: string, icon?: string): void {
  useUiStore.getState().showToast(msg, color, icon)
}

export function getTs(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
