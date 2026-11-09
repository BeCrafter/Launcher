import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveContainedFile, resolveReadableFile } from './note-file'

const roots: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-note-file-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('resolveContainedFile', () => {
  it('放行目录内的普通文件(含中文目录与空格)', () => {
    const dir = makeDir()
    mkdirSync(join(dir, '素材'), { recursive: true })
    writeFileSync(join(dir, '素材', '我的 图.png'), 'x')
    expect(resolveContainedFile(dir, '素材/我的 图.png')).toBe(join(dir, '素材', '我的 图.png'))
  })

  it('拒绝越界、绝对路径、空串、目录与不存在的文件', () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'a.txt'), 'a')
    mkdirSync(join(dir, 'sub'))
    expect(resolveContainedFile(dir, '../a.txt')).toBeNull()
    expect(resolveContainedFile(dir, '/etc/passwd')).toBeNull()
    expect(resolveContainedFile(dir, '')).toBeNull()
    expect(resolveContainedFile(dir, 'sub')).toBeNull()
    expect(resolveContainedFile(dir, 'none.txt')).toBeNull()
  })

  it('拒绝隐藏路径段', () => {
    const dir = makeDir()
    writeFileSync(join(dir, '.hidden.txt'), 'x')
    expect(resolveContainedFile(dir, '.hidden.txt')).toBeNull()
  })

  it('文件行不放行根层 assets/', () => {
    const dir = makeDir()
    mkdirSync(join(dir, 'assets'), { recursive: true })
    writeFileSync(join(dir, 'assets', 'pasted.png'), 'x')
    expect(resolveContainedFile(dir, 'assets/pasted.png')).toBeNull()
    // 嵌套的同名目录是普通目录
    mkdirSync(join(dir, 'sub', 'assets'), { recursive: true })
    writeFileSync(join(dir, 'sub', 'assets', 'x.png'), 'x')
    expect(resolveContainedFile(dir, 'sub/assets/x.png')).not.toBeNull()
  })

  it('拒绝符号链接文件与指到外部的祖先目录', () => {
    const dir = makeDir()
    const outside = makeDir()
    writeFileSync(join(outside, 'secret.txt'), 's')
    symlinkSync(join(outside, 'secret.txt'), join(dir, 'link.txt'))
    expect(resolveContainedFile(dir, 'link.txt')).toBeNull()

    symlinkSync(outside, join(dir, 'linked-dir'))
    expect(resolveContainedFile(dir, 'linked-dir/secret.txt')).toBeNull()
  })
})

describe('resolveReadableFile', () => {
  it('只读协议允许根层 assets/', () => {
    const dir = makeDir()
    mkdirSync(join(dir, 'assets'), { recursive: true })
    writeFileSync(join(dir, 'assets', 'logo.png'), 'x')
    expect(resolveReadableFile(dir, 'assets/logo.png')).toBe(join(dir, 'assets', 'logo.png'))
  })

  it('其余安全规则不变', () => {
    const dir = makeDir()
    expect(resolveReadableFile(dir, '../x.png')).toBeNull()
    expect(resolveReadableFile(dir, '/etc/passwd')).toBeNull()
  })
})
