// ported-from: docs/demo/js/ai.js aiRenderRail/aiRailHit/aiNewChat @ 06ff9ba — demo UI 基线
// 会话栏:搜索(标题优先,正文命中出 ±12/+28 摘要高亮)+ 新对话 + 会话列表
// 与 demo 的差异:预置会话来自 main 持久化(AiSession),正文按需拉取进 msgCache 供搜索扫描
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useT } from '../../hooks/useT'
import { useAiStore, sessionTsLabel } from '../../state/ai-store'
import type { AiMessage } from '@shared/ai'

export function AiRail({ collapsed, mobileOpen }: { collapsed: boolean; mobileOpen: boolean }): React.JSX.Element {
  const t = useT()
  const sessions = useAiStore((s) => s.sessions)
  const currentId = useAiStore((s) => s.currentId)
  const select = useAiStore((s) => s.select)
  const railSearch = useAiStore((s) => s.railSearch)
  const setRailSearch = useAiStore((s) => s.setRailSearch)
  const ensureMessages = useAiStore((s) => s.ensureMessages)
  const msgCache = useAiStore((s) => s.msgCache)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const q = railSearch.trim().toLowerCase()

  // 搜索态按需拉正文(缓存命中即短路;拉到后 msgCache 变化触发重算)
  useEffect(() => {
    if (!q) return
    for (const s of sessions) void ensureMessages(s.id)
  }, [q, sessions, ensureMessages])

  const rows = useMemo(() => {
    if (!q) return sessions.map((s) => ({ s, hit: null as ReactNode | null }))
    return sessions
      .map((s) => ({ s, hit: railHit(s, q, msgCache[s.id]) }))
      .filter((r) => r.hit !== null)
  }, [sessions, q, msgCache])

  const onNewChat = (): void => {
    // 仅新对话清空搜索(demo aiNewChat;选中会话保留过滤)
    setRailSearch('')
    void select(null)
    searchRef.current?.focus()
  }

  return (
    <aside className={`ai-rail${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`} id="aiRail">
      <div className="ai-rail-tools">
        <div className={`search-wrap ai-rail-search${railSearch ? ' has-text' : ''}`} id="aiRailSearchWrap">
          <i className="fa-solid fa-magnifying-glass" />
          <input
            ref={searchRef}
            id="aiRailSearch"
            type="text"
            autoComplete="off"
            placeholder={t('ai.rail.searchPh')}
            value={railSearch}
            onChange={(e) => setRailSearch(e.target.value)}
          />
          <button
            className="ai-rail-search-clear"
            type="button"
            title={t('ai.rail.searchClear')}
            onClick={() => {
              setRailSearch('')
              searchRef.current?.focus()
            }}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <button className="ai-rail-new" type="button" title={t('ai.rail.new')} onClick={onNewChat}>
          <i className="fa-solid fa-plus" />
        </button>
      </div>
      <div className="ai-rail-list" id="aiRailList">
        {!sessions.length ? (
          <div className="ai-rail-empty">{t('ai.rail.empty')}</div>
        ) : q && !rows.length ? (
          <div className="ai-rail-empty">{t('ai.rail.searchEmpty')}</div>
        ) : (
          rows.map(({ s, hit }) => (
            <div
              key={s.id}
              className={`ai-rail-item${s.id === currentId ? ' active' : ''}`}
              onClick={() => void select(s.id)}
            >
              <div className="ai-rail-item-title" title={s.title}>
                {s.title}
              </div>
              {hit ?? <div className="ai-rail-item-ts">{sessionTsLabel(s.updatedAt)}</div>}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

/**
 * 会话搜索命中摘要(demo aiRailHit):标题命中返回 ''(调用方 `hit ?? ts` 仍显示时间戳行);
 * 正文命中返回带 <mark> 高亮的片段节点;未命中返回 null(该会话被过滤)。
 */
function railHit(
  s: { id: string; title: string },
  q: string,
  messages: AiMessage[] | undefined
): ReactNode | null {
  if (s.title.toLowerCase().includes(q)) return ''
  if (!messages) return null
  for (const m of messages) {
    const text = messageText(m)
    if (!text) continue
    const i = text.toLowerCase().indexOf(q)
    if (i < 0) continue
    const from = Math.max(0, i - 12)
    const to = Math.min(text.length, i + q.length + 28)
    return (
      <div className="ai-rail-hit">
        {from > 0 ? '…' : ''}
        {text.slice(from, i)}
        <mark className="ai-rail-hit-mark">{text.slice(i, i + q.length)}</mark>
        {text.slice(i + q.length, to)}
        {to < text.length ? '…' : ''}
      </div>
    )
  }
  return null
}

/** 会话正文拼接(消息里的全部 text 块;thinking/工具输出不参与搜索) */
function messageText(m: AiMessage): string {
  return m.blocks
    .filter((b): b is Extract<AiMessage['blocks'][number], { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}
