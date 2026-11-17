// 「当前活动文档」的协调:同一时刻只有一篇笔记或一个文件。
// 两个 store 各自独立、互不 import;切换语义只在这一层收口,组件不要自己拼。
//
// 约定:先让**目标**开始打开(它的 openingId/openingPath 会同步置上,视图立刻切过去),
// 再让**来源**在后台保存并收起 —— 这样点击后的下一帧就是目标文档,不会被上一份的保存卡住。
//
// 另外记一份「从哪块白板跳过来的」:白板卡片是文档页之外唯一的入口,从那里跳走以后
// 文档页头部要能一键/一按 Esc 回到原白板。普通目录点击不记来源,避免任何文档都挂返回。

import { create } from 'zustand'
import { baseNameOf } from '@shared/notes'
import { useFilesStore } from '../../state/files-store'
import { useNotesStore } from '../../state/notes-store'

/**
 * 当前要显示的文档种类。**按用户最后一次点击同步切换**,而不是从两个 store 的状态反推:
 * 笔记的 leave()/文件的 leave() 都是异步保存,反推会在「旧文档还没收完」的窗口里
 * 把刚点开的新文档又盖回去(两个 store 同时非空时无法判断谁更晚)。
 */
const useActiveDoc = create<{ kind: 'note' | 'file' }>(() => ({ kind: 'note' }))

export function useActiveDocKind(): 'note' | 'file' {
  return useActiveDoc((s) => s.kind)
}

/** 来源白板:库内路径 + 显示名(只用于按钮文案)。 */
export interface DocOrigin {
  path: string
  name: string
}

/** 嵌套跳转(白板 → 子白板 → 笔记)只在会话里保留最近几层。 */
const ORIGIN_LIMIT = 8

const useDocOrigins = create<{ origins: DocOrigin[] }>(() => ({ origins: [] }))

/** 文档页头部的返回入口读它:栈顶就是「上一块白板」。 */
export function useDocOrigin(): DocOrigin | null {
  return useDocOrigins((s) => s.origins[s.origins.length - 1] ?? null)
}

/** 由当前白板路径生成来源。没在白板里(或路径未知)就没有来源。 */
export function boardOrigin(path: string | null | undefined): DocOrigin | null {
  if (path === null || path === undefined || path === '') return null
  return { path, name: baseNameOf(path) }
}

function pushOrigin(from: DocOrigin | null): void {
  useDocOrigins.setState((s) =>
    from === null
      ? { origins: [] }
      : { origins: [...s.origins, from].slice(-ORIGIN_LIMIT) }
  )
}

export function openNoteDoc(id: string, from: DocOrigin | null = null): void {
  pushOrigin(from)
  useActiveDoc.setState({ kind: 'note' })
  void useFilesStore.getState().leave()
  void useNotesStore.getState().open(id)
}

export function openFileDoc(path: string, from: DocOrigin | null = null): void {
  pushOrigin(from)
  useActiveDoc.setState({ kind: 'file' })
  void useNotesStore.getState().leave()
  void useFilesStore.getState().open(path)
}

/**
 * 回到栈顶来源白板。不能复用 openFileDoc —— 它会清空整条来源链,
 * 嵌套白板就没法继续一层层退回去。
 */
export function returnToOrigin(): void {
  const origins = useDocOrigins.getState().origins
  const target = origins[origins.length - 1]
  if (target === undefined) return
  useDocOrigins.setState({ origins: origins.slice(0, -1) })
  useActiveDoc.setState({ kind: 'file' })
  // 先让来源文档在后台保存并收起,再开目标;open() 会作废这次的收起结果,
  // 但 flush 已经把脏内容写下去了(和 openFileDoc 同序)。
  void useNotesStore.getState().leave()
  void useFilesStore.getState().leave()
  void useFilesStore.getState().open(target.path)
}
