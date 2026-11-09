import { describe, expect, it } from 'vitest'
import { blockTypeLabelKey } from './block-labels'
import type { MarkdownBlock } from './markdown-blocks'

function block(patch: Partial<MarkdownBlock>): MarkdownBlock {
  return {
    id: 0,
    kind: 'paragraph',
    from: 0,
    to: 1,
    contentTo: 1,
    bodyTo: 1,
    level: 0,
    parentId: null,
    movable: true,
    ...patch
  }
}

describe('blockTypeLabelKey', () => {
  it('普通块按 kind 取类型名', () => {
    expect(blockTypeLabelKey(block({ kind: 'paragraph' }))).toBe('notes.blockMenu.type.paragraph')
    expect(blockTypeLabelKey(block({ kind: 'heading', level: 3 }))).toBe('notes.blockMenu.type.heading')
    expect(blockTypeLabelKey(block({ kind: 'table' }))).toBe('notes.blockMenu.type.table')
    expect(blockTypeLabelKey(block({ kind: 'diagram' }))).toBe('notes.blockMenu.type.diagram')
    expect(blockTypeLabelKey(block({ kind: 'fence' }))).toBe('notes.blockMenu.type.fence')
    expect(blockTypeLabelKey(block({ kind: 'callout', callout: 'note' }))).toBe('notes.blockMenu.type.callout')
  })

  it('对齐块按方向命名', () => {
    expect(blockTypeLabelKey(block({ kind: 'align', align: 'left' }))).toBe('notes.align.left')
    expect(blockTypeLabelKey(block({ kind: 'align', align: 'center' }))).toBe('notes.align.center')
    expect(blockTypeLabelKey(block({ kind: 'align', align: 'right' }))).toBe('notes.align.right')
    expect(blockTypeLabelKey(block({ kind: 'align' }))).toBe('notes.align.left')
  })

  it('列表项区分任务 / 有序 / 无序,任务优先', () => {
    expect(blockTypeLabelKey(block({ kind: 'listItem' }))).toBe('notes.blockMenu.type.listItem')
    expect(blockTypeLabelKey(block({ kind: 'listItem', ordered: true }))).toBe(
      'notes.blockMenu.type.orderedItem'
    )
    expect(blockTypeLabelKey(block({ kind: 'listItem', task: true }))).toBe('notes.blockMenu.type.taskItem')
    expect(blockTypeLabelKey(block({ kind: 'listItem', task: true, ordered: true }))).toBe(
      'notes.blockMenu.type.taskItem'
    )
  })
})
