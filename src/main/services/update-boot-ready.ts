// 升级成功判定的门控:必须同时满足
//   ① 启动序已走完(建窗之后的 registry/notes/discovery 等都执行过);
//   ② 渲染层已经进入正常应用树(renderer 上报 BootPaintPhase='ready')。
//
// 只满足①不够:createWindow() 只创建 BrowserWindow,不等待 loadURL;渲染层白屏/preload 缺失
// 时主进程照样活着。'app' 也不能用 —— 引导失败诊断页同样会摘掉过渡页并上报 'app'。
// 只满足②也不够:渲染层首帧可能早于建窗后的副作用初始化完成。
//
// 两件事先后顺序不固定,因此这里只记录状态,两个信号都到齐时触发一次。

export interface UpdateBootReadyGate {
  /** 启动序(建窗后的初始化)已成功走完 */
  startupComplete(): void
  /** 渲染层已进入正常应用树(不是诊断失败页) */
  appReady(): void
}

export function createUpdateBootReady(onReady: () => void): UpdateBootReadyGate {
  let startupDone = false
  let appReady = false
  let fired = false

  const maybeReady = (): void => {
    if (fired || !startupDone || !appReady) return
    fired = true
    onReady()
  }

  return {
    startupComplete(): void {
      startupDone = true
      maybeReady()
    },
    appReady(): void {
      appReady = true
      maybeReady()
    }
  }
}
