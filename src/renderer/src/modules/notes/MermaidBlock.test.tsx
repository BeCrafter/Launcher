import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useLightboxStore } from '../../state/lightbox-store'
import { MermaidBlock } from './MermaidBlock'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle r="4" cx="4" cy="4" /></svg>'

vi.mock('../../lib/mermaid-render', () => ({
  renderMermaid: vi.fn(async () => ({ svg: SVG, error: null }))
}))

async function renderReady(): Promise<HTMLElement> {
  const view = render(<MermaidBlock code="graph TD; A-->B" />)
  await waitFor(() => expect(view.container.querySelector('.md-mermaid-canvas')).not.toBeNull())
  return view.container
}

describe('MermaidBlock', () => {
  it('点击正文图表打开共享 lightbox', async () => {
    const container = await renderReady()
    const canvas = container.querySelector('.md-mermaid-canvas') as HTMLElement

    fireEvent.click(canvas)

    expect(useLightboxStore.getState().item).toEqual({
      kind: 'svg',
      svg: SVG,
      label: '图表'
    })
  })

  it('工具条「放大查看」走同一个入口', async () => {
    await renderReady()

    fireEvent.click(screen.getByTitle('放大查看'))

    expect(useLightboxStore.getState().item).toMatchObject({ kind: 'svg', svg: SVG })
  })

  it('复制按钮不触发查看器', async () => {
    await renderReady()

    fireEvent.click(screen.getByTitle('复制源码'))

    expect(useLightboxStore.getState().item).toBeNull()
  })
})
