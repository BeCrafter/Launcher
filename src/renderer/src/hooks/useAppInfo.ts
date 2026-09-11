// 应用信息(main app:info)模块级缓存:多组件共享一次 IPC 请求,StrictMode 双跑安全
import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/ipc'

let cached: AppInfo | null = null
let pending: Promise<AppInfo> | null = null

function load(): Promise<AppInfo> {
  if (!pending) {
    pending = window.launcher.getAppInfo().catch((err) => {
      pending = null
      throw err
    })
  }
  return pending
}

export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(cached)
  useEffect(() => {
    if (cached) {
      setInfo(cached)
      return
    }
    let alive = true
    void load()
      .then((v) => {
        cached = v
        if (alive) setInfo(v)
      })
      .catch((e) => console.error('[useAppInfo]', e))
    return () => {
      alive = false
    }
  }, [])
  return info
}
