// OS 文件/文件夹 → 笔记目录的批量复制。
//
// 语义只有一条:**原样复制**。这里不解析 Markdown、不写 frontmatter、不改扩展名 ——
// 复制进来的 `.md` 之所以变成笔记,是因为扫描器本来就认 `.md`。
//
// 所有路径都要过两道闸:① 路径段安全(isSafeNoteSegment);② resolve 之后仍在笔记目录内。
// 第二道不是多余的:第一道挡的是 `..`,第二道挡的是符号链接 / 大小写文件系统之类的意外。

import { existsSync, lstatSync, realpathSync } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  realpath
} from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import {
  MAX_FOLDER_DEPTH,
  MAX_IMPORT_DIRS,
  MAX_IMPORT_FILES,
  MAX_IMPORT_ROOTS,
  isSafeNoteId,
  isSafeNoteSegment,
  type NoteImportResult
} from '../../shared/notes'
import { resolveContainedFile } from '../domains/note-file'

export interface NoteImportOptions {
  /** 笔记根目录(绝对路径) */
  dir: string
  /** 目标目录 id;空串 = 根层 */
  target: string
  /** 源绝对路径 */
  paths: string[]
  log?(message: string): void
}

interface Limits {
  roots: number
  files: number
  dirs: number
  depth: number
}

const DEFAULT_LIMITS: Limits = {
  roots: MAX_IMPORT_ROOTS,
  files: MAX_IMPORT_FILES,
  dirs: MAX_IMPORT_DIRS,
  depth: MAX_FOLDER_DEPTH
}

/** p 是否在 root 内(含 root 本身) */
function inside(root: string, p: string): boolean {
  const base = root.endsWith('/') ? root : `${root}/`
  return p === root || p.startsWith(base)
}

/** 目标目录必须是合法 id 且真实存在;否则导入会落进一个用户没看见的位置 */
function targetDirOf(dir: string, target: string): string | null {
  if (target !== '' && !isSafeNoteId(target)) return null
  const root = resolve(dir)
  const abs = target === '' ? root : resolve(root, target)
  if (!inside(root, abs)) return null
  try {
    const st = lstatSync(abs)
    if (!st.isDirectory() || st.isSymbolicLink()) return null
  } catch {
    return null
  }
  return abs
}

