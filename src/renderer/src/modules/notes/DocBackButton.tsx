// 文档页头部的「回到来源白板」。
//
// 来源只在从白板卡片跳进来时才有;普通目录点击不显示,也不响应 Esc。
// Esc 在文档页里已经有很多归属(菜单、查找栏、补全、表格行列选择、白板画布……),
// 所以这里只在「没人要这一下」时才动手:capture 阶段先看一眼按下去之前的 DOM。

import { useEffect } from 'react'
import { useT } from '../../hooks/useT'
import { returnToOrigin, useDocOrigin } from './doc-actions'

/**
 * 这些界面在场时 Escape 都有更近的归属,先交给它们:
 * 模态/抽屉/灯箱、查找栏、各种菜单与选择器、大纲、表格行列选中、正文补全、
 * 目录置顶拖拽、块手柄拖拽。白板画布整块让给 Excalidraw(取消选中/退出文字编辑)。
 */
const ESCAPE_OWNERS = [
  '.modal-mask.open',
  '.edit-drawer-mask.open',
  '.notes-find',
  '.notes-block-menu',
  '.notes-insert-menu',
  '.notes-move-picker',
  '.notes-table-picker',
  '.notes-quote-picker',
  '.notes-heading-picker',
  '.notes-list-picker',
  '.notes-new-menu',
  '.preview-outline.is-open',
  '.md-table-row-handle.active',
  '.md-table-col-handle.active',
  '.cm-tooltip-autocomplete',
  'body.notes-pin-dragging',
  'body.cm-block-dragging',
  '.excalidraw'
].join(',')

/**
 * 焦点在输入框里时 Esc 归它(目录改名、PDF 页码、表格格子、标题…)。
 * 但笔记页有一类「常驻 DOM、只在模态里出现一次」的输入框(比如关联笔记搜索),
 * 模态关着时 input 仍可能因为 autoFocus 攥着焦点 —— 那种不算,否则 Esc 永远回不去。
 */
function focusOwnedByField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const field = target.closest('input, textarea, select')
  if (field === null) return false
  const mask = field.closest('.modal-mask, .edit-drawer-mask')
  return mask === null || mask.classList.contains('open')
}

function escapeOwnedElsewhere(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return true
  if (event.isComposing || event.repeat || event.defaultPrevented) return true
  if (focusOwnedByField(event.target)) return true
  return document.querySelector(ESCAPE_OWNERS) !== null
}

export function DocBackButton(): React.JSX.Element | null {
  const t = useT()
  const origin = useDocOrigin()
  const hasOrigin = origin !== null

  useEffect(() => {
    if (!hasOrigin) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || escapeOwnedElsewhere(event)) return
      event.preventDefault()
      event.stopPropagation()
      returnToOrigin()
    }
    // capture:React 菜单的 Escape 处理跑在 root 容器上,冒泡到 window 时菜单 DOM
    // 常已被移除、判不出来;capture 阶段读到的还是按键前的状态。
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [hasOrigin])

  if (origin === null) return null
  const label = t('notes.doc.backToBoard').replace('{NAME}', origin.name)
  return (
    <button
      type="button"
      className="notes-doc-back"
      data-doc-back=""
      title={label}
      aria-label={label}
      onClick={() => returnToOrigin()}
    >
      <i className="fa-solid fa-reply" aria-hidden="true" />
      <span className="notes-doc-back-name">{origin.name}</span>
    </button>
  )
}
