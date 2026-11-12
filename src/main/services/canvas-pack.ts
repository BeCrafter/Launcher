// 同步开始前,把白板里还跟原文件的外部嵌入拷进项目。
//
// 只处理 .excal / .excalidraw。原路径还在才拷,不看来源是哪台电脑。
// 第一次用原文件名,重名加 -2。以后的打包覆盖同一个 project,不再出新序号。
// 原文件已经不在就留着上一次的副本,不删。失败只跳过这一个,不让整次同步失败。
// 拷完把 project 写回白板 JSON。调用方在这之后再扫目录,副本才会进本次同步。

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import {
  GLTF_TEXT_MAX,
  gltfSiblingNames,
  readCanvasExternal,
  type CanvasExternalEmbed
} from '../../shared/canvas-external'
import { isSafeNoteId, isSafeNoteSegment, joinNoteId, NOTES_ASSETS_DIR, parentOf } from '../../shared/notes'

export interface CanvasPackOptions {
  /** 笔记根目录 */
  root: string
  /** 单个文件上限。0 = 不限制。超过的跳过并记进 errors。 */
  maxBytes: number
  log?(message: string): void
}

export interface CanvasPackResult {
  /** 这次改过 project 的白板相对路径 */
  updated: string[]
  errors: { path: string; message: string }[]
}

interface SceneElement {
  type?: unknown
  isDeleted?: unknown
  customData?: unknown
}

export function packCanvasEmbeds(opts: CanvasPackOptions): CanvasPackResult {
  const root = resolve(opts.root)
  const updated: string[] = []
  const errors: CanvasPackResult['errors'] = []
  let rootReal: string
  try {
    rootReal = realpathSync(root)
  } catch {
    return { updated, errors }
  }

  for (const rel of findBoards(root)) {
    const abs = join(root, rel)
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch (err) {
      errors.push({ path: rel, message: String(err) })
      continue
    }
    if (text.trim() === '') continue
    let scene: { elements?: SceneElement[] }
    try {
      scene = JSON.parse(text) as { elements?: SceneElement[] }
    } catch {
      continue
    }
    if (!Array.isArray(scene.elements)) continue
    let changed = false
    for (const element of scene.elements) {
      if (element.type !== 'embeddable' || element.isDeleted === true) continue
      const embed = readCanvasExternal(element.customData)
      if (embed === null || embed.source === '') continue
      const packed = packOne(root, rootReal, parentOf(rel), embed, opts, errors, rel)
      if (packed === null || packed === embed.project) continue
      const data = element.customData
      if (data !== null && typeof data === 'object') {
        ;(data as Record<string, unknown>).embed = { ...embed, project: packed }
      }
      changed = true
    }
    if (!changed) continue
    try {
      writeFileSync(abs, JSON.stringify(scene))
      updated.push(rel)
    } catch (err) {
      errors.push({ path: rel, message: String(err) })
    }
  }
  return { updated, errors }
}

function packOne(
  root: string,
  rootReal: string,
  boardParent: string,
  embed: CanvasExternalEmbed,
  opts: CanvasPackOptions,
  errors: CanvasPackResult['errors'],
  board: string
): string | null {
  const source = embed.source
  if (!isAbsolute(source)) return null
  let st
  try {
    st = lstatSync(source)
  } catch {
    return null
  }
  if (st.isSymbolicLink() || !st.isFile()) return null
  if (opts.maxBytes > 0 && st.size > opts.maxBytes) {
    errors.push({ path: board, message: `超过 ${opts.maxBytes} 字节,已跳过` })
    return null
  }
  let sourceReal: string
  try {
    sourceReal = realpathSync(source)
  } catch {
    return null
  }
  // 源已经在笔记目录里。不再复制,已有的 project 保持原样。
  if (inside(rootReal, sourceReal)) return null

  if (embed.project !== '') {
    if (overwriteProject(root, rootReal, embed.project, source)) return null
    errors.push({ path: board, message: `无法覆盖 ${embed.project}` })
    return null
  }

  if (extname(source).toLowerCase() === '.gltf') {
    const bundled = packGltf(root, rootReal, boardParent, source, opts, errors, board)
    if (bundled !== null) return bundled
  }

  const name = basename(source)
  if (!isSafeNoteSegment(name)) {
    errors.push({ path: board, message: `文件名不合法:${name}` })
    return null
  }
  const destDir = boardParent === '' ? root : join(root, boardParent)
  try {
    mkdirSync(destDir, { recursive: true })
  } catch (err) {
    errors.push({ path: board, message: String(err) })
    return null
  }
  const chosen = uniqueName(destDir, name)
  const dest = join(destDir, chosen)
  try {
    copyFileSync(source, dest)
  } catch (err) {
    errors.push({ path: board, message: String(err) })
    return null
  }
  opts.log?.(`白板打包:${source} → ${joinNoteId(boardParent, chosen)}`)
  return joinNoteId(boardParent, chosen)
}

