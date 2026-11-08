// 悬停行 / 列手柄时的高亮框必须**压在表格线上**。
//
// 表格的 collapsed border 以格线为中心画 ±半个线宽,而 guides 量回来的是格子边。
// 框若直接按格子边画 1px 边框,边框就落在格子内侧:1px 表格差半像素,2px/3px 表格
// 会露出半条灰线(用户报过「手柄的框和表格的边框对不齐」)。所以框的盒要在内缘外扩
// 半个线宽、边框宽度跟表格线一致。
//
// jsdom 没有布局,guides 全是 0 —— 这里锁的是表达式本身:半线宽的位移与整条线宽的
// 尺寸。真实像素对齐由隔离 profile 的端到端测量兜底。

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

const SRC = '| a | b |\n|---|---|\n| 1 | 2 |'

function renderTable(): HTMLElement {
  const { container } = render(
    <>{renderMarkdown(SRC, 't', { extended: true, body: SRC, onEditTable: () => {} })}</>
  )
  return container
}

const frameOf = (container: HTMLElement): HTMLElement =>
  container.querySelector('.md-table-hover-frame') as HTMLElement

describe('表格行 / 列高亮框的线宽对齐', () => {
  it('行:上移半个线宽、高度加一条线宽,左右仍贴表格外框', () => {
    const container = renderTable()
    const handles = container.querySelectorAll('.md-table-row-handle')
    // 第一把是表头上那把锁(不可操作),第二把才是第一行数据
    expect(handles).toHaveLength(2)
    fireEvent.pointerOver(handles[1]!)

    const frame = frameOf(container)
    expect(frame).not.toBeNull()
    expect(frame.style.top).toContain('var(--md-table-line, 1px) / 2')
    expect(frame.style.top).toContain('var(--md-table-col-gutter, 20px)')
    expect(frame.style.height).toContain('+ var(--md-table-line, 1px))')
    // jsdom 里 guides.w = 0;真实宽度由端到端测量确认
    expect(frame.style.left).toBe('0px')
    expect(frame.style.width).toBe('0px')
  })

  it('列:贴表格左缘的一侧不外扩,右缘外扩半个线宽', () => {
    const container = renderTable()
    const handles = container.querySelectorAll('.md-table-col-handle')
    expect(handles).toHaveLength(2)

    fireEvent.pointerOver(handles[0]!)
    const first = frameOf(container)
    expect(first.style.left).toBe('0px')
    expect(first.style.width).toContain('var(--md-table-line, 1px) / 2')
    expect(first.style.height).toBe('0px')

    fireEvent.pointerOut(handles[0]!)
    fireEvent.pointerOver(handles[1]!)
    const second = frameOf(container)
    // 内缘:左移半个线宽,宽度加一条线宽 —— 两条边都压住列线
    expect(second.style.left).toContain('- var(--md-table-line, 1px) / 2')
    expect(second.style.width).toContain('+ var(--md-table-line, 1px))')
  })
})
