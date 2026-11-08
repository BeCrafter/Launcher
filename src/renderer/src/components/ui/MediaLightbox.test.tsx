import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useLightboxStore } from '../../state/lightbox-store'
import { MediaLightbox } from './MediaLightbox'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" /></svg>'

function openImage(): void {
  act(() => {
    useLightboxStore.getState().open({
      kind: 'image',
      src: 'file:///tmp/architecture.png',
      alt: '架构图'
    })
  })
}

function openSvg(): void {
  act(() => {
    useLightboxStore.getState().open({ kind: 'svg', svg: SVG, label: '流程图' })
  })
}

function scaleOf(container: HTMLElement): string {
  return container.querySelector('.lightbox-scale')?.textContent ?? ''
}

afterEach(() => {
  act(() => {
    useLightboxStore.getState().close()
  })
})

describe('MediaLightbox', () => {
  it('没有内容时不渲染', () => {
    const { container } = render(<MediaLightbox />)
    expect(container.firstChild).toBeNull()
  })

  it('图片:渲染 src / alt,并以 alt 作为对话框名称', () => {
    openImage()
    const { container } = render(<MediaLightbox />)

    const dialog = screen.getByRole('dialog', { name: '架构图' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const img = container.querySelector('img.lightbox-img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('file:///tmp/architecture.png')
    expect(img.getAttribute('alt')).toBe('架构图')
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(container.querySelector('.lightbox-scale')).toHaveTextContent('100%')
  })

  it('图表:注入 mermaid SVG,标题回退到「图表」', () => {
    act(() => {
      useLightboxStore.getState().open({ kind: 'svg', svg: SVG })
    })
    const { container } = render(<MediaLightbox />)

    expect(screen.getByRole('dialog', { name: '图表' })).toBeInTheDocument()
    const svg = container.querySelector('.lightbox-svg svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('viewBox')).toBe('0 0 10 10')
  })

  it('图表缩放走布局尺寸(矢量重绘),容器只平移不拉伸', () => {
    openSvg()
    const { container } = render(<MediaLightbox />)
    const svg = container.querySelector('.lightbox-svg svg') as SVGSVGElement
    const content = container.querySelector('.lightbox-content') as HTMLElement

    // jsdom 没有布局:用 viewBox 兜底,行为仍然确定
    expect(content).toHaveClass('is-vector')
    expect(svg.style.width).toBe('10px')
    expect(svg.style.height).toBe('10px')
    expect(content.style.transform).toBe('translate(0px, 0px)')

    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(svg.style.width).toBe('12.5px')
    expect(svg.style.height).toBe('12.5px')
    expect(svg.style.maxWidth).toBe('none')
    expect(svg.style.maxHeight).toBe('none')
    expect(content.style.transform).toBe('translate(0px, 0px)')

    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(svg.style.width).toBe('15.625px')

    fireEvent.click(screen.getByRole('button', { name: '适应窗口' }))
    expect(svg.style.width).toBe('10px')
    expect(svg.style.height).toBe('10px')
  })

  it('图表滚轮:尺寸随倍数增长,位移仍以光标为锚点', () => {
    openSvg()
    const { container } = render(<MediaLightbox />)
    const dialog = screen.getByRole('dialog')
    const svg = container.querySelector('.lightbox-svg svg') as SVGSVGElement

    act(() => {
      dialog.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -200,
          clientX: 400,
          clientY: 300,
          bubbles: true,
          cancelable: true
        })
      )
    })

    expect(parseFloat(svg.style.width)).toBeGreaterThan(10)
    expect(container.querySelector('.lightbox-content')?.getAttribute('style')).toMatch(/translate\(-/)
  })

  it('没有 viewBox 的 SVG 退回 transform 缩放', () => {
    act(() => {
      useLightboxStore.getState().open({
        kind: 'svg',
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" /></svg>'
      })
    })
    const { container } = render(<MediaLightbox />)
    const content = container.querySelector('.lightbox-content') as HTMLElement
    expect(content).not.toHaveClass('is-vector')

    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(content.style.transform).toBe('translate(0px, 0px) scale(1.25)')
  })

  it('工具条按钮缩放:放大到 125%,再缩回 100%', () => {
    openImage()
    const { container } = render(<MediaLightbox />)

    const zoomOut = screen.getByRole('button', { name: '缩小' })
    expect(zoomOut).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(scaleOf(container)).toBe('125%')
    expect(zoomOut).toBeEnabled()

    fireEvent.click(zoomOut)
    expect(scaleOf(container)).toBe('100%')
    expect(container.querySelector('.lightbox-content')).toHaveStyle({
      transform: 'translate(0px, 0px) scale(1)'
    })
  })

  it('复位按钮把缩放与位移一起清零', () => {
    openImage()
    const { container } = render(<MediaLightbox />)

    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(scaleOf(container)).toBe('156%')

    fireEvent.click(screen.getByRole('button', { name: '适应窗口' }))
    expect(scaleOf(container)).toBe('100%')
    expect(container.querySelector('.lightbox-content')).toHaveStyle({
      transform: 'translate(0px, 0px) scale(1)'
    })
  })

  it('滚轮以光标为锚点放大,并拦下默认滚动', () => {
    openImage()
    const { container } = render(<MediaLightbox />)
    const dialog = screen.getByRole('dialog')

    const wheel = new WheelEvent('wheel', {
      deltaY: -200,
      clientX: 400,
      clientY: 300,
      bubbles: true,
      cancelable: true
    })
    act(() => {
      dialog.dispatchEvent(wheel)
    })

    expect(wheel.defaultPrevented).toBe(true)
    expect(scaleOf(container)).not.toBe('100%')
    // 光标不在舞台中心 → 位移非零(jsdom 全 0 尺寸时不做夹紧)
    expect(container.querySelector('.lightbox-content')?.getAttribute('style')).toMatch(/translate\(-?\d/)
  })

  it('缩小到适应窗口为止,不会退到 100% 以下', () => {
    openImage()
    const { container } = render(<MediaLightbox />)
    const dialog = screen.getByRole('dialog')

    for (let i = 0; i < 4; i += 1) {
      act(() => {
        dialog.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true }))
      })
    }

    expect(scaleOf(container)).toBe('100%')
  })

  it('双击在适应窗口与 250% 之间切换', () => {
    openImage()
    const { container } = render(<MediaLightbox />)
    const stage = container.querySelector('.lightbox-stage') as HTMLElement

    fireEvent.doubleClick(stage)
    expect(scaleOf(container)).toBe('250%')

    fireEvent.doubleClick(stage)
    expect(scaleOf(container)).toBe('100%')
  })

  it('放大后可以拖动平移;未放大时不拦截指针', () => {
    openImage()
    const { container } = render(<MediaLightbox />)
    const stage = container.querySelector('.lightbox-stage') as HTMLElement

    // 1 倍:拖动不生效
    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 180, clientY: 160 })
    fireEvent.pointerUp(stage, { pointerId: 1 })
    expect(container.querySelector('.lightbox-content')).toHaveStyle({
      transform: 'translate(0px, 0px) scale(1)'
    })

    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 160, clientY: 140 })
    fireEvent.pointerUp(stage, { pointerId: 1 })

    expect(container.querySelector('.lightbox-content')).toHaveStyle({
      transform: 'translate(60px, 40px) scale(1.25)'
    })
  })

  it('Esc 关闭,方向和缩放键改变视图', () => {
    openImage()
    const { container } = render(<MediaLightbox />)

    fireEvent.keyDown(window, { key: '+' })
    expect(scaleOf(container)).toBe('125%')
    fireEvent.keyDown(window, { key: '0' })
    expect(scaleOf(container)).toBe('100%')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useLightboxStore.getState().item).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('点背景或关闭按钮都关闭;点内容不关闭', () => {
    openImage()
    const { container, rerender } = render(<MediaLightbox />)

    fireEvent.click(container.querySelector('.lightbox-stage') as HTMLElement)
    expect(useLightboxStore.getState().item).not.toBeNull()

    fireEvent.click(screen.getByRole('dialog'))
    expect(useLightboxStore.getState().item).toBeNull()

    rerender(<MediaLightbox />)
    openImage()
    rerender(<MediaLightbox />)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(useLightboxStore.getState().item).toBeNull()
  })

  it('关闭后把焦点还给打开前的元素', () => {
    const trigger = document.createElement('button')
    trigger.textContent = '打开'
    document.body.appendChild(trigger)
    trigger.focus()

    openImage()
    render(<MediaLightbox />)
    expect(document.activeElement).not.toBe(trigger)

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('每次重新打开都从适应窗口开始', () => {
    openImage()
    const { container } = render(<MediaLightbox />)
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(scaleOf(container)).toBe('125%')

    act(() => {
      useLightboxStore.getState().close()
    })
    openSvg()
    expect(scaleOf(container)).toBe('100%')
  })
})
