// `/` 菜单:内置技能 + 一个「添加本地文件」操作。
//
// 技能不是把名字插进正文,而是变成输入框里的一颗技能 chip(AiComposerEditor 的 token),
// 发送时只把 skillIds 交给 main —— 与欢迎态技能卡走同一条链路。
// 已选中的技能会标出来;再点一次是取消,选择本身不替换已选中的其它技能。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../hooks/useT'
import { useAiStore } from '../../state/ai-store'
import { slashRows, type SlashRow } from '../../lib/ai-slash'

export function AiSlashPopover({
  open,
  query,
  anchorRef,
  selectedSkillIds,
  onPickSkill,
  onPickFile,
  onClose
}: {
  open: boolean
  query: string
  anchorRef: React.RefObject<HTMLElement | null>
  selectedSkillIds: readonly string[]
  onPickSkill: (id: string) => void
  onPickFile: () => void
  onClose: () => void
}): React.JSX.Element | null {
  const t = useT()
  const skills = useAiStore((s) => s.skills)
  const popRef = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; bottom: number; width: number } | null>(null)

  const rows = useMemo<SlashRow[]>(() => slashRows(query, skills, t), [query, skills, t])

  useEffect(() => {
    setActive(0)
  }, [open, query])

  // query/rows 变化时输入框会增高或换行,锚点顶部随之移动;只监听 resize
  // 会让菜单停在旧位置。
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const update = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(480, Math.max(280, rect.width))
      const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left))
      setPos({ left, bottom: Math.max(12, window.innerHeight - rect.top + 8), width })
    }
    update()
    window.addEventListener('resize', update)
    // capture 滚动:输入区上方的消息列表滚动时菜单跟着锚点走
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, anchorRef, query, rows.length])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      const el = e.target as Node | null
      if (!el) return
      if (popRef.current?.contains(el) || anchorRef.current?.contains(el)) return
      onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, anchorRef, onClose])

  // 捕获阶段接管方向键/Enter/Esc:编辑器仍保持焦点,但不会把 Enter 当成发送。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.isComposing) return
      if (e.key === 'ArrowDown') {
        if (rows.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        setActive((i) => (i + 1) % rows.length)
        return
      }
      if (e.key === 'ArrowUp') {
        if (rows.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        setActive((i) => (i - 1 + rows.length) % rows.length)
        return
      }
      if (e.key === 'Enter') {
        const row = rows[active]
        // 没有匹配项时 Enter 只负责收起菜单,不能落到编辑器里把 `/zzz` 当成
        // 一条消息直接发出去。
        if (!row) {
          e.preventDefault()
          e.stopPropagation()
          onClose()
          return
        }
        e.preventDefault()
        e.stopPropagation()
        if (row.type === 'skill') onPickSkill(row.skill.id)
        else onPickFile()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, rows, active, onPickSkill, onPickFile, onClose])

  if (!open || !pos) return null

  return createPortal(
    <div
      id="aiSlashPop"
      className="ai-slash-pop open"
      ref={popRef}
      style={{ left: pos.left, bottom: pos.bottom, width: pos.width }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="ai-slash-head">
        <span>{t('ai.slash.title')}</span>
        <span className="ai-slash-kbd">{t('ai.slash.hint')}</span>
      </div>
      {rows.length === 0 ? (
        <div className="ai-mention-empty">{t('ai.slash.empty')}</div>
      ) : (
        rows.map((row, i) => {
          const isActive = i === active
          if (row.type === 'file') {
            return (
              <button
                key="file"
                type="button"
                className={`ai-slash-row${isActive ? ' active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={onPickFile}
              >
                <span className="ai-slash-icon">
                  <i className="fa-solid fa-paperclip" />
                </span>
                <span className="ai-slash-body">
                  <span className="ai-slash-label">{row.label}</span>
                  <span className="ai-slash-desc">{row.desc}</span>
                </span>
                <kbd className="ai-slash-shortcut">⌘⇧U</kbd>
              </button>
            )
          }
          const selected = selectedSkillIds.includes(row.skill.id)
          return (
            <button
              key={row.skill.id}
              type="button"
              className={`ai-slash-row${isActive ? ' active' : ''}${selected ? ' selected' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPickSkill(row.skill.id)}
            >
              <span className="ai-slash-icon">
                <i className={`fa-solid ${row.skill.icon}`} />
              </span>
              <span className="ai-slash-body">
                <span className="ai-slash-label">
                  {row.label}
                  {selected && <span className="ai-slash-current">{t('ai.slash.selected')}</span>}
                </span>
                <span className="ai-slash-desc">{row.desc}</span>
              </span>
              <span className="ai-slash-tag">{row.skill.tag}</span>
            </button>
          )
        })
      )}
    </div>,
    document.body
  )
}
