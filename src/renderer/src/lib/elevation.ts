// ported-from: docs/demo/js/elevation.js ELEVATION/confirmDangerousAction @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 提权/危险确认 Promise API(demo elevation.js 语义,无密码框)
// 真机落地:osascript with administrator privileges 系统原生授权框,应用不碰密码(refactor-plan 已确认);
// demo 的密码输入框按计划移除 → 本轮模态仅展示 detail/command,「授权」直接 resolve。
// 授权缓存窗口 = settings.authCacheMin(launcher_authCacheMin 语义)。

export interface ElevationRequest {
  detail: string
  command: string
}

let elevationReq: (ElevationRequest & { resolve: (ok: boolean) => void }) | null = null
let elevationListener: ((req: ElevationRequest | null) => void) | null = null
let cachedUntil = 0

function emitElevation(): void {
  elevationListener?.(elevationReq ? { detail: elevationReq.detail, command: elevationReq.command } : null)
}

export const ELEVATION = {
  // 模态组件订阅当前待处理请求
  subscribe(cb: (req: ElevationRequest | null) => void): () => void {
    elevationListener = cb
    return () => {
      elevationListener = null
    }
  },

  // demo 语义:缓存窗口内静默通过;取消 resolve(false) 并可 toast
  request({ detail, command }: ElevationRequest): Promise<boolean> {
    if (Date.now() < cachedUntil) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      elevationReq = { detail, command, resolve }
      emitElevation()
    })
  },

  grant(): void {
    if (!elevationReq) return
    const min = authCacheMinGetter()
    if (min > 0) cachedUntil = Date.now() + min * 60000
    const { resolve } = elevationReq
    elevationReq = null
    emitElevation()
    resolve(true)
  },

  cancel(): void {
    if (!elevationReq) return
    const { resolve } = elevationReq
    elevationReq = null
    emitElevation()
    resolve(false)
  }
}

// ── 危险操作二次确认 ──

let dangerReq: { detail: string; resolve: (ok: boolean) => void } | null = null
let dangerListener: ((req: { detail: string } | null) => void) | null = null

export const confirmDangerous = {
  subscribe(cb: (req: { detail: string } | null) => void): () => void {
    dangerListener = cb
    return () => {
      dangerListener = null
    }
  },

  // demo confirmDangerousAction:launcher_confirmDangerous=false 时自动通过
  request(detail: string): Promise<boolean> {
    if (confirmDangerousGetter() === false) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      dangerReq = { detail, resolve }
      dangerListener?.({ detail })
    })
  },

  confirm(): void {
    if (!dangerReq) return
    const { resolve } = dangerReq
    dangerReq = null
    dangerListener?.(null)
    resolve(true)
  },

  cancel(): void {
    if (!dangerReq) return
    const { resolve } = dangerReq
    dangerReq = null
    dangerListener?.(null)
    resolve(false)
  }
}

// 设置读取器由 bootstrap 注入(避免与 settings store 循环依赖)
let authCacheMinGetter: () => number = () => 5
let confirmDangerousGetter: () => boolean = () => true

export function setAuthCacheMinGetter(getter: () => number): void {
  authCacheMinGetter = getter
}

export function setConfirmDangerousGetter(getter: () => boolean): void {
  confirmDangerousGetter = getter
}
