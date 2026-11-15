// 特权 scheme 只能登记一次:第二次 registerSchemesAsPrivileged 会覆盖前一次的清单。
// 这条曾经真的踩到:笔记附件 scheme 先登记、draw.io 再登记,launcher-note 退回普通 scheme,
// 预览/白板里对 text 文件的 fetch 全变成 "Failed to fetch"(图片视频却还能加载,极易漏掉)。

import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ calls: [] as Array<Array<{ scheme: string; privileges: Record<string, unknown> }>> }))

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: (list: Array<{ scheme: string; privileges: Record<string, unknown> }>) => {
      state.calls.push(list)
    },
    handle: () => {}
  }
}))

const { registerPrivilegedSchemes } = await import('./schemes')

describe('registerPrivilegedSchemes', () => {
  it('只调用一次,把两个 scheme 合在同一个清单里', () => {
    state.calls.length = 0
    registerPrivilegedSchemes()
    expect(state.calls).toHaveLength(1)
    expect(state.calls[0].map((entry) => entry.scheme)).toEqual(['launcher-note', 'launcher-drawio'])
  })

  it('两个 scheme 都保留 fetch / CORS / 流式能力', () => {
    state.calls.length = 0
    registerPrivilegedSchemes()
    for (const entry of state.calls[0]) {
      expect(entry.privileges).toMatchObject({
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
        bypassCSP: false
      })
    }
  })
})
