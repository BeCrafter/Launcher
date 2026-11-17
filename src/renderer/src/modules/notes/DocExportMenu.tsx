// 文档页头部的「导出」入口:一个按钮 + 格式下拉。
//
// 只负责选格式和定位浮层;真正的取内容/落盘在 export-actions.ts。
// 浮层挂 body、fixed 定位,与左侧「新增」菜单同一套交互(外点 / Escape / 滚动关闭、
// 方向键切换、关闭时把焦点还给按钮)—— 两个浮层的观感与键盘行为不该有差别。

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { exportFormatsFor, type ExportFormat } from '@shared/note-export'
import { useT } from '../../hooks/useT'
import type { FileDoc } from '../../state/files-store'
import type { NoteDraft } from '../../state/notes-store'
import { exportFile, exportNote } from './export-actions'

const MENU_WIDTH = 168
const GAP = 6
const EDGE = 8

const ICONS: Record<ExportFormat, string> = {
  markdown: 'fa-regular fa-file-lines',
  html: 'fa-solid fa-code',
  pdf: 'fa-solid fa-file-pdf',
  text: 'fa-regular fa-file-alt'
}

export type ExportSource =
  | { kind: 'note'; draft: NoteDraft }
  | { kind: 'file'; file: FileDoc }

interface DocExportMenuProps {
  source: ExportSource
}

export function DocExportMenu({ source }: DocExportMenuProps): React.JSX.Element | null {
  const t = useT()
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [box, setBox] = useState<{ top: number; left: number } | null>(null)
  const [busy, setBusy] = useState(false)

  const docKind = source.kind === 'note' ? 'markdown' : source.file.kind
  const formats = exportFormatsFor(docKind)
  const open = anchor !== null

  // 先量高度再定位:第一次渲染藏在视口外,避免从左上角跳过来
  useLayoutEffect(() => {
    if (anchor === null) return
    const menu = menuRef.current
    if (menu === null) return
    const place = (): void => {
      const rect = anchor.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const width = menuRect.width > 0 ? menuRect.width : MENU_WIDTH
      const height = menuRect.height
      const left = clamp(rect.right - width, EDGE, window.innerWidth - width - EDGE)
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

  const focusedRef = useRef(false)
  const closeMenu = (): void => {
    focusedRef.current = false
    setAnchor(null)
    setBox(null)
  }
  useEffect(() => {
    if (anchor === null || box === null || focusedRef.current) return
    focusedRef.current = true
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [anchor, box])

  useEffect(() => {
    if (anchor === null) return
    // pointerdown 就关会吞掉菜单项的 click;菜单自身与触发按钮放过
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRef.current?.contains(target) === true) return
      if (anchor.contains(target)) return
      closeMenu()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      btnRef.current?.focus()
      closeMenu()
    }
    const onScroll = (): void => closeMenu()
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [anchor])

  if (formats.length === 0) return null

  const pick = (format: ExportFormat): void => {
    closeMenu()
    setBusy(true)
    const run = source.kind === 'note' ? exportNote(source.draft, format) : exportFile(source.file, format)
    void run.finally(() => setBusy(false))
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
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
    if (
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
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

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="notes-act notes-export-btn"
        data-export-open="true"
        title={t('notes.export.title')}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => {
          if (busy) return
          if (anchor !== null) {
            closeMenu()
            return
          }
          setAnchor(btnRef.current)
        }}
      >
        <i className="fa-solid fa-file-export" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="notes-new-menu notes-export-menu"
            role="menu"
            aria-label={t('notes.export.title')}
            data-export-menu-layer="true"
            style={{
              visibility: box === null ? 'hidden' : 'visible',
              top: `${box?.top ?? 0}px`,
              left: `${box?.left ?? 0}px`,
              width: `${MENU_WIDTH}px`
            }}
            onKeyDown={onKeyDown}
          >
            {formats.map((format) => (
              <button
                key={format}
                type="button"
                role="menuitem"
                className="notes-new-menu-item"
                data-export-format={format}
                disabled={busy}
                onClick={() => pick(format)}
              >
                <i className={ICONS[format]} aria-hidden="true" />
                <span className="notes-new-menu-label">{t(`notes.export.${format}`)}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
