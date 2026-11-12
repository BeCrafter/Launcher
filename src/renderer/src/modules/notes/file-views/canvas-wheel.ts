// Excalidraw 在整块白板容器上挂非 passive 的滚轮监听,用来平移和缩放。
// 容器是嵌入卡片的祖先。监听只要不是 passive,Chromium 就不会让后代的滚动区
// 走合成器线程,PDF 滚动条就一卡一卡。普通滚动并不需要 preventDefault:
// 白板自己是 overflow:hidden,不拦默认行为也不会跟着滚。
// 只有按住 Ctrl / Command(触控板双指也带 ctrlKey)才拦,避免浏览器自己缩放页面。
// passive 不能中途改,所以按下或松开修饰键时换一次监听。

export interface WheelDefaultOptions {
  passive: boolean
}

/** 没按 Ctrl / Command 时必须 passive,这样嵌进去的 PDF 才能走合成器线程。 */
export function wheelListenerOptions(event: {
  ctrlKey: boolean
  metaKey: boolean
}): WheelDefaultOptions {
  return { passive: !(event.ctrlKey || event.metaKey) }
}

export interface WheelHost {
  addEventListener(type: 'wheel', listener: EventListener, options: WheelDefaultOptions): void
  removeEventListener(type: 'wheel', listener: EventListener): void
}

/**
 * 按下或松开 Ctrl / Command 时,按松开后还按着的那个键决定要不要拦截。
 * 别的键不管。没变化就不动。返回现在挂着的选项。
 */
export function bindWheelForModifier(
  host: WheelHost,
  listener: EventListener,
  attached: WheelDefaultOptions | null,
  event: { type: string; key: string; ctrlKey: boolean; metaKey: boolean }
): WheelDefaultOptions | null {
  if (event.key !== 'Control' && event.key !== 'Meta') return attached
  const ctrlKey = event.key === 'Control' ? event.type === 'keydown' : event.ctrlKey
  const metaKey = event.key === 'Meta' ? event.type === 'keydown' : event.metaKey
  const next = wheelListenerOptions({ ctrlKey, metaKey })
  if (attached?.passive === next.passive) return attached
  if (attached !== null) host.removeEventListener('wheel', listener)
  host.addEventListener('wheel', listener, next)
  return next
}

function isExcalidrawRoot(target: EventTarget): target is HTMLElement {
  return target instanceof HTMLElement && target.classList.contains('excalidraw')
}

function isNonPassiveWheel(type: string, options?: boolean | AddEventListenerOptions): boolean {
  if (type !== 'wheel') return false
  if (options === false) return true
  if (options === true || options === undefined) return false
  return options.passive === false
}

/**
 * 包住 addEventListener。白板根节点上那条非 passive 的滚轮监听改成:
 * 平时 passive,按住 Ctrl / Command 时再换成非 passive。其它监听原样。
 * 必须在 Excalidraw 挂监听之前调用。重复调用只包一次。
 */
export function installCanvasWheelPatch(target: Pick<typeof EventTarget, 'prototype'>): void {
  const proto = target.prototype
  if (patched.has(proto)) return
  patched.add(proto)
  const nativeAdd = proto.addEventListener
  const nativeRemove = proto.removeEventListener
  const state = new WeakMap<EventTarget, { listener: EventListener; passive: boolean }>()

  proto.addEventListener = function (type, listener, options) {
    if (typeof listener !== 'function' || !isExcalidrawRoot(this) || !isNonPassiveWheel(type, options)) {
      nativeAdd.call(this, type, listener, options)
      return
    }
    if (state.has(this)) {
      nativeAdd.call(this, type, listener, options)
      return
    }
    const wheelListener = listener
    const host = this
    const tracked: WheelHost = {
      addEventListener(_type, nextListener, nextOptions) {
        nativeRemove.call(host, 'wheel', nextListener)
        nativeAdd.call(host, 'wheel', nextListener, nextOptions)
      },
      removeEventListener(_type, nextListener) {
        nativeRemove.call(host, 'wheel', nextListener)
      }
    }
    const sync = (event: Event): void => {
      if (!(event instanceof KeyboardEvent)) return
      const current = state.get(host)
      if (current === undefined) return
      const next = bindWheelForModifier(tracked, wheelListener, { passive: current.passive }, event)
      if (next !== null) state.set(host, { listener: wheelListener, passive: next.passive })
    }
    state.set(host, { listener: wheelListener, passive: true })
    nativeAdd.call(host, 'wheel', wheelListener, { passive: true })
    // 修饰键在白板外面也会松开。用 window 自己的方法挂:
    // jsdom 里 window 不是 HTMLElement 这条 EventTarget 的实例,不能拿这里的原方法去调它。
    const view = host.ownerDocument.defaultView
    view?.addEventListener('keydown', sync)
    view?.addEventListener('keyup', sync)
  }
}

const patched = new WeakSet<object>()

if (typeof window !== 'undefined') {
  installCanvasWheelPatch(EventTarget)
}
