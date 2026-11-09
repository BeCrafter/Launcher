import { afterEach, describe, expect, it } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importPathsIntoNotes, resolveNoteFile } from './note-import'

const dirs: string[] = []

function tempDir(prefix = 'launcher-import-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

function sourceTree(): string {
  const src = tempDir()
  write(join(src, 'readme.md'), '# 导入的笔记\n\n正文\n')
  write(join(src, 'data.json'), '{"a":1}')
  write(join(src, 'sub', 'pic.txt'), 'pic')
  write(join(src, '.hidden.txt'), 'hidden')
  mkdirSync(join(src, 'empty'), { recursive: true })
  return src
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('importPathsIntoNotes', () => {
  it('文件与文件夹递归复制,结构、内容、空目录都保留', async () => {
    const notes = tempDir()
    const src = sourceTree()

    const name = src.slice(src.lastIndexOf('/') + 1)
    const out = await importPathsIntoNotes({ dir: notes, target: '', paths: [src] })
    expect(out).toEqual({ ok: true, target: '', files: 3, folders: 3, skipped: 1 })

    expect(readFileSync(join(notes, name, 'readme.md'), 'utf8')).toBe('# 导入的笔记\n\n正文\n')
    expect(readFileSync(join(notes, name, 'sub', 'pic.txt'), 'utf8')).toBe('pic')
    expect(statSync(join(notes, name, 'empty')).isDirectory()).toBe(true)
  })

  it('可以导入到子目录;目标不存在则失败', async () => {
    const notes = tempDir()
    mkdirSync(join(notes, '工作'), { recursive: true })
    const src = tempDir()
    write(join(src, 'a.txt'), 'a')

    const out = await importPathsIntoNotes({ dir: notes, target: '工作', paths: [src] })
    expect(out.ok).toBe(true)
    expect(readFileSync(join(notes, '工作', src.slice(src.lastIndexOf('/') + 1), 'a.txt'), 'utf8')).toBe(
      'a'
    )

    const missing = await importPathsIntoNotes({ dir: notes, target: '不存在', paths: [src] })
    expect(missing).toEqual({ ok: false, message: '目标目录不存在或不可写入' })

    const traversal = await importPathsIntoNotes({ dir: notes, target: '../x', paths: [src] })
    expect(traversal.ok).toBe(false)
  })

  it('顶层重名自动加序号,不覆盖原内容;文件加在扩展名前', async () => {
    const notes = tempDir()
    const src = tempDir()
    mkdirSync(join(src, 'pkg'), { recursive: true })
    write(join(src, 'pkg', 'a.txt'), 'v1')
    write(join(src, 'report.tar.gz'), 'first')

    const paths = [join(src, 'pkg'), join(src, 'report.tar.gz')]
    const once = await importPathsIntoNotes({ dir: notes, target: '', paths })
    expect(once.ok).toBe(true)
    write(join(src, 'pkg', 'a.txt'), 'v2')
    const twice = await importPathsIntoNotes({ dir: notes, target: '', paths })
    expect(twice.ok).toBe(true)

    expect(readFileSync(join(notes, 'pkg', 'a.txt'), 'utf8')).toBe('v1')
    expect(readFileSync(join(notes, 'pkg-2', 'a.txt'), 'utf8')).toBe('v2')
    expect(readFileSync(join(notes, 'report.tar.gz'), 'utf8')).toBe('first')
    expect(readFileSync(join(notes, 'report.tar-2.gz'), 'utf8')).toBe('first')
  })

  it('跳过 dot 项、符号链接、笔记目录内的源、笔记目录的祖先目录', async () => {
    const notes = tempDir()
    const outside = tempDir()
    const inside = join(notes, 'inside.txt')
    write(inside, 'inside')
    write(join(outside, 'ok.txt'), 'ok')
    symlinkSync(join(outside, 'ok.txt'), join(outside, 'link.txt'))

    const out = await importPathsIntoNotes({
      dir: notes,
      target: '',
      paths: [inside, join(outside, 'ok.txt'), join(outside, 'link.txt'), notes]
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // ok.txt 被复制;隐藏的 link.txt 与 inside / notes 本身跳过
    expect(out.files).toBe(1)
    expect(out.skipped).toBe(3)
    expect(readFileSync(join(notes, 'ok.txt'), 'utf8')).toBe('ok')
    expect(readFileSync(inside, 'utf8')).toBe('inside')
  })

  it('超过深度上限的目录整棵跳过,不留下半截目录树', async () => {
    const notes = tempDir()
    const src = tempDir()
    let cursor = src
    for (let i = 0; i < 12; i++) {
      cursor = join(cursor, `d${i}`)
      mkdirSync(cursor, { recursive: true })
    }
    write(join(cursor, 'deep.txt'), 'deep')

    const out = await importPathsIntoNotes({ dir: notes, target: '', paths: [src] })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.skipped).toBeGreaterThan(0)
    expect(out.folders).toBeLessThanOrEqual(8)
  })

  it('非法 / 不存在的源计为跳过,不报整批失败', async () => {
    const notes = tempDir()
    const out = await importPathsIntoNotes({
      dir: notes,
      target: '',
      paths: ['relative/path', '/definitely/not/here']
    })
    expect(out).toEqual({ ok: true, target: '', files: 0, folders: 0, skipped: 2 })
  })
})

describe('resolveNoteFile', () => {
  it('放行笔记目录内的普通文件,拒绝遍历 / 根层 assets / 目录 / 不存在', () => {
    const notes = tempDir()
    write(join(notes, '素材', 'a.txt'), 'a')
    write(join(notes, 'assets', 'pasted.png'), 'x')
    mkdirSync(join(notes, '文件夹'), { recursive: true })

    expect(resolveNoteFile(notes, '素材/a.txt')).toBe(join(notes, '素材', 'a.txt'))
    expect(resolveNoteFile(notes, '../escape.txt')).toBeNull()
    expect(resolveNoteFile(notes, 'assets/pasted.png')).toBeNull()
    expect(resolveNoteFile(notes, '文件夹')).toBeNull()
    expect(resolveNoteFile(notes, 'none.txt')).toBeNull()
  })

  it('拒绝指向目录外的符号链接', () => {
    const notes = tempDir()
    const outside = tempDir()
    write(join(outside, 'secret.txt'), 'secret')
    symlinkSync(join(outside, 'secret.txt'), join(notes, 'link.txt'))

    expect(resolveNoteFile(notes, 'link.txt')).toBeNull()
  })
})
