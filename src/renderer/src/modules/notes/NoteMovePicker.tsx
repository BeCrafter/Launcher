// 「移动到…」选择器。
//
// 长文档拖拽不方便时的直达入口:列文首、所有标题、文末(没有标题的文档列顶层块)。
// 目标用「起始行 + 类型」定位 —— 面板里的列表来自一次解析,执行时编辑器会
// 在实时正文里重新定位;正文已经变了就返回 invalid,不会移动错的块。

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useT } from '../../hooks/useT'
import { showToast } from '../../lib/utils'
import { Icon } from '../../components/ui/Icon'
import { isTopLevelScoped, parseMarkdownBlocks } from '../../lib/markdown-blocks'
import { locateBlock, locatorOf, type BlockLocator } from '../../lib/block-move'
import {
  buildMovePickerTargets,
  filterMovePickerTargets,
  type MovePickerTarget
} from '../../lib/block-outline'
import type { NoteEditorHandle } from './NoteEditor'

export function NoteMovePicker({
  source,
  body,
  handleRef,
  onClose
}: {
  source: BlockLocator
  body: string
  handleRef: RefObject<NoteEditorHandle | null>
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const ref = useRef<HTMLDivElement | null>(null)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)

  const parsed = useMemo(() => {
    const lines = body.split('\n')
    const blocks = parseMarkdownBlocks(body)
    const block = locateBlock(blocks, source)
    return { lines, blocks, block }
  }, [body, source])

  const targets = useMemo(
    () =>
      parsed.block === null ? [] : buildMovePickerTargets(parsed.blocks, parsed.lines, parsed.block),
    [parsed]
  )
  const filtered = useMemo(() => filterMovePickerTargets(targets, q, t), [targets, q, t])

  // 搜索词变了 / 列表换了,高亮回到第一项
  useEffect(() => {
    setActive(0)
  }, [q, targets])

  useEffect(() => {
    ref.current?.querySelector('.notes-move-row.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // 点面板外面关掉。面板是在打开它的那次 click 之后才挂载的,不会立刻被同一次按下关掉。
  useEffect(() => {
    const onPointer = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [onClose])

  const choose = (target: MovePickerTarget): void => {
    const status = handleRef.current?.moveBlock(source, target.target)
    if (status === 'invalid') {
      showToast(t('notes.blockMove.failed'), '#f87171', 'fa-circle-exclamation')
      return
    }
    onClose()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (filtered.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => (i + 1) % filtered.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (i - 1 + filtered.length) % filtered.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActive(filtered.length - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const target = filtered[active] ?? filtered[0]
      if (target !== undefined) choose(target)
    }
  }

  const nested = parsed.block !== null && !isTopLevelScoped(parsed.blocks, parsed.block)
  const emptyText =
    parsed.block === null
      ? t('notes.blockMove.noSource')
      : nested || targets.length === 0
        ? t('notes.blockMove.nestedHint')
        : t('notes.blockMove.empty')

  return (
    <div
      ref={ref}
      className="notes-move-picker"
      role="dialog"
      aria-label={t('notes.blockMove.title')}
      onKeyDown={onKeyDown}
    >
      <div className="notes-move-picker-hd">
        <Icon name="grip-vertical" />
        <span>{t('notes.blockMove.title')}</span>
        <button type="button" className="modal-close" onClick={onClose} title={t('common.close')}>
          <i className="fa-solid fa-xmark" />
        </button>
      </div>
      <div className="notes-move-picker-search">
        <i className="fa-solid fa-magnifying-glass" />
        <input
          autoFocus
          value={q}
          placeholder={t('notes.blockMove.search')}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="notes-move-picker-list">
        {filtered.length === 0 ? (
          <div className="notes-move-picker-empty">{emptyText}</div>
        ) : (
          filtered.map((target, index) => (
            <button
              key={target.key}
              type="button"
              className={'notes-move-row' + (index === active ? ' active' : '')}
              style={
                target.group === 'heading'
                  ? { paddingLeft: `${12 + Math.max(0, target.level - 1) * 14}px` }
                  : undefined
              }
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(target)}
            >
              <Icon
                name={
                  target.group === 'heading'
                    ? 'heading'
                    : target.group === 'block'
                      ? 'pilcrow'
                      : 'minus'
                }
              />
              <span className="notes-move-row-title">
                {target.group === 'start'
                  ? t('notes.blockMove.start')
                  : target.group === 'end'
                    ? t('notes.blockMove.end')
                    : target.title || t('notes.blockMove.untitled')}
              </span>
              {target.typeLabelKey !== null && (
                <span className="notes-move-row-sub">{t(target.typeLabelKey)}</span>
              )}
            </button>
          ))
        )}
      </div>
      <div className="notes-move-picker-ft">{t('notes.blockMove.hint')}</div>
    </div>
  )
}
