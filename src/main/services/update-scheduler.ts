// 自动检查更新的调度器:启动后查一次,之后每 10 分钟一次。
//
// 只做「调用 check」这一件事:状态机、下载、安装全在 UpdateController 里,
// 这里不持有任何更新自己的状态(phase 现读,设置开关现读)。
//
// 三条取舍:
//   · 只在 idle / upToDate 时发起。available 时再查会把状态机从「等用户点下载」
//     打回 checking 再重建,targetVersion 也跟着重算;checking/downloading/ready
//     等相位本来就不该被打断,直接跳过。
//   · error 不自动重试:error 是用户可见的失败(下载/校验/助手启动),每 10 分钟重试
//     会把 error 的日志路径与原因冲掉、界面反复闪;网络抖动在 auto 模式下不会落 error
//     (controller 会还原原相位),所以下一个 tick 本来就会再试一次。
//   · 定时器 unref:不因为这个后台活拦住进程退出;退出时仍有 stop() 兜底。

import type { UpdatePhase } from '../../shared/ipc'

const DEFAULT_FIRST_DELAY_MS = 15_000
const DEFAULT_INTERVAL_MS = 10 * 60 * 1000
/** 这些相位里发起检查是安全的:没有进行中的下载/待重启 */
const CHECKABLE: ReadonlySet<UpdatePhase> = new Set<UpdatePhase>(['idle', 'upToDate'])

export interface UpdateSchedulerDeps {
  check: (opts: { auto: true }) => Promise<unknown>
  getPhase: () => UpdatePhase
  /** 设置里的「自动检查更新」开关;每个 tick 现读 */
  getAutoEnabled: () => boolean
  firstDelayMs?: number
  intervalMs?: number
  log?: (msg: string) => void
}

export interface UpdateScheduler {
  start(): void
  stop(): void
}

export function createUpdateScheduler(deps: UpdateSchedulerDeps): UpdateScheduler {
  const log = deps.log ?? ((): void => {})
  const firstDelayMs = deps.firstDelayMs ?? DEFAULT_FIRST_DELAY_MS
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS
  let firstTimer: ReturnType<typeof setTimeout> | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let inFlight = false

  function tick(): void {
    if (inFlight) return
    if (!deps.getAutoEnabled()) return
    const phase = deps.getPhase()
    if (!CHECKABLE.has(phase)) return
    inFlight = true
    log(`开始自动检查(phase=${phase})`)
    void deps
      .check({ auto: true })
      .catch((err) => {
        // 控制器在 auto 模式下自己吞网络错误;走到这里说明是意料外的异常
        log(`自动检查异常:${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        inFlight = false
        log(`自动检查结束(phase=${deps.getPhase()})`)
      })
  }

  return {
    start() {
      // 幂等:重复 start 不叠加定时器
      if (firstTimer !== null || timer !== null) return
      firstTimer = setTimeout(() => {
        firstTimer = null
        tick()
        timer = setInterval(tick, intervalMs)
        timer.unref?.()
      }, firstDelayMs)
      firstTimer.unref?.()
    },
    stop() {
      if (firstTimer !== null) {
        clearTimeout(firstTimer)
        firstTimer = null
      }
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }
  }
}
