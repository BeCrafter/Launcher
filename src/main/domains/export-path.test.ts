import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextFreePath, safeSuggestedName } from './export-path'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'launcher-export-path-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('nextFreePath', () => {
  it('名字空闲时直接用原名', () => {
    expect(nextFreePath(dir, '笔记.md')).toBe(join(dir, '笔记.md'))
  })

  it('重名时依次加 (1)、(2)', () => {
    writeFileSync(join(dir, '笔记.md'), 'a')
    expect(nextFreePath(dir, '笔记.md')).toBe(join(dir, '笔记 (1).md'))

    writeFileSync(join(dir, '笔记 (1).md'), 'b')
    expect(nextFreePath(dir, '笔记.md')).toBe(join(dir, '笔记 (2).md'))
  })

  it('多段扩展名只拆最后一段', () => {
    writeFileSync(join(dir, 'a.tar.gz'), 'x')
    expect(nextFreePath(dir, 'a.tar.gz')).toBe(join(dir, 'a.tar (1).gz'))
  })

  it('没有扩展名时整名当主体', () => {
    mkdirSync(join(dir, 'makefile'))
    expect(nextFreePath(dir, 'makefile')).toBe(join(dir, 'makefile (1)'))
  })
})

describe('safeSuggestedName', () => {
  it('去掉路径部分', () => {
    expect(safeSuggestedName('/tmp/../../etc/季度总结.md')).toBe('季度总结.md')
  })

  it('空名回退 export', () => {
    expect(safeSuggestedName('')).toBe('export')
    expect(safeSuggestedName('...')).toBe('export')
  })
})