/** 目标目录里挑一个未占用的名字:`a.png` → `a-2.png`;目录不带扩展名逻辑 */
function uniqueName(destDir: string, name: string, isDir: boolean): string {
  if (!existsSync(join(destDir, name))) return name
  const ext = isDir ? '' : extname(name)
  const stem = ext === '' ? name : name.slice(0, -ext.length)
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`
    if (!existsSync(join(destDir, candidate))) return candidate
  }
}

/**
 * 给单测/服务共用:把一批 OS 路径复制进笔记目录。
 * 顶层重名自动加序号;任何单项失败都只计入 skipped,不让整批失败。
 */
export async function importPathsIntoNotes(
  opts: NoteImportOptions,
  over: Partial<Limits> = {}
): Promise<NoteImportResult> {
  const limits: Limits = { ...DEFAULT_LIMITS, ...over }
  const root = resolve(opts.dir)
  const target = targetDirOf(root, opts.target)
  if (target === null) return { ok: false, message: '目标目录不存在或不可写入' }
  let rootReal: string
  try {
    // 根目录本身也可能是一个符号链接(设置里填的路径):用真实路径判断内外
    rootReal = realpathSync(root)
  } catch {
    return { ok: false, message: '笔记目录不可用' }
  }
  try {
    if (!inside(rootReal, realpathSync(target))) {
      return { ok: false, message: '目标目录不在笔记目录内' }
    }
  } catch {
    return { ok: false, message: '目标目录不存在或不可写入' }
  }

  const targetDepth = opts.target === '' ? 0 : opts.target.split('/').length
  const maxRelDepth = Math.max(0, limits.depth - targetDepth)

  let files = 0
  let folders = 0
  let skipped = 0

  const paths = opts.paths.filter((p): p is string => typeof p === 'string' && p !== '')
  if (paths.length > limits.roots) skipped += paths.length - limits.roots

  /** level = 当前目录相对目标目录的层级(顶层导入的目录 = 1) */
  async function copyDir(src: string, dest: string, level: number): Promise<void> {
    let entries
    try {
      entries = await readdir(src, { withFileTypes: true })
    } catch (err) {
      skipped++
      opts.log?.(`导入:读取目录失败,跳过 ${src}: ${String(err)}`)
      return
    }
    // 稳定顺序:同名冲突的序号与测试断言都不该随文件系统顺序变
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const name = entry.name
      if (name.startsWith('.') || !isSafeNoteSegment(name)) {
        skipped++
        continue
      }
      const from = join(src, name)
      const to = join(dest, name)
      let st
      try {
        st = await lstat(from)
      } catch (err) {
        skipped++
        opts.log?.(`导入:无法 stat,跳过 ${from}: ${String(err)}`)
        continue
      }
      if (st.isSymbolicLink()) {
        // 不跟随链接:既避免把目录外内容带进来,也避免环
        skipped++
        continue
      }
      if (st.isDirectory()) {
        // 子目录会在 level + 1;超过笔记扫描的深度上限就复制不进去了(复制了也看不见)
        if (level + 1 > maxRelDepth || folders >= limits.dirs) {
          skipped++
          continue
        }
        try {
          await mkdir(to)
        } catch (err) {
          skipped++
          opts.log?.(`导入:创建目录失败,跳过 ${to}: ${String(err)}`)
          continue
        }
        folders++
        await copyDir(from, to, level + 1)
        continue
      }
      if (st.isFile()) {
        if (files >= limits.files) {
          skipped++
          continue
        }
        try {
          await copyFile(from, to)
        } catch (err) {
          skipped++
          opts.log?.(`导入:复制失败,跳过 ${from}: ${String(err)}`)
          continue
        }
        files++
        continue
      }
      skipped++
    }
  }

  const roots = paths.slice(0, limits.roots)
  for (const raw of roots) {
    if (!isAbsolute(raw)) {
      skipped++
      continue
    }
    const src = resolve(raw)
    let st
    try {
      st = await lstat(src)
    } catch {
      skipped++
      continue
    }
    // 源与笔记目录互相包含都不能复制:前者会把自己复制进自己,后者会把笔记目录套进副本
    let srcReal: string
    try {
      srcReal = st.isSymbolicLink() ? src : await realpath(src)
    } catch {
      skipped++
      continue
    }
    if (inside(rootReal, srcReal) || inside(srcReal, rootReal)) {
      skipped++
      continue
    }
    if (st.isSymbolicLink()) {
      skipped++
      continue
    }
    const name = basename(src)
    if (name === '' || !isSafeNoteSegment(name)) {
      skipped++
      continue
    }
    const to = join(target, uniqueName(target, name, st.isDirectory()))
    if (st.isDirectory()) {
      if (folders >= limits.dirs || maxRelDepth < 1) {
        skipped++
        continue
      }
      try {
        await mkdir(to)
      } catch (err) {
        skipped++
        opts.log?.(`导入:创建目录失败,跳过 ${to}: ${String(err)}`)
        continue
      }
      folders++
      await copyDir(src, to, 1)
      continue
    }
    if (st.isFile()) {
      if (files >= limits.files) {
        skipped++
        continue
      }
      try {
        await copyFile(src, to)
      } catch (err) {
        skipped++
        opts.log?.(`导入:复制失败,跳过 ${src}: ${String(err)}`)
        continue
      }
      files++
      continue
    }
    skipped++
  }

  return { ok: true, target: opts.target, files, folders, skipped }
}

/**
 * 列表里的文件相对路径 → 绝对路径。根层 `assets/` 是内部附件目录,
 * 不允许从文件行走这条入口(它有自己的预览协议与更严格的扩展名白名单)。
 *
 * 实现收在 domains/note-file.ts,读写与预览协议共用同一套闸门。
 */
export function resolveNoteFile(dir: string, rel: string): string | null {
  return resolveContainedFile(dir, rel)
}
