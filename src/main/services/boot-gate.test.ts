// 窗口显示门控的时序:窗口一旦显示,屏幕上必须是「过渡页」或「已画好的应用」——
// 2026-09-23 的首次启动白屏正是「什么都没画就 show 出去」造成的,故这些分支必须钉住。
import { describe, expect, it } from 'vitest'
import { createBootGate, type RevealReason } from './boot-gate'

/** 假时钟:手动触发到期的计时器,能断言「谁被清掉了」 */
function harness(opts: { graceMs?: number; watchdogMs?: number; onWatchdog?: () => void } = {}) {
  const graceMs = opts.graceMs ?? 400
  const watchdogMs = opts.watchdogMs ?? 3000
  const timers: { id: number; fn: () => void; ms: number; cleared: boolean }[] = []
  let nextId = 1
  const revealed: RevealReason[] = []
  const logs: string[] = []
  let watchdogHookCalls = 0
  const gate = createBootGate({
    reveal: (r) => revealed.push(r),
    graceMs,
    watchdogMs,
    onWatchdog: opts.onWatchdog
      ? () => {
          watchdogHookCalls += 1
          opts.onWatchdog?.()
        }
      : undefined,
    setTimer: (fn, ms) => {
      const id = nextId++
      timers.push({ id, fn, ms, cleared: false })
      return id as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer: (t) => {
      const e = timers.find((x) => x.id === (t as unknown as number))
      if (e) e.cleared = true
    },
    log: (m) => logs.push(m)
  })
  /** 触发所有「指定毫秒数且未被清掉」的计时器 */
  const fireMs = (ms: number): void => {
    for (const t of timers.filter((x) => !x.cleared && x.ms === ms)) {
      t.cleared = true
      t.fn()
    }
  }
  const live = (): number[] => timers.filter((t) => !t.cleared).map((t) => t.ms)
  return {
    gate,
    revealed,
    logs,
    fireMs,
    live,
    graceMs,
    watchdogMs,
    watchdogHookCalls: (): number => watchdogHookCalls
  }
}

describe('boot-gate', () => {
  it('应用先画好(热启动)→ 立刻显示,且过渡页宽限期不再生效', () => {
    const h = harness()
    h.gate.appPainted()
    expect(h.revealed).toEqual(['app'])
    expect(h.live()).toEqual([]) // 宽限与看门狗都被清掉
  })

  it('只有过渡页上屏 → 等宽限期再显示(冷启动:先让用户看到「启动中」)', () => {
    const h = harness()
    h.gate.splashPainted()
    expect(h.revealed).toEqual([]) // 宽限期内不许显示
    h.fireMs(h.graceMs)
    expect(h.revealed).toEqual(['grace'])
  })

  it('什么都没等到 → 看门狗兜底显示并留日志(窗口绝不能被永久藏着)', () => {
    const h = harness()
    h.fireMs(h.watchdogMs)
    expect(h.revealed).toEqual(['watchdog'])
    expect(h.logs.join('\n')).toContain('watchdog')
  })

  it('用户在未就绪时唤起(再点一次图标)→ 挂起,等过渡页上屏立刻显示(不吃宽限)', () => {
    const h = harness()
    h.gate.requestReveal()
    expect(h.revealed).toEqual([]) // 关键:不能在这里 show —— 那正是白屏路径
    h.gate.splashPainted()
    expect(h.revealed).toEqual(['request'])
  })

  it('已就绪后唤起 → 立刻显示(isRevealed 让调用方走常规 show)', () => {
    const h = harness()
    h.gate.splashPainted()
    h.fireMs(h.graceMs)
    expect(h.revealed).toEqual(['grace'])
    expect(h.gate.isRevealed()).toBe(true)
    h.gate.requestReveal()
    expect(h.revealed).toEqual(['grace']) // 不重复揭示
  })

  it('揭示只发生一次(splash 之后 appPainted 不再重复)', () => {
    const h = harness()
    h.gate.splashPainted()
    h.fireMs(h.graceMs)
    h.gate.appPainted()
    h.gate.requestReveal()
    h.fireMs(h.watchdogMs)
    expect(h.revealed).toHaveLength(1)
  })

  it('watchdog 到期交给宿主接管(宿主探活后再决定显示)', () => {
    const h = harness({ onWatchdog: () => {} })
    h.fireMs(h.watchdogMs)
    expect(h.watchdogHookCalls()).toBe(1)
    expect(h.revealed).toEqual([]) // 钩子接管后门控自己不显示 —— 由宿主探活后调 revealNow
    h.gate.revealNow('watchdog')
    expect(h.revealed).toEqual(['watchdog'])
  })

  it('fail():加载失败(调用方已换成错误页)时立刻显示,且只显示一次', () => {
    const h = harness()
    expect(h.gate.isRevealed()).toBe(false)
    h.gate.fail()
    expect(h.revealed).toEqual(['fail'])
    expect(h.gate.isRevealed()).toBe(true)
    h.gate.fail()
    h.gate.appPainted()
    expect(h.revealed).toEqual(['fail'])
  })

  it('dispose 幂等(重复调用不炸、不留计时器)', () => {
    const h = harness()
    h.gate.dispose()
    h.gate.dispose()
    expect(h.live()).toEqual([])
    h.fireMs(h.watchdogMs)
    expect(h.revealed).toEqual([])
  })

  it('dispose 之后计时器不再触发(窗口销毁后不留活计时器)', () => {
    const h = harness()
    h.gate.dispose()
    expect(h.live()).toEqual([])
    h.fireMs(h.watchdogMs)
    h.fireMs(h.graceMs)
    expect(h.revealed).toEqual([])
  })
})
