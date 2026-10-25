// jsdom 缺口的统一补齐。幂等:每次调用都重新安装,避免 vi.restoreAllMocks() 把
// 上一轮装上的 mock 实现清空后留下一个空壳。
//
// 只补渲染层真正会碰到的能力,不做「全浏览器 API 仿真」:布局、滚动、剪贴板这些
// 在组件测试里只需要「存在且不抛错」,精确行为由使用它的组件测试单独断言。

/** 匹配 media query 的替身:jsdom 不实现 matchMedia,主题跟随逻辑会读它 */
function makeMediaQueryList(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  } as unknown as MediaQueryList
}

class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return []
  }
}

/** 剪贴板替身:普通 async 函数(不是 vi.fn),需要断言时由测试自行 spyOn */
const clipboardStub = {
  writeText: async (_text: string): Promise<void> => undefined,
  readText: async (): Promise<string> => ''
}

export function installDomShims(): void {
  // AiContextMeter 用 onPointerEnter/onPointerLeave;React 会从 pointerover 合成
  // enter/leave,但 user-event / fireEvent 构造事件时需要 PointerEvent 存在。
  if (typeof window.PointerEvent !== 'function') {
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      writable: true,
      value: window.MouseEvent
    })
  }

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => makeMediaQueryList(query)
  })

  for (const key of ['ResizeObserver', 'IntersectionObserver'] as const) {
    Object.defineProperty(window, key, {
      configurable: true,
      writable: true,
      value: ObserverStub
    })
  }

  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = () => undefined
  }
  if (typeof HTMLElement.prototype.scrollTo !== 'function') {
    HTMLElement.prototype.scrollTo = () => undefined
  }
  // jsdom 自带 window.scrollTo,但会打印 "Not implemented" 噪声
  window.scrollTo = (() => undefined) as typeof window.scrollTo

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value: clipboardStub
  })
  if (typeof document.execCommand !== 'function') {
    document.execCommand = (() => true) as typeof document.execCommand
  }

  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = (() => 'blob:test') as typeof URL.createObjectURL
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL
  }

  // Vitest 的 jsdom 默认 pretendToBeVisual: true,这里只防御自定义环境
  if (typeof window.requestAnimationFrame !== 'function') {
    window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 16) as unknown as number) as typeof window.requestAnimationFrame
    window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof window.cancelAnimationFrame
  }

  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
}
