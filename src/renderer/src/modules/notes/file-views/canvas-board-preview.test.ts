import { describe, expect, it } from 'vitest'
import {
  BOARD_PREVIEW_MAX_BYTES,
  BOARD_PREVIEW_MAX_ELEMENTS,
  boardPreviewMode,
  canvasBoardExportAppState,
  canvasBoardPreviewPlan,
  isSelfBoardEmbed
} from './canvas-board-preview'

function scene(elements: unknown[], appState: unknown = {}): string {
  return JSON.stringify({ type: 'excalidraw', version: 2, source: 'e2e', elements, appState, files: {} })
}

const rect = { type: 'rectangle', id: 'r', isDeleted: false }
const deleted = { type: 'rectangle', id: 'd', isDeleted: true }

describe('canvasBoardPreviewPlan', () => {
  it('空文本、空格子是空白板', () => {
    expect(canvasBoardPreviewPlan({ text: '', size: 0 })).toEqual({ kind: 'blank' })
    expect(canvasBoardPreviewPlan({ text: '  \n', size: 3 })).toEqual({ kind: 'blank' })
  })

  it('没有元素或只剩删除元素也是空白板', () => {
    expect(canvasBoardPreviewPlan({ text: scene([]), size: 10 })).toEqual({ kind: 'blank' })
    expect(canvasBoardPreviewPlan({ text: scene([deleted]), size: 10 })).toEqual({ kind: 'blank' })
  })

  it('解不开的文本、旧 JSON Canvas 都不是白板', () => {
    expect(canvasBoardPreviewPlan({ text: '{ 不是 json', size: 20 })).toEqual({ kind: 'invalid' })
    expect(canvasBoardPreviewPlan({ text: '{"nodes":[]}', size: 20 })).toEqual({ kind: 'invalid' })
  })

  it('有活元素就交给导出', () => {
    const plan = canvasBoardPreviewPlan({ text: scene([rect]), size: 60 })
    expect(plan.kind).toBe('ready')
  })

  it('超过大小或元素数上限不做预览', () => {
    expect(
      canvasBoardPreviewPlan({ text: scene([rect]), size: BOARD_PREVIEW_MAX_BYTES + 1 })
    ).toEqual({ kind: 'too-large' })
    const many = Array.from({ length: BOARD_PREVIEW_MAX_ELEMENTS + 1 }, (_, i) => ({
      type: 'rectangle',
      id: `r${i}`,
      isDeleted: false
    }))
    expect(canvasBoardPreviewPlan({ text: scene(many), size: 100 })).toEqual({
      kind: 'too-large'
    })
  })
})

describe('canvasBoardExportAppState', () => {
  it('默认白底、浅色导出', () => {
    expect(canvasBoardExportAppState({}, 'light')).toEqual({
      exportBackground: true,
      exportWithDarkMode: false,
      exportScale: 1,
      viewBackgroundColor: '#ffffff'
    })
    expect(canvasBoardExportAppState(null, 'light').viewBackgroundColor).toBe('#ffffff')
  })

  it('用场景里存的背景色', () => {
    expect(canvasBoardExportAppState({ viewBackgroundColor: '#1e1e1e' }, 'light')).toMatchObject({
      viewBackgroundColor: '#1e1e1e'
    })
    expect(canvasBoardExportAppState({ viewBackgroundColor: '  ' }, 'light').viewBackgroundColor).toBe(
      '#ffffff'
    )
    expect(canvasBoardExportAppState({ viewBackgroundColor: 12 }, 'light').viewBackgroundColor).toBe(
      '#ffffff'
    )
  })

  it('深色主题走导出滤镜,和 Excalidraw 自己的导出同一条路', () => {
    expect(canvasBoardExportAppState({}, 'dark').exportWithDarkMode).toBe(true)
  })
})

describe('isSelfBoardEmbed', () => {
  it('路径相同才算自己', () => {
    expect(isSelfBoardEmbed('画/板.excal', '画/板.excal')).toBe(true)
    expect(isSelfBoardEmbed('画/板.excal', '画/另一块.excal')).toBe(false)
    expect(isSelfBoardEmbed('画/板.excal', null)).toBe(false)
    expect(isSelfBoardEmbed('画/板.excal', '')).toBe(false)
  })
})

describe('boardPreviewMode', () => {
  it('第一层挂只读画布,再往里退回静态 SVG', () => {
    expect(boardPreviewMode(0)).toBe('live')
    expect(boardPreviewMode(1)).toBe('static')
    expect(boardPreviewMode(2)).toBe('static')
  })
})
