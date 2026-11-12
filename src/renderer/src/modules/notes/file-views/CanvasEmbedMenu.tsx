// 白板的嵌入入口。Excalidraw 「更多工具」里已经有一项「嵌入网页」,
// 那个菜单是写死的,加不进一行。这里把那一项换成打开同一个选择器:
// 第一级是类型,「笔记和文件」再进一级。点这一项本身不切到 embeddable 工具。
// 只有选择器里的「网页」才切过去,在画布上拖出一块再填地址。
// 选择器挂到 .excalidraw 上,才读得到它的岛屿颜色。
// 隐藏的文件框留在这里:系统对话框关上时落在外面的点击不会把它跟选择器一起卸掉。

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../../hooks/useT'
import { showToast } from '../../../lib/utils'
import { CanvasEmbedPicker, type CanvasEmbedPage, type CanvasEmbedPick } from './CanvasEmbedPicker'
import { picksFromLocalFiles } from './canvas-external-embed'

const MENU_GAP = 6
const PICKER_WIDTH = 320
const EDGE = 8

export function CanvasEmbedMenu({
  board,
  onPick,
  onWeb
}: {
  /** 画板根节点。「更多工具」要等 Excalidraw 画出来才有。 */
  board: HTMLElement
  onPick: (pick: CanvasEmbedPick) => void
  /** 关掉选择器,切到画布上拖一块再填网址。 */
  onWeb: () => void
}): React.JSX.Element | null {
  const t = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const pickingRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<CanvasEmbedPage>('kinds')
  const [box, setBox] = useState<{ top: number; left: number } | null>(null)
  const overlay = board.querySelector('.excalidraw')
  const label = t('notes.canvas.embed.local')

  useEffect(() => {
    // React 的 onClick 挂在菜单项上。捕获阶段 preventDefault 拦不住它,
    // 换掉 onclick 才能不让 Excalidraw 切到「嵌入网页」工具(那个工具会拖出一块空卡片)。
    const retarget = (): void => {
      const item = board.querySelector<HTMLButtonElement>(
        '.dropdown-menu-container .dropdown-menu-item[data-testid="toolbar-embeddable"]'
      )
      if (item === null) return
      item.setAttribute('aria-label', label)
      item.setAttribute('title', label)
      const text = item.querySelector('.dropdown-menu-item__text')
      if (text !== null && text.textContent !== label) text.textContent = label
      item.dataset.canvasEmbed = '1'
      item.onclick = (event) => {
        event.stopPropagation()
        event.preventDefault()
        setPage('kinds')
        setOpen(true)
        // 这一项原来会把工具切成「嵌入网页」并关掉菜单。点击被截住后菜单还开着。
        // 已经关上就不再点触发按钮,否则会把菜单又弹开。
        if (board.querySelector('.dropdown-menu-container') !== null) {
          board.querySelector<HTMLButtonElement>('.App-toolbar__extra-tools-trigger')?.click()
        }
      }
    }
    retarget()
    const observer = new MutationObserver(retarget)
    observer.observe(board, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [board, label])

  useEffect(() => {
    const onFocus = (): void => {
      if (!pickingRef.current) return
      requestAnimationFrame(() => {
        pickingRef.current = false
      })
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (pickingRef.current) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (target instanceof Element && target.closest('.canvas-embed-picker') !== null) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || pickingRef.current) return
      event.stopPropagation()
      event.preventDefault()
      if (page === 'library') {
        setPage('kinds')
        return
      }
      setOpen(false)
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, page])

  useLayoutEffect(() => {
    if (!open || !(overlay instanceof HTMLElement)) {
      setBox(null)
      return
    }
    const root = overlay
    const measure = (): void => {
      const trigger = board.querySelector<HTMLElement>('.App-toolbar__extra-tools-trigger')
      if (trigger === null) return
      const next = placePicker(trigger, root)
      setBox((prev) => (prev !== null && prev.top === next.top && prev.left === next.left ? prev : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    const trigger = board.querySelector('.App-toolbar__extra-tools-trigger')
    if (trigger !== null) observer.observe(trigger)
    const picker = root.querySelector('.canvas-embed-picker')
    if (picker !== null) observer.observe(picker)
    return () => observer.disconnect()
  }, [open, overlay, board])

  const openFiles = (accept: readonly string[]): void => {
    const input = fileRef.current
    if (input === null) return
    input.accept = accept.map((ext) => `.${ext}`).join(',')
    input.value = ''
    pickingRef.current = true
    input.click()
  }

  const onFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    pickingRef.current = false
    const picked = event.currentTarget.files
    const list = picked === null ? [] : [...picked]
    void (async () => {
      const rows = await picksFromLocalFiles(list)
      if (rows.length < list.length) {
        showToast(t('notes.canvas.drop.unsupported'), '#fbbf24', 'fa-triangle-exclamation')
      }
      for (const row of rows) onPickRef.current(row)
      if (rows.length > 0) setOpen(false)
    })()
  }

  const place = (): React.CSSProperties =>
    ({
      visibility: box === null ? 'hidden' : 'visible',
      '--embed-top': `${box?.top ?? 0}px`,
      '--embed-left': `${box?.left ?? 0}px`,
      '--embed-panel': `${PICKER_WIDTH}px`
    }) as React.CSSProperties

  const showPicker = open && overlay instanceof HTMLElement
  return (
    <>
      <input
        ref={fileRef}
        className="canvas-embed-picker-file"
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFile}
      />
      {showPicker
        ? createPortal(
            <CanvasEmbedPicker
              style={place()}
              page={page}
              onPage={setPage}
              onOpenFiles={openFiles}
              onWeb={() => {
                setOpen(false)
                onWeb()
              }}
              onPick={(pick) => {
                onPick(pick)
                setOpen(false)
              }}
            />,
            overlay
          )
        : null}
    </>
  )
}

/** 贴在「更多工具」按钮下方;下方放不下就改到上方。左边由样式夹在画布里。 */
function placePicker(trigger: HTMLElement, root: HTMLElement): { top: number; left: number } {
  const button = trigger.getBoundingClientRect()
  const bounds = root.getBoundingClientRect()
  const picker = root.querySelector('.canvas-embed-picker')
  const height = picker instanceof HTMLElement ? picker.getBoundingClientRect().height : 0
  const left = Math.round(button.left - bounds.left)
  let top = Math.round(button.bottom - bounds.top + MENU_GAP)
  if (height > 0) {
    const spaceBelow = bounds.height - (button.bottom - bounds.top) - MENU_GAP - EDGE
    const spaceAbove = button.top - bounds.top - MENU_GAP - EDGE
    if (height > spaceBelow && spaceAbove > spaceBelow) {
      top = Math.round(button.top - bounds.top - MENU_GAP - height)
    }
    const maxTop = Math.max(EDGE, bounds.height - height - EDGE)
    top = Math.min(Math.max(top, EDGE), maxTop)
  }
  return { top, left }
}
