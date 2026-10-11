// 笔记列表的树与排序(纯函数)。
//
// 目录必须**单独**从 payload 拿:`folders` 是空目录唯一的痕迹 —— 只按笔记 id 反推的话,
// 用户刚建的空目录会在下一次刷新时凭空消失。

import type { NoteMeta } from '@shared/notes'
import { parentOf } from '@shared/notes'

export interface NoteFolderNode {
  /** 显示名(路径最后一段);根节点为空串 */
  name: string
  /** 相对路径;根节点为空串 */
  path: string
  folders: NoteFolderNode[]
  notes: NoteMeta[]
}

export type NotesSortKey = 'updated' | 'created' | 'title'

/**
 * 排序:**置顶永远在前**,其余按给定键。
 * 置顶如果只在「按更新」下恰好排第一,那它就不是置顶,只是碰巧。
 */
export function sortNotes(list: NoteMeta[], sort: NotesSortKey): NoteMeta[] {
  /**
   * 排序键后面都跟一个**决胜键** `id`。
   *
   * 为什么必须要有:created 只精确到秒,同一秒里建出来的几篇会完全并列;
   * 并列时 JS 的稳定排序会退回「输入顺序」,而输入顺序来自主进程按 mtime 的排序 ——
   * 那个值一保存就变,于是「点一下笔记,列表就重排一次」。
   * 有了决胜键,顺序是彻底确定的,与输入顺序无关。
   */
  const byKey = (a: NoteMeta, b: NoteMeta): number => {
    const tie = a.id.localeCompare(b.id)
    if (sort === 'title') return a.title.localeCompare(b.title, 'zh') || tie
    if (sort === 'created') return b.created.localeCompare(a.created) || tie
    return b.updated.localeCompare(a.updated) || tie
  }
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return byKey(a, b)
  })
}

/** 建树:先按 folders 把目录骨架铺出来(含中间层),再把笔记挂到各自的父目录 */
export function buildNoteTree(notes: NoteMeta[], folders: string[]): NoteFolderNode {
  const root: NoteFolderNode = { name: '', path: '', folders: [], notes: [] }
  const byPath = new Map<string, NoteFolderNode>([['', root]])

  const ensure = (path: string): NoteFolderNode => {
    const hit = byPath.get(path)
    if (hit) return hit
    const node: NoteFolderNode = { name: path.slice(path.lastIndexOf('/') + 1), path, folders: [], notes: [] }
    byPath.set(path, node)
    ensure(parentOf(path)).folders.push(node)
    return node
  }

  for (const f of folders) ensure(f)
  for (const n of notes) ensure(parentOf(n.id)).notes.push(n)

  const order = (node: NoteFolderNode): void => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    for (const f of node.folders) order(f)
  }
  order(root)
  return root
}

/** 某个 id 的所有祖先目录(不含自身):`a/b/c` → `['a', 'a/b']` */
export function ancestorsOf(id: string): string[] {
  const out: string[] = []
  let cur = parentOf(id)
  while (cur !== '') {
    out.unshift(cur)
    cur = parentOf(cur)
  }
  return out
}

/** 某个目录(含其所有子目录)下的笔记数 */
export function countNotesIn(node: NoteFolderNode): number {
  return node.notes.length + node.folders.reduce((n, f) => n + countNotesIn(f), 0)
}

/** 按路径找节点;找不到返回 null */
export function findFolder(root: NoteFolderNode, path: string): NoteFolderNode | null {
  if (path === '') return root
  const segs = path.split('/')
  let cur: NoteFolderNode | undefined = root
  for (const seg of segs) {
    cur = cur.folders.find((f) => f.name === seg)
    if (!cur) return null
  }
  return cur
}