/** 覆盖已有副本。路径必须仍是笔记目录里的普通文件,不能是 assets 或链接。 */
function overwriteProject(root: string, rootReal: string, project: string, source: string): boolean {
  if (!isSafeNoteId(project)) return false
  if (project === NOTES_ASSETS_DIR || project.startsWith(`${NOTES_ASSETS_DIR}/`)) return false
  const dest = resolve(root, project)
  if (!inside(resolve(root), dest)) return false
  try {
    const st = lstatSync(dest)
    if (!st.isFile() || st.isSymbolicLink()) return false
    if (!inside(rootReal, realpathSync(dest))) return false
    copyFileSync(source, dest)
    return true
  } catch {
    return false
  }
}

/**
 * 带同目录引用的 gltf 拷进一个新目录,目录内保持原文件名。
 * 没有外部引用或解不开时返回 null,调用方当普通文件拷一份。
 */
function packGltf(
  root: string,
  rootReal: string,
  boardParent: string,
  source: string,
  opts: CanvasPackOptions,
  errors: CanvasPackResult['errors'],
  board: string
): string | null {
  let text: string
  try {
    const st = lstatSync(source)
    if (st.size > GLTF_TEXT_MAX) return null
    text = readFileSync(source, 'utf8')
  } catch {
    return null
  }
  const siblings = gltfSiblingNames(text)
  if (siblings.length === 0) return null
  const fileName = basename(source)
  const stem = fileName.slice(0, -extname(fileName).length)
  if (!isSafeNoteSegment(stem) || !isSafeNoteSegment(fileName)) {
    errors.push({ path: board, message: `文件名不合法:${fileName}` })
    return null
  }
  const parentAbs = boardParent === '' ? root : join(root, boardParent)
  const dirName = uniqueName(parentAbs, stem)
  const dirAbs = join(parentAbs, dirName)
  try {
    mkdirSync(dirAbs)
    copyFileSync(source, join(dirAbs, fileName))
  } catch (err) {
    errors.push({ path: board, message: String(err) })
    return null
  }
  const fromDir = dirname(source)
  for (const name of siblings) {
    if (!isSafeNoteSegment(name)) continue
    const from = join(fromDir, name)
    try {
      const st = lstatSync(from)
      if (st.isSymbolicLink() || !st.isFile()) continue
      if (opts.maxBytes > 0 && st.size > opts.maxBytes) {
        errors.push({ path: board, message: `超过 ${opts.maxBytes} 字节,已跳过 ${name}` })
        continue
      }
      if (inside(rootReal, realpathSync(from))) continue
      copyFileSync(from, join(dirAbs, name))
    } catch (err) {
      opts.log?.(`白板打包:跳过 ${from}: ${String(err)}`)
    }
  }
  return joinNoteId(joinNoteId(boardParent, dirName), fileName)
}

function findBoards(root: string): string[] {
  const out: string[] = []
  const walk = (rel: string, depth: number): void => {
    if (depth > 8) return
    const abs = rel === '' ? root : join(root, rel)
    let names: string[]
    try {
      names = readNames(abs)
    } catch {
      return
    }
    for (const name of names) {
      if (name.startsWith('.') || !isSafeNoteSegment(name)) continue
      const child = rel === '' ? name : `${rel}/${name}`
      const childAbs = join(root, child)
      let st
      try {
        st = lstatSync(childAbs)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        walk(child, depth + 1)
        continue
      }
      if (!st.isFile()) continue
      const lower = name.toLowerCase()
      if (lower.endsWith('.excal') || lower.endsWith('.excalidraw')) out.push(child)
    }
  }
  walk('', 0)
  return out
}

function readNames(dir: string): string[] {
  return readdirSync(dir)
}

function uniqueName(destDir: string, name: string): string {
  if (!existsSync(join(destDir, name))) return name
  const ext = extname(name)
  const stem = ext === '' ? name : name.slice(0, -ext.length)
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`
    if (!existsSync(join(destDir, candidate))) return candidate
  }
}

function inside(root: string, path: string): boolean {
  const base = root.endsWith('/') ? root : `${root}/`
  return path === root || path.startsWith(base)
}
