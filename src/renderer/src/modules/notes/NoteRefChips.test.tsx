import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NoteRef } from '@shared/notes'
import { NoteRefChips } from './NoteRefChips'

// 事故:lsof 对「同一进程同时监听 IPv4 / IPv6」会给两行,而服务身份键不含 addr
// (它要跨重启稳定)—— 两条关联算出同一个 `service:<port>:<程序名>`,React 报
// 「Encountered two children with the same key」,chip 也可能重复 / 被吞掉。

describe('NoteRefChips', () => {
  it('同一服务的 IPv4 / IPv6 两条记录只渲染一个 chip,且没有重复 key 警告', () => {
    const v4: NoteRef = {
      type: 'service',
      key: '33837:cursor helper (plugin)',
      label: 'Cursor Helper',
      detail: '127.0.0.1:33837'
    }
    const v6: NoteRef = {
      type: 'service',
      key: '33837:cursor helper (plugin)',
      label: 'Cursor Helper',
      detail: '[::1]:33837'
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const view = render(<NoteRefChips refs={[v4, v6]} />)

    expect(view.container.querySelectorAll('.note-ref')).toHaveLength(1)
    const logged = error.mock.calls.flat().join(' ')
    expect(logged).not.toContain('same key')
  })
})
