import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileIgnore, DEFAULT_SYNC_IGNORE } from './ignore'
import { contentHash, gitBlobSha, scanLocal, type SnapshotFile } from './scan'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'launcher-sync-'))
  dirs.push(root)
  return root
}

describe('scanLocal', () => {
  it('纳入附件与未知扩展名,排除只来自规则,符号链接跳过', () => {
    const root = makeRoot()
    mkdirSync(join(root, 'assets'))
    mkdirSync(join(root, '.obsidian'))
    writeFileSync(join(root, '笔记.md'), 'hello')
    writeFileSync(join(root, 'assets', 'a.png'), Buffer.from([1, 2, 3]))
    writeFileSync(join(root, 'model.glb'), Buffer.from([9]))
    writeFileSync(join(root, '笔记.md.tmp'), 'partial')
    writeFileSync(join(root, '.obsidian', 'x.json'), '{}')
    symlinkSync(join(root, '笔记.md'), join(root, 'link.md'))

    const found = scanLocal(root, compileIgnore(DEFAULT_SYNC_IGNORE), new Map())
    expect([...found.keys()].sort()).toEqual(['assets/a.png', 'model.glb', '笔记.md'])
    expect(found.get('笔记.md')?.hash).toBe(contentHash(Buffer.from('hello')))
  })

  it('大小与 mtime 未变时不重算哈希', () => {
    const root = makeRoot()
    writeFileSync(join(root, 'a.md'), 'v1')
    const first = scanLocal(root, compileIgnore(''), new Map())
    const file = first.get('a.md')!
    let reads = 0
    const previous = new Map<string, SnapshotFile>([
      ['a.md', { etag: 'e', size: file.size, mtimeMs: file.mtimeMs, hash: 'cached' }]
    ])
    const second = scanLocal(root, compileIgnore(''), previous, () => {
      reads += 1
      return Buffer.from('should-not-read')
    })
    expect(reads).toBe(0)
    expect(second.get('a.md')?.hash).toBe('cached')
  })

  it('拷贝后字节与源文件一致,包括 UTF-16', () => {
    const root = makeRoot()
    const bytes = Buffer.from('﻿a\u0000b', 'utf16le')
    writeFileSync(join(root, 'u.txt'), bytes)
    const found = scanLocal(root, compileIgnore(''), new Map())
    expect(found.get('u.txt')?.hash).toBe(contentHash(bytes))
    expect(found.get('u.txt')?.size).toBe(bytes.length)
  })
})

describe('gitBlobSha', () => {
  it('空内容的 blob 头是固定的', () => {
    // git hash-object 对空文件的结果
    expect(gitBlobSha(Buffer.alloc(0))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
  })
})
