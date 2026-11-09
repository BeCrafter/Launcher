// 「当前活动文档」的协调:同一时刻只有一篇笔记或一个文件。
// 两个 store 各自独立、互不 import;切换语义只在这一层收口,组件不要自己拼。
//
// 约定:先让**目标**开始打开(它的 openingId/openingPath 会同步置上,视图立刻切过去),
// 再让**来源**在后台保存并收起 —— 这样点击后的下一帧就是目标文档,不会被上一份的保存卡住。

import { create } from 'zustand'
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

export function openNoteDoc(id: string): void {
  useActiveDoc.setState({ kind: 'note' })
  void useFilesStore.getState().leave()
  void useNotesStore.getState().open(id)
}

export function openFileDoc(path: string): void {
  useActiveDoc.setState({ kind: 'file' })
  void useNotesStore.getState().leave()
  void useFilesStore.getState().open(path)
}
