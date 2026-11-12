import { describe, expect, it, vi } from 'vitest'
import { installCanvasWheelPatch } from './canvas-wheel'

installCanvasWheelPatch(EventTarget)

describe('installCanvasWheelPatch', () => {
  function root(): HTMLElement {
    const node = document.createElement('div')
    node.className = 'excalidraw'
    return node
  }

  it('白板根节点上的非 passive 滚轮监听改成 passive,别的监听不动', () => {
    const node = root()
    const other = document.createElement('div')
    const wheel = vi.fn()
    const click = vi.fn()
    node.addEventListener('wheel', wheel, { passive: false })
    node.addEventListener('click', click)
    other.addEventListener('wheel', wheel, { passive: false })

    node.dispatchEvent(new WheelEvent('wheel', { cancelable: true, bubbles: true }))
    other.dispatchEvent(new WheelEvent('wheel', { cancelable: true, bubbles: true }))
    expect(wheel).toHaveBeenCalledTimes(2)
    node.dispatchEvent(new MouseEvent('click'))
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('按下 Ctrl 之后滚轮才能 preventDefault,松开之后不行', () => {
    const node = root()
    node.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault()
      },
      { passive: false }
    )
    const plain = new WheelEvent('wheel', { cancelable: true, bubbles: true })
    node.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }))
    const zooming = new WheelEvent('wheel', { cancelable: true, bubbles: true })
    node.dispatchEvent(zooming)
    expect(zooming.defaultPrevented).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }))
    const after = new WheelEvent('wheel', { cancelable: true, bubbles: true })
    node.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })

  it('换过修饰键之后,滚轮回调只走一次', () => {
    const node = root()
    const wheel = vi.fn()
    node.addEventListener('wheel', wheel, { passive: false })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }))
    node.dispatchEvent(new WheelEvent('wheel', { cancelable: true, bubbles: true }))
    expect(wheel).toHaveBeenCalledTimes(1)
  })
})
