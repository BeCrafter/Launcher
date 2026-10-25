// 上下文环的悬停明细卡。
//
// 只在环被悬停/聚焦时挂载:挂载后才订阅 messages 并计算完整拆分,
// 关闭时既没有额外订阅,也不会跟着流式 delta 重渲染。
import { useLayoutEffect, useMemo, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { AiAttachment, AiEngineState, AiMention } from '@shared/ai'
import { useT } from '../../hooks/useT'
import { fmt } from '../../i18n'
import { useAiStore } from '../../state/ai-store'
import { contextBreakdown, formatTokenCount } from '../../lib/ai-context'

const CARD_WIDTH = 272
const EDGE = 8

export function AiContextCard({
  anchorRef,
  engine,
  text,
  attachments,
  mentions
}: {
  anchorRef: RefObject<HTMLButtonElement | null>
  engine: AiEngineState
  text: string
  attachments: AiAttachment[]
  mentions: AiMention[]
}): React.JSX.Element | null {
  const t = useT()
  const messages = useAiStore((s) => s.messages)
  const bd = useMemo(
    () => contextBreakdown(messages, text, attachments, mentions, engine.contextWindow),
    [messages, text, attachments, mentions, engine.contextWindow]
  )
  const [pos, setPos] = useState<{ left: number; bottom: number; width: number } | null>(null)

  // 无依赖数组:每次渲染后重新量一次锚点。输入变长/附件换行都会把 composer 顶高,
  // 只监听 resize 不够;位置相等时不 setState,避免自触发循环。
  useLayoutEffect(() => {
    const update = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.max(200, Math.min(CARD_WIDTH, window.innerWidth - EDGE * 2))
      const left = Math.max(
        EDGE,
        Math.min(window.innerWidth - width - EDGE, rect.right - width)
      )
      const bottom = Math.max(EDGE, window.innerHeight - rect.top + EDGE)
      setPos((prev) =>
        prev && prev.left === left && prev.bottom === bottom && prev.width === width
          ? prev
          : { left, bottom, width }
      )
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  })

  if (!pos) return null

  const level = bd.rawRatio >= 0.9 ? 'danger' : bd.rawRatio >= 0.7 ? 'warn' : ''
  const fill = bd.used <= 0 ? 0 : Math.max(2, Math.min(100, bd.rawRatio * 100))
  const draftSub = fmt(t('ai.ctx.card.draftSub'), {
    CHARS: bd.chars,
    ATTS: bd.attachmentCount,
    MENTIONS: bd.mentionCount
  })
  const attSub = fmt(t('ai.ctx.card.draftAtt'), {
    TEXT: bd.textCount,
    IMG: bd.imageCount
  })
  const noAnchorText =
    bd.unanchoredMessageCount > 0
      ? fmt(t('ai.ctx.card.earlierNotCounted'), { N: bd.unanchoredMessageCount })
      : bd.used > 0
        ? t('ai.ctx.draftOnly')
        : t('ai.ctx.empty')

  return createPortal(
    <div
      className={`ai-ctx-card${level ? ` ${level}` : ''}`}
      style={{ left: pos.left, bottom: pos.bottom, width: pos.width }}
      role="tooltip"
    >
      <div className="ai-ctx-card-head">
        <span className="ai-ctx-card-title">{t('ai.ctx.card.title')}</span>
        <span className="ai-ctx-card-pct">{bd.pctLabel}</span>
      </div>
      <div className="ai-ctx-card-summary">
        <span>
          {fmt(t('ai.ctx.card.summary'), {
            USED: formatTokenCount(bd.used),
            MAX: formatTokenCount(bd.limit)
          })}
        </span>
        <span className={bd.overBy > 0 ? 'over' : ''}>
          {bd.overBy > 0
            ? fmt(t('ai.ctx.card.over'), { OVER: formatTokenCount(bd.overBy) })
            : fmt(t('ai.ctx.card.remaining'), { LEFT: formatTokenCount(bd.remaining) })}
        </span>
      </div>
      <div className="ai-ctx-card-bar">
        <span style={{ width: `${fill}%` }} />
      </div>

      <div className="ai-ctx-card-rows">
        {bd.anchorIndex >= 0 ? (
          <>
            <div className="ai-ctx-card-row">
              <div className="ai-ctx-card-row-main">
                <span className="ai-ctx-card-row-label">{t('ai.ctx.card.anchor')}</span>
                <span className="ai-ctx-card-row-value">{formatTokenCount(bd.anchorTokens)}</span>
              </div>
              <span className="ai-ctx-card-row-sub">
                {fmt(t('ai.ctx.card.anchorSub'), {
                  IN: formatTokenCount(bd.anchorUsage?.input ?? 0),
                  OUT: formatTokenCount(bd.anchorUsage?.output ?? 0)
                })}
              </span>
            </div>
            <div className="ai-ctx-card-row">
              <div className="ai-ctx-card-row-main">
                <span className="ai-ctx-card-row-label">{t('ai.ctx.card.trailing')}</span>
                <span className="ai-ctx-card-row-value">
                  {formatTokenCount(bd.trailingTokens)}
                </span>
              </div>
              <span className="ai-ctx-card-row-sub">
                {fmt(t('ai.ctx.card.trailingSub'), { N: bd.trailingCount })}
              </span>
            </div>
          </>
        ) : (
          <div className="ai-ctx-card-note">{noAnchorText}</div>
        )}
        <div className="ai-ctx-card-row">
          <div className="ai-ctx-card-row-main">
            <span className="ai-ctx-card-row-label">{t('ai.ctx.card.draft')}</span>
            <span className="ai-ctx-card-row-value">{formatTokenCount(bd.draftTokens)}</span>
          </div>
          <span className="ai-ctx-card-row-sub">{draftSub}</span>
          {bd.attachmentCount > 0 && <span className="ai-ctx-card-row-sub">{attSub}</span>}
        </div>
      </div>

      <div className="ai-ctx-card-foot">
        <div>
          {fmt(t('ai.ctx.card.model'), {
            PROVIDER: engine.providerName,
            MODEL: engine.modelLabel
          })}
        </div>
        <div>
          {fmt(t('ai.ctx.card.window'), {
            MAX: formatTokenCount(bd.limit),
            OUT: formatTokenCount(engine.maxTokens)
          })}
        </div>
        <div className="ai-ctx-card-note">{t('ai.ctx.card.note')}</div>
      </div>
    </div>,
    document.body
  )
}
