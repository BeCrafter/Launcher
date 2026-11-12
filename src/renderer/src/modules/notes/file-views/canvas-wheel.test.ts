import { describe, expect, it } from 'vitest'
import { bindWheelForModifier, wheelListenerOptions, type WheelHost } from './canvas-wheel'

describe('wheelListenerOptions', () => {
  it('普通滚动不拦截,按住 Ctrl 或 Command 才拦截', () => {
    expect(wheelListenerOptions({ ctrlKey: false, metaKey: false })).toEqual({ passive: true })
    expect(wheelListenerOptions({ ctrlKey: true, metaKey: false })).toEqual({ passive: false })
    expect(wheelListenerOptions({ ctrlKey: false, metaKey: true })).toEqual({ passive: false })
  })
})

function host(): WheelHost & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    addEventListener(_type, _listener, options) {
      calls.push(`add:${options.passive}`)
    },
    removeEventListener() {
      calls.push('remove')
    }
  }
}

describe('bindWheelForModifier', () => {
  const listener = (): void => {}

  it('别的键不换监听', () => {
    const node = host()
    const attached = { passive: true }
    expect(
      bindWheelForModifier(node, listener, attached, {
        type: 'keydown',
        key: 'Shift',
        ctrlKey: false,
        metaKey: false
      })
    ).toBe(attached)
    expect(node.calls).toEqual([])
  })

  it('按下 Ctrl 换成非 passive,松开换回 passive', () => {
    const node = host()
    const pressed = bindWheelForModifier(node, listener, { passive: true }, {
      type: 'keydown',
      key: 'Control',
      ctrlKey: true,
      metaKey: false
    })
    expect(pressed).toEqual({ passive: false })
    const released = bindWheelForModifier(node, listener, pressed, {
      type: 'keyup',
      key: 'Control',
      ctrlKey: false,
      metaKey: false
    })
    expect(released).toEqual({ passive: true })
    expect(node.calls).toEqual(['remove', 'add:false', 'remove', 'add:true'])
  })

  it('Command 还按着时,松开 Ctrl 仍然拦截', () => {
    const node = host()
    const held = bindWheelForModifier(node, listener, { passive: false }, {
      type: 'keyup',
      key: 'Control',
      ctrlKey: false,
      metaKey: true
    })
    expect(held).toEqual({ passive: false })
    expect(node.calls).toEqual([])
  })
})
