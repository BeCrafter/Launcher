import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useUnsavedStore } from '../state/unsaved-store'
import { useUnsavedEditor } from './useUnsavedEditor'

function Probe({ dirty }: { dirty: boolean }): null {
  useUnsavedEditor('probe', dirty)
  return null
}

describe('useUnsavedEditor', () => {
  it('按 dirty 注册/注销,卸载时清理', () => {
    const view = render(<Probe dirty />)
    expect(useUnsavedStore.getState().hasUnsaved()).toBe(true)

    view.rerender(<Probe dirty={false} />)
    expect(useUnsavedStore.getState().hasUnsaved()).toBe(false)

    view.rerender(<Probe dirty />)
    expect(useUnsavedStore.getState().hasUnsaved()).toBe(true)
    view.unmount()
    expect(useUnsavedStore.getState().hasUnsaved()).toBe(false)
  })
})
