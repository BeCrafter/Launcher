// 编辑区右上角的查找 / 替换浮层。
//
// 设计要点:
//   · 不占正文高度(absolute 浮在编辑区上),⌘F 打开、⌘⌥F 展开替换、Esc 回正文;
//   · 匹配、计数、替换全部来自 lib/note-find.ts 的同一批区间 —— 面板显示的和
//     编辑器里高亮的永远是同一份;
//   · 导航只选中 + 居中滚动,不抢焦点,所以可以一边看正文一边继续敲查询词;
//   · 面板关闭再打开保留上一次的查询/替换词/选项(存在 NotesView 的 memoryRef 里),
//     不必把状态提到父组件导致每敲一个字重渲染整页。

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject, type RefObject } from 'react'
import { useFmt, useT } from '../../hooks/useT'
import {
  MAX_FIND_MATCHES,
  buildReplaceAll,
  findMatches,
  initialMatchIndex,
  nextMatchIndex,
  replacementAt,
  type FindOptions,
  type FindState
} from '../../lib/note-find'
import type { NoteEditorHandle } from './NoteEditor'

interface NoteFindBarProps {
  handleRef: RefObject<NoteEditorHandle | null>
  body: string
  memoryRef: MutableRefObject<FindState>
  replaceOpen: boolean
  /** 每次请求打开 / 再次按 ⌘F 递增:把焦点拉回查询框并全选 */
  focusNonce: number
  onToggleReplace: () => void
  onClose: () => void
}

/** 单行、非空、不太长的选区直接当查询词;否则沿用上一次的查询。 */
function seedQuery(handle: NoteEditorHandle | null, fallback: string): string {
  const selection = handle?.selectionText() ?? ''
  if (selection !== '' && !selection.includes('\n') && selection.length <= 200) return selection
  return fallback
}

function clampIndex(index: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(Math.max(index, 0), total - 1)
}

