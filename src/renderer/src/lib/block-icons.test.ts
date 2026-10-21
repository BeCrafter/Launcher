import { describe, expect, it } from 'vitest'
import { blockIconName } from './block-icons'

describe('blockIconName · 列表项', () => {
  it('任务项 / 有序列表 / 无序列表各用一张图标', () => {
    expect(blockIconName({ kind: 'listItem', task: true })).toBe('square-check-big')
    expect(blockIconName({ kind: 'listItem', ordered: true })).toBe('list-ordered')
    expect(blockIconName({ kind: 'listItem' })).toBe('list')
  })

  it('有序任务也算任务 —— 勾选框图标优先', () => {
    expect(blockIconName({ kind: 'listItem', ordered: true, task: true })).toBe('square-check-big')
  })

  it('别的块不受影响', () => {
    expect(blockIconName({ kind: 'paragraph' })).toBe('pilcrow')
    expect(blockIconName({ kind: 'table' })).toBe('table')
  })
})
