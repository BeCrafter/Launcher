// 发送按钮前的上下文用量环。
//
// 读数来源见 lib/ai-context.ts:最近一次 usage 是真实值,之后的内容与输入框草稿是估算。
// 这里只做展示,不发任何请求;窗口大小来自 main 的引擎状态(设置覆盖 > 内置目录 > 128k)。
import { useEffect, useRef, useState } from 'react'
import { useT } from '../../hooks/useT'
import { useAiStore } from '../../state/ai-store'
import { fmt } from '../../i18n'
import {
  contextPercentLabel,
  contextRatio,
  estimateDraftTokens,
  formatTokenCount,
  usageBaseTokens
} from '../../lib/ai-context'
import type { AiAttachment, AiMention } from '@shared/ai'
import { AiContextCard } from './AiContextCard'

const R = 7
const CIRC = 2 * Math.PI * R

export function AiContextMeter({
  text,
  attachments,
  mentions
}: {
  text: string
  attachments: AiAttachment[]
  mentions: AiMention[]
}): React.JSX.Element | null {
  const t = useT()
  const engine = useAiStore((s) => s.engine)
  // selector 只返回数字:流式 text_delta 期间不会因 messages 引用变化而频繁重渲染
  const base = useAiStore((s) => usageBaseTokens(s.messages))
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const open = hovered || focused

  // 引擎被切到未配置/非法窗口时,组件隐藏;把悬停与焦点状态一起收掉,
  // 否则重新配置后卡片会莫名其妙直接展开。
  useEffect(() => {
    if (engine?.configured && engine.contextWindow > 0) return
    setHovered(false)
    setFocused(false)
  }, [engine?.configured, engine?.contextWindow])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setHovered(false)
      setFocused(false)
      btnRef.current?.blur()
    }
    const onBlur = (): void => {
      setHovered(false)
      setFocused(false)
      btnRef.current?.blur()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [open])

  if (!engine?.configured || engine.contextWindow <= 0) return null

  const draft = estimateDraftTokens(text, attachments, mentions)
  const used = base + draft
  const ratio = contextRatio(used, engine.contextWindow)
  const pctLabel = contextPercentLabel(used, engine.contextWindow)
  const level = ratio >= 0.9 ? ' danger' : ratio >= 0.7 ? ' warn' : ''
  const detail =
    base === 0 && used === 0
      ? t('ai.ctx.empty')
      : base === 0
        ? t('ai.ctx.draftOnly')
        : t('ai.ctx.detail')
  const summary = fmt(t('ai.ctx.title'), {
    PCT: pctLabel,
    USED: formatTokenCount(used),
    MAX: formatTokenCount(engine.contextWindow)
  })
  const full = `${summary} · ${detail}`

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`ai-ctx${level}`}
        aria-label={full}
        // 点环只用来浏览明细,不应把焦点从输入框抢走(与 chip 上的 × 同一套处理);
        // Tab 聚焦仍然可用,聚焦后卡片会展开。
        onMouseDown={(e) => e.preventDefault()}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle className="ai-ctx-track" cx="10" cy="10" r={R} />
          <circle
            className="ai-ctx-bar"
            cx="10"
            cy="10"
            r={R}
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - ratio)}
            transform="rotate(-90 10 10)"
          />
        </svg>
      </button>
      {open && (
        <AiContextCard
          anchorRef={btnRef}
          engine={engine}
          text={text}
          attachments={attachments}
          mentions={mentions}
        />
      )}
    </>
  )
}
