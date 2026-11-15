// 左侧目录的二级「新增」菜单。根层入口与目录行 hover 的「新增」共用这一个浮层。
//
// 浮层挂到 body、position:fixed:目录列表自己是滚动容器,挂在里面会被裁掉,
// 也没法跟着 fixed 坐标在视口边缘翻转。打开后目录一滚就关 —— 否则浮层会跟列表脱节。

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../hooks/useT'

export type NewItemKind = 'note' | 'canvas' | 'drawio' | 'folder'

const MENU_WIDTH = 190
const GAP = 6
const EDGE = 8

const ITEMS: readonly {
  kind: NewItemKind
  icon: string
  label: string
  hint: string
}[] = [
  { kind: 'note', icon: 'fa-regular fa-file-lines', label: 'notes.new.note', hint: 'notes.new.noteHint' },
  { kind: 'canvas', icon: 'fa-solid fa-chalkboard', label: 'notes.new.canvas', hint: 'notes.new.canvasHint' },
  { kind: 'drawio', icon: 'fa-solid fa-diagram-project', label: 'notes.new.drawio', hint: 'notes.new.drawioHint' }
]

interface NotesNewMenuProps {
  /** 触发按钮;浮层贴着它定位,关闭时把焦点还给它 */
  anchor: HTMLElement
  onPick: (kind: NewItemKind) => void
  onClose: () => void
}

export function NotesNewMenu({ anchor, onPick, onClose }: NotesNewMenuProps): React.JSX.Element {
  const t = useT()
  const menuRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ top: number; left: number } | null>(null)

  // 先量高度再定位:第一次渲染藏在视口外,避免用户看到从左上角跳过来
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (menu === null) return
    const place = (): void => {
      const rect = anchor.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const width = menuRect.width > 0 ? menuRect.width : MENU_WIDTH
      const height = menuRect.height
      const left = clamp(rect.left, EDGE, window.innerWidth - width - EDGE)
      let top = rect.bottom + GAP
      if (top + height > window.innerHeight - EDGE && rect.top - GAP - height >= EDGE) {
        top = rect.top - GAP - height
      }
      top = clamp(top, EDGE, Math.max(EDGE, window.innerHeight - height - EDGE))
      setBox((prev) => (prev !== null && prev.top === top && prev.left === left ? prev : { top, left }))
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(menu)
    return () => observer.disconnect()
  }, [anchor])

  // 定位前浮层是 visibility:hidden,此时 focus() 不生效 —— 先等坐标量出来再聚焦。
  const focusedRef = useRef(false)
  useEffect(() => {
    if (box === null || focusedRef.current) return
    focusedRef.current = true
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [box])

  useEffect(() => {
    // pointerdown 就把浮层关掉的话,落在菜单项上的 click 会丢;菜单与触发按钮都放过
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRef.current?.contains(target) === true) return
      if (anchor.contains(target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      anchor.focus()
      onClose()
    }
    const onScroll = (): void => onClose()
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey, true)
    // 目录列表是内部滚动容器,要在捕获阶段才收得到
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [anchor, onClose])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      // Enter 自己点一下当前项,别指望 button 的原生激活:焦点可能在菜单容器上,
      // 而且合成按键(E2E / 部分输入法)不会触发 button 的默认 activation 行为。
      const active = document.activeElement
      const own =
        active instanceof HTMLElement && active.getAttribute('role') === 'menuitem'
          ? active
          : menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      if (own == null) return
      event.preventDefault()
      own.click()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
      return
    }
    event.preventDefault()
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    if (items.length === 0) return
    const active = document.activeElement
    let index = items.findIndex((el) => el === active)
    if (index < 0) index = 0
    if (event.key === 'ArrowDown') index = (index + 1) % items.length
    else if (event.key === 'ArrowUp') index = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') index = 0
    else index = items.length - 1
    items[index]?.focus()
  }

  return createPortal(
    <div
      ref={menuRef}
      className="notes-new-menu"
      role="menu"
      aria-label={t('notes.new.label')}
      data-new-menu-layer="true"
      style={{
        visibility: box === null ? 'hidden' : 'visible',
        top: `${box?.top ?? 0}px`,
        left: `${box?.left ?? 0}px`,
        width: `${MENU_WIDTH}px`
      }}
      onKeyDown={onKeyDown}
    >
      {ITEMS.map((item) => (
        <button
          key={item.kind}
          type="button"
          role="menuitem"
          className="notes-new-menu-item"
          data-new-item={item.kind}
          onClick={() => onPick(item.kind)}
        >
          <i className={item.icon} aria-hidden="true" />
          <span className="notes-new-menu-label">{t(item.label)}</span>
          <span className="notes-new-menu-hint">{t(item.hint)}</span>
        </button>
      ))}
      <div className="notes-new-menu-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="notes-new-menu-item"
        data-new-item="folder"
        onClick={() => onPick('folder')}
      >
        <i className="fa-regular fa-folder-closed" aria-hidden="true" />
        <span className="notes-new-menu-label">{t('notes.new.folder')}</span>
      </button>
    </div>,
    document.body
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
