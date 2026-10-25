import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { setTestSettings } from './stores'

/**
 * 先应用测试设置再渲染。仓库没有 Context Provider,所以这里不需要包任何 wrapper;
 * 需要英文/特定主题时用 `renderWithSettings(ui, { language: 'en-US' })`。
 */
export function renderWithSettings(
  ui: ReactElement,
  raw: Record<string, unknown> = {}
): RenderResult {
  setTestSettings(raw)
  return render(ui)
}
