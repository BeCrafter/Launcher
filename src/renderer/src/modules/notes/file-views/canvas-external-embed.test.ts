import { describe, expect, it } from 'vitest'
import { relativeToNotes } from './canvas-external-embed'

describe('relativeToNotes', () => {
  it('笔记目录里的文件返回相对路径', () => {
    expect(relativeToNotes('/notes', '/notes/说明.txt')).toBe('说明.txt')
    expect(relativeToNotes('/notes/', '/notes/图/a b.png')).toBe('图/a b.png')
  })

  it('目录外、根本身和用 .. 逃出去的都不算库内', () => {
    expect(relativeToNotes('/notes', '/elsewhere/说明.txt')).toBeNull()
    expect(relativeToNotes('/notes', '/notes')).toBeNull()
    expect(relativeToNotes('/notes', '/notes-other/说明.txt')).toBeNull()
    expect(relativeToNotes('/notes', '/notes/../说明.txt')).toBeNull()
    expect(relativeToNotes('', '/notes/说明.txt')).toBeNull()
  })
})
