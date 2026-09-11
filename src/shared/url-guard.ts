// 外链 scheme 白名单(main 侧 shell:openExternal 强制执行,防任意 scheme 打开)
// 放行:http(s) 网页 + macOS 系统设置面板(x-apple.systempreferences:com.apple.*)

const SYSTEM_PREFS_PREFIX = 'x-apple.systempreferences:'
const APPLE_PANEL_RE = /^com\.apple\.[\w.-]+$/i

export function isAllowedExternalUrl(url: unknown): boolean {
  if (typeof url !== 'string' || url.length === 0) return false
  if (/^https?:\/\//i.test(url)) return true
  if (url.toLowerCase().startsWith(SYSTEM_PREFS_PREFIX)) {
    return APPLE_PANEL_RE.test(url.slice(SYSTEM_PREFS_PREFIX.length))
  }
  return false
}
