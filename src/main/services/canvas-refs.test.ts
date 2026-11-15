// 白板引用改写的磁盘层:只碰真的改了的白板,坏文件不拖垮别的。

import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { retargetCanvasFiles } from './canvas-refs'

function board(link: string): string {
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    elements: [
      {
        type: 'embeddable',
        id: 'e',
        x: 0,
        y: 0,
        width: 360,
        height: 240,
        link,
        isDeleted: false,
        customData: { launcher: { kind: 'note', id: link.replace(/\.md$/, '') } }
      }
    ],
    appState: {},
    files: {}
  })
}

function makeTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-canvas-refs-'))
  mkdirSync(join(dir, '子目录'), { recursive: true })
  mkdirSync(join(dir, '.trash'), { recursive: true })
  writeFileSync(join(dir, '根.excal'), board('旧.md'))
  writeFileSync(join(dir, '子目录', '深.excalidraw'), board('旧.md'))
  writeFileSync(join(dir, '无关.excal'), board('别的.md'))
  writeFileSync(join(dir, '坏.excal'), '{ 这不是 json')
  writeFileSync(join(dir, '.trash', '旧.excal'), board('旧.md'))
  return dir
}

describe('retargetCanvasFiles', () => {
  it('改写所有引用旧路径的白板,返回相对路径;不碰无关、坏文件和 .trash', () => {
    const dir = makeTree()
    try {
      const out = retargetCanvasFiles({ dir, changes: [{ from: '旧.md', to: '新.md' }] })
      expect(out.errors).toEqual([])
      expect(out.paths.sort()).toEqual(['子目录/深.excalidraw', '根.excal'].sort())
      expect(readFileSync(join(dir, '根.excal'), 'utf8')).toContain('新.md')
      expect(readFileSync(join(dir, '子目录', '深.excalidraw'), 'utf8')).toContain('新.md')
      expect(readFileSync(join(dir, '无关.excal'), 'utf8')).toContain('别的.md')
      expect(readFileSync(join(dir, '坏.excal'), 'utf8')).toBe('{ 这不是 json')
      expect(readFileSync(join(dir, '.trash', '旧.excal'), 'utf8')).toContain('旧.md')
      // tmp + rename 不留残渣
      expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('没有命中时一个文件都不写', () => {
    const dir = makeTree()
    try {
      writeFileSync(join(dir, '根.excal'), board('另一个.md'))
      const out = retargetCanvasFiles({ dir, changes: [{ from: '旧.md', to: '新.md' }] })
      expect(out.paths).toEqual(['子目录/深.excalidraw'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('目录改名按前缀改,别的目录不动', () => {
    const dir = mkdtempSync(join(tmpdir(), 'launcher-canvas-refs-'))
    try {
      const noteBoard = JSON.parse(board('工作/记录.md'))
      noteBoard.elements[0].customData.launcher = { kind: 'note', id: '工作/记录' }
      const other = JSON.parse(board('工作-2/记录.md'))
      other.elements[0].customData.launcher = { kind: 'note', id: '工作-2/记录' }
      writeFileSync(join(dir, 'a.excal'), JSON.stringify(noteBoard))
      writeFileSync(join(dir, 'b.excal'), JSON.stringify(other))
      const out = retargetCanvasFiles({
        dir,
        changes: [{ from: '工作', to: '项目', prefix: true }]
      })
      expect(out.paths).toEqual(['a.excal'])
      expect(readFileSync(join(dir, 'a.excal'), 'utf8')).toContain('项目/记录.md')
      expect(readFileSync(join(dir, 'b.excal'), 'utf8')).toContain('工作-2/记录.md')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