export function NoteFindBar({
  handleRef,
  body,
  memoryRef,
  replaceOpen,
  focusNonce,
  onToggleReplace,
  onClose
}: NoteFindBarProps): React.JSX.Element {
  const t = useT()
  const fmt = useFmt()

  const [query, setQuery] = useState(() => seedQuery(handleRef.current, memoryRef.current.query))
  const [replacement, setReplacement] = useState(() => memoryRef.current.replacement)
  const [options, setOptions] = useState<FindOptions>(() => ({ ...memoryRef.current.options }))
  const [active, setActive] = useState(0)
  const [status, setStatus] = useState<string | null>(null)

  const queryRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)

  const result = useMemo(() => findMatches(body, query, options), [body, query, options])
  const matches = result.matches
  const total = matches.length
  const invalid = result.error !== null
  const canReplace = !invalid && total > 0
  const canReplaceAll = canReplace && !result.truncated

  // 打开 / 再次按 ⌘F:焦点进查询框并全选,便于直接改写查询
  useEffect(() => {
    const input = queryRef.current
    if (input === null) return
    input.focus()
    input.select()
  }, [focusNonce])

  // 查询或选项变化:从光标处重新定位活动匹配并跳过去。
  // 故意不依赖 matches —— 正文变化走下面那个 effect,不能在这里把滚动/选区重置。
  useEffect(() => {
    const handle = handleRef.current
    if (handle === null) return
    setStatus(null)
    const cursor = handle.selectionOffset()
    const next = initialMatchIndex(matches, cursor)
    setActive(next)
    handle.setFindHighlights(matches, next)
    const match = matches[next]
    if (match !== undefined) handle.revealFindMatch(match.from, match.to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, options])

  // 正文变化(用户继续编辑 / 刚刚替换完):只重铺底色并夹住下标,不抢焦点、不滚动。
  const previousBody = useRef(body)
  useEffect(() => {
    if (previousBody.current === body) return
    previousBody.current = body
    const handle = handleRef.current
    if (handle === null) return
    const clamped = clampIndex(active, total)
    if (clamped !== active) setActive(clamped)
    handle.setFindHighlights(matches, clamped)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body])

  // 关掉面板就清掉底色;选区保持不动(当前匹配仍然选中)
  useEffect(
    () => () => {
      handleRef.current?.clearFindMatches()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const setQueryValue = (value: string): void => {
    setQuery(value)
    memoryRef.current = { ...memoryRef.current, query: value }
  }

  const setReplacementValue = (value: string): void => {
    setReplacement(value)
    memoryRef.current = { ...memoryRef.current, replacement: value }
  }

  const toggleOption = (key: keyof FindOptions): void => {
    const next = { ...options, [key]: !options[key] }
    setOptions(next)
    memoryRef.current = { ...memoryRef.current, options: next }
  }

  const go = (delta: number): void => {
    if (total === 0) return
    const next = nextMatchIndex(active, total, delta)
    setActive(next)
    const handle = handleRef.current
    handle?.setFindHighlights(matches, next)
    const match = matches[next]
    if (match !== undefined) handle?.revealFindMatch(match.from, match.to)
  }

  const replaceOne = (): void => {
    const match = matches[active]
    if (match === undefined || invalid) return
    const insert = replacementAt(body, match, query, options, replacement)
    const nextText = body.slice(0, match.from) + insert + body.slice(match.to)
    const nextMatches = findMatches(nextText, query, options).matches
    const nextIndex = initialMatchIndex(nextMatches, match.from + insert.length)
    handleRef.current?.replaceFindMatch(
      match.from,
      match.to,
      insert,
      nextMatches[nextIndex]
    )
    setActive(nextIndex)
    setStatus(null)
    replaceRef.current?.focus()
  }

  const replaceAll = (): void => {
    if (!canReplaceAll) return
    const changes = buildReplaceAll(body, matches, query, options, replacement)
    handleRef.current?.replaceFindAll(changes)
    setActive(0)
    setStatus(fmt(t('notes.find.replaced'), { N: changes.length }))
    replaceRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // 中文输入法组词中的回车 / Esc 不触发导航,也不该关面板
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.target === queryRef.current) {
      if (event.key === 'Enter') {
        event.preventDefault()
        go(event.shiftKey ? -1 : 1)
      }
      return
    }
    if (event.target === replaceRef.current && event.key === 'Enter') {
      event.preventDefault()
      replaceOne()
    }
  }

  let countText: string
  if (invalid) countText = '—'
  else if (result.truncated) countText = `${MAX_FIND_MATCHES}+`
  else countText = fmt(t('notes.find.count'), { N: total === 0 ? 0 : active + 1, M: total })

  let hint: string | null = null
  if (invalid) hint = t('notes.find.invalidRegex')
  else if (result.truncated) hint = t('notes.find.tooMany')
  else hint = status

  return (
    <div
      className="notes-find"
      role="search"
      aria-label={t('notes.find.open')}
      onKeyDown={onKeyDown}
    >
      <div className="notes-find-row">
        <button
          type="button"
          className={'notes-find-btn notes-find-toggle' + (replaceOpen ? ' open' : '')}
          title={t('notes.find.toggleReplace')}
          aria-label={t('notes.find.toggleReplace')}
          aria-expanded={replaceOpen}
          onClick={onToggleReplace}
        >
          <i className={replaceOpen ? 'fa-solid fa-caret-down' : 'fa-solid fa-caret-right'} />
        </button>
        <i className="notes-find-glyph fa-solid fa-magnifying-glass" aria-hidden="true" />
        <input
          ref={queryRef}
          className={'notes-find-input' + (invalid ? ' invalid' : '')}
          value={query}
          placeholder={t('notes.find.query')}
          aria-label={t('notes.find.query')}
          aria-invalid={invalid}
          spellCheck={false}
          onChange={(event) => setQueryValue(event.target.value)}
        />
        <span className="notes-find-count" aria-live="polite">
          {countText}
        </span>
        <button
          type="button"
          className="notes-find-btn"
          title={t('notes.find.prev')}
          aria-label={t('notes.find.prev')}
          disabled={total === 0}
          onClick={() => go(-1)}
        >
          <i className="fa-solid fa-chevron-up" />
        </button>
        <button
          type="button"
          className="notes-find-btn"
          title={t('notes.find.next')}
          aria-label={t('notes.find.next')}
          disabled={total === 0}
          onClick={() => go(1)}
        >
          <i className="fa-solid fa-chevron-down" />
        </button>
        <button
          type="button"
          className="notes-find-btn"
          title={t('notes.find.close')}
          aria-label={t('notes.find.close')}
          onClick={onClose}
        >
          <i className="fa-solid fa-xmark" />
        </button>
      </div>

      {replaceOpen && (
        <div className="notes-find-row notes-find-replace">
          <input
            ref={replaceRef}
            className="notes-find-input"
            value={replacement}
            placeholder={t('notes.find.replace')}
            aria-label={t('notes.find.replace')}
            spellCheck={false}
            onChange={(event) => setReplacementValue(event.target.value)}
          />
          <button
            type="button"
            className="notes-find-text-btn"
            disabled={!canReplace}
            onClick={replaceOne}
          >
            {t('notes.find.replaceOne')}
          </button>
          <button
            type="button"
            className="notes-find-text-btn"
            disabled={!canReplaceAll}
            onClick={replaceAll}
          >
            {t('notes.find.replaceAll')}
          </button>
        </div>
      )}

      <div className="notes-find-options">
        <button
          type="button"
          className={'notes-find-opt notes-find-case'}
          title={t('notes.find.caseSensitive')}
          aria-label={t('notes.find.caseSensitive')}
          aria-pressed={options.caseSensitive}
          onClick={() => toggleOption('caseSensitive')}
        >
          Aa
        </button>
        <button
          type="button"
          className="notes-find-opt"
          title={t('notes.find.wholeWord')}
          aria-label={t('notes.find.wholeWord')}
          aria-pressed={options.wholeWord}
          onClick={() => toggleOption('wholeWord')}
        >
          {t('notes.find.wholeWord')}
        </button>
        <button
          type="button"
          className={'notes-find-opt notes-find-regex' + (invalid ? ' invalid' : '')}
          title={t('notes.find.regex')}
          aria-label={t('notes.find.regex')}
          aria-pressed={options.regex}
          onClick={() => toggleOption('regex')}
        >
          .*
        </button>
        {hint !== null && (
          <span
            className={'notes-find-hint' + (invalid || result.truncated ? ' danger' : '')}
            aria-live="polite"
          >
            {hint}
          </span>
        )}
      </div>
    </div>
  )
}
