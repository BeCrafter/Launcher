// 窗口「什么时候可以显示」的门控(纯状态机,时钟可注入 ⇒ 可单测)
//
// 为什么需要它:窗口一旦 show 出去,屏幕上是渲染层**最后一次画出来的东西**;若那一刻渲染层
// 什么都还没画,用户看到的就是窗口底色 —— 浅色主题下是近白 `#f6f7fb`,即 2026-09-23 报告的
// 「首次安装后第一次启动白屏」。所以「能不能显示」必须由渲染层的真实进度决定,
// 不能靠 `ready-to-show`(它在「文档里什么都没有」的状态下也可能触发),也不能靠任何固定延时。
//
// 输入(全部来自渲染层的真实事件):
//   splashPainted()  渲染层已产出第一帧(过渡页已在屏幕上)
//   appPainted()     应用已 commit(过渡页被摘除) —— 热启动走这条,过渡页一帧都不出现
//   requestReveal()  用户显式唤起(再点图标 / Tray / Dock):已可显示就立刻,否则挂起等信号
//   fail()           加载失败(调用方已换成错误页),立刻显示
// 兜底:建窗起 BOOT_WATCHDOG_MS 内什么都没等到 → 也要显示(窗口绝不能被永久藏着)。
//
// `reveal` 恰好发生一次;`dispose()` 清掉所有计时器。

export type RevealReason = 'app' | 'grace' | 'request' | 'fail' | 'watchdog'

/**
 * 过渡页上屏后额外等的这一小段:让「应用马上就画好」的热启动直接显示应用,
 * 而不是先闪一下过渡页。冷启动时它决定「用户多久能看到『启动中』」,故不宜大。
 */
export const SPLASH_GRACE_MS = 400

/** 兜底:建窗起算,这么久还没就绪就显示当前内容(总比永远不显示强) */
export const BOOT_WATCHDOG_MS = 3000

export interface BootGate {
  /** 渲染层产出第一帧(过渡页可见) */
  splashPainted(): void
  /** 应用首次 commit(过渡页已摘除) */
  appPainted(): void
  /** 用户显式唤起窗口 */
  requestReveal(): void
  /** 加载失败:调用方负责先换成错误页 */
  fail(): void
  /** 是否已经显示过(调用方据此决定走常规 show/focus 还是交给门控) */
  isRevealed(): boolean
  /** 取消所有计时器(窗口销毁时调用) */
  dispose(): void
}

export interface BootGateDeps {
  reveal(reason: RevealReason): void
  graceMs?: number
  watchdogMs?: number
  /** 注入时钟(测试用) */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void
  log?(msg: string): void
}

export function createBootGate(deps: BootGateDeps): BootGate {
  const graceMs = deps.graceMs ?? SPLASH_GRACE_MS
  const watchdogMs = deps.watchdogMs ?? BOOT_WATCHDOG_MS
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t))
  const log = deps.log ?? ((): void => {})

  let revealed = false
  let splashSeen = false
  let userWaiting = false
  let graceTimer: ReturnType<typeof setTimeout> | null = null
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null

  function reveal(reason: RevealReason): void {
    if (revealed) return
    revealed = true
    if (graceTimer) clearTimer(graceTimer)
    if (watchdogTimer) clearTimer(watchdogTimer)
    graceTimer = null
    watchdogTimer = null
    if (reason === 'watchdog') log('watchdog fired: 渲染层未在期限内就绪,按当前内容显示')
    deps.reveal(reason)
  }

  watchdogTimer = setTimer(() => reveal('watchdog'), watchdogMs)

  return {
    splashPainted(): void {
      if (revealed || splashSeen) return
      splashSeen = true
      log('splash painted')
      // 用户已经在等(再点了一次图标)→ 立刻给反馈;否则留一小段宽限给热启动
      if (userWaiting) {
        reveal('request')
        return
      }
      graceTimer = setTimer(() => reveal('grace'), graceMs)
    },

    appPainted(): void {
      if (revealed) return
      log('app painted')
      reveal('app')
    },

    requestReveal(): void {
      if (revealed) return
      userWaiting = true
      if (splashSeen) reveal('request')
      // 还没画任何东西:挂起。绝不在这里 show —— 那正是白屏路径;watchdog 会兜住上限。
    },

    fail(): void {
      reveal('fail')
    },

    isRevealed: () => revealed,

    dispose(): void {
      if (graceTimer) clearTimer(graceTimer)
      if (watchdogTimer) clearTimer(watchdogTimer)
      graceTimer = null
      watchdogTimer = null
    }
  }
}
