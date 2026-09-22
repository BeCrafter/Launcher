// ported-from: docs/demo/js/ai.js aiRenderMessages/aiMsgHtml/aiBotInnerHtml/aiStepsHtml @ 06ff9ba — demo UI 基线
// 消息流渲染。与 demo 的关键差异:助手消息 = shared/ai.ts 的内容块数组(text/thinking/toolCall/card/suggest
// 按到达顺序混排),demo 的固定槽位(thinking→steps→text→cards→suggest)不再成立:
//  - 连续 toolCall 块归入一个可折叠 .ai-steps(视觉同 demo 步骤块);文本打断后另起一个
//  - 工具结果是独立 toolResult 消息,按 toolCallId 配对回填步骤输出;其携带的领域卡按结果顺序排在步骤后
//  - thinking 块渲染正文(demo 只有「思考中」三点;流式中空正文沿用三点,完成后默认折叠)
import { useEffect, useRef, useState } from 'react'
import { useT, useFmt } from '../../hooks/useT'
import { TagChip } from '../../components/ui/TagChip'
import { renderMarkdown } from '../../lib/markdown'
import { getTs } from '../../lib/utils'
import { isRunningHere, useAiStore } from '../../state/ai-store'
import { AiCard, AiSuggest } from './AiCards'
import type {
  AiAssistantMessage,
  AiContentBlock,
  AiMessage,
  AiThinkingBlock,
  AiToolCallBlock,
  AiToolResultMessage,
  AiUserMessage
} from '@shared/ai'

export function aiFmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function fmtTs(stamp: number): string {
  const d = new Date(stamp)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function AiMessages(): React.JSX.Element {
  const messages = useAiStore((s) => s.messages)
  const items = buildItems(messages)
  if (!items.length) return <AiWelcome />
  return (
    <>
      {items.map((it, i) =>
        it.kind === 'user' ? (
          <UserMsg key={it.msg.id} msg={it.msg} mi={i} />
        ) : (
          <BotGroupView key={it.group.assistant.id} group={it.group} idx={i} isFinal={i === items.length - 1} />
        )
      )}
    </>
  )
}

// ── 用户消息(demo aiMsgHtml user 分支:@ 引用 chips + 气泡)──

function UserMsg({ msg, mi }: { msg: AiUserMessage; mi: number }): React.JSX.Element {
  return (
    <div className="ai-msg user" data-mi={mi}>
      <div className="ai-bubble">
        {(msg.mentions ?? []).map((m) => (
          <span className="ai-chip-ref" key={m.key}>
            <i className="fa-solid fa-at" />
            {m.label}
          </span>
        ))}
        {msg.blocks.map(
          (b, i) => (b.type === 'text' ? <span key={i}>{b.text}</span> : null)
        )}
      </div>
    </div>
  )
}

// ── 分组:assistant 消息 + 其后连续的 toolResult ──

interface BotGroup {
  assistant: AiAssistantMessage
  results: AiToolResultMessage[]
}

type RenderItem = { kind: 'user'; msg: AiUserMessage } | { kind: 'bot'; group: BotGroup }

/** 消息 → 渲染项(右侧锚点也要用它找出「用户消息」的位置,故导出) */
export function buildItems(messages: AiMessage[]): RenderItem[] {
  const items: RenderItem[] = []
  for (const m of messages) {
    if (m.role === 'user') items.push({ kind: 'user', msg: m })
    else if (m.role === 'assistant') items.push({ kind: 'bot', group: { assistant: m, results: [] } })
    else if (m.role === 'toolResult') {
      const last = items[items.length - 1]
      if (last && last.kind === 'bot') last.group.results.push(m)
    }
  }
  return items
}

// ── 助手消息组 ──

function BotGroupView({
  group,
  idx,
  isFinal
}: {
  group: BotGroup
  idx: number
  isFinal: boolean
}): React.JSX.Element {
  const t = useT()
  const fmt = useFmt()
  const runSessionId = useAiStore((s) => s.runSessionId)
  const currentId = useAiStore((s) => s.currentId)
  const toolUpdates = useAiStore((s) => s.toolUpdates)
  const pendingApprovals = useAiStore((s) => s.pendingApprovals)
  const runActive = isRunningHere({ runSessionId, currentId })
  const { assistant, results } = group
  const streaming = runActive && assistant.stopReason === 'pending'

  // 步骤项:toolCall 块 + 配对结果(±运行中增量输出)
  const stepOf = (call: AiToolCallBlock): StepItem => {
    const res = results.find((r) => r.toolCallId === call.id)
    const live = !res && runActive
    const out = res
      ? res.blocks
          .filter((b): b is Extract<AiContentBlock, { type: 'text' }> => b.type === 'text')
          .map((b) => ({ text: b.text, ts: fmtTs(res.timestamp) }))
      : live && (toolUpdates[call.id] ?? '') !== ''
        ? [{ text: toolUpdates[call.id], ts: getTs() }]
        : []
    return {
      id: call.id,
      tool: call.label ?? call.name,
      args: JSON.stringify(call.args ?? {}),
      status: res ? res.status : live ? 'run' : 'warn',
      ms: res?.durationMs ?? 0,
      out
    }
  }

  const nodes: React.ReactNode[] = []
  let run: AiToolCallBlock[] = []
  let k = 0
  const flushRun = (): void => {
    if (!run.length) return
    const items = run.map(stepOf)
    nodes.push(<AiSteps key={`steps-${idx}-${k++}`} items={items} />)
    run = []
  }
  assistant.blocks.forEach((b, bi) => {
    if (b.type === 'toolCall') {
      run.push(b)
      return
    }
    flushRun()
    const isLast = bi === assistant.blocks.length - 1
    if (b.type === 'text') {
      const withCaret = streaming && isLast
      nodes.push(
        <div className="ai-txt" key={`b${bi}`}>
          {renderMarkdown(b.text, `${assistant.id}-${bi}`)}
          {withCaret && <span className="ai-caret" />}
        </div>
      )
    } else if (b.type === 'thinking') {
      nodes.push(
        <AiThinking
          key={`b${bi}`}
          block={b}
          streaming={streaming && isLast}
        />
      )
    } else if (b.type === 'card') {
      nodes.push(<AiCard key={`b${bi}`} card={b.card} pendingToolCallId={cardToolCallId(b.card, pendingApprovals)} />)
    } else if (b.type === 'suggest') {
      nodes.push(<AiSuggest key={`b${bi}`} items={b.items} />)
    }
  })
  flushRun()

  // 领域卡(体检报告/定时任务建议/plist 草稿)由工具结果携带,按结果顺序排在步骤后(demo 卡片位次一致)
  for (const r of results) {
    for (const b of r.blocks) {
      if (b.type !== 'card') continue
      nodes.push(<AiCard key={`rc-${r.id}-${b.card.kind}`} card={b.card} pendingToolCallId={null} />)
    }
  }

  // 空块且运行中:等首个块到达前的「思考中」占位(demo ensureBotMsg 的空 bot 消息)
  const awaiting = assistant.blocks.length === 0

  return (
    <div className="ai-msg bot" data-mi={idx}>
      <div className="ai-bot-name">
        <span className="ai-bot-avatar">
          <i className="fa-solid fa-wand-magic-sparkles" />
        </span>
        Launcher Agent
      </div>
      {awaiting && streaming && (
        <div className="ai-thinking">
          <span className="ai-dots">
            <i />
            <i />
            <i />
          </span>
          <span>{t('ai.thinking')}</span>
        </div>
      )}
      {nodes}
      <MsgMeta assistant={assistant} isFinal={isFinal} />
    </div>
  )
}

/** 授权卡 ↔ 待应答表配对:卡未携带 toolCallId 时按工具名回退匹配(同工具并发调用极少,可接受) */
function cardToolCallId(
  card: { kind: string; toolCallId?: string; tool?: string },
  pending: Record<string, { runId: string; toolName: string }>
): string | null {
  if (card.kind !== 'approve') return null
  if (card.toolCallId) return card.toolCallId
  return Object.entries(pending).find(([, v]) => v.toolName === card.tool)?.[0] ?? null
}

// ── 用量与终止原因(7 态;demo 只有运行中/完成两态)──

function MsgMeta({
  assistant,
  isFinal
}: {
  assistant: AiAssistantMessage
  isFinal: boolean
}): React.JSX.Element | null {
  const t = useT()
  const fmt = useFmt()
  const { stopReason, usage, errorMessage } = assistant
  const notice =
    stopReason === 'aborted'
      ? t('ai.notice.aborted')
      : stopReason === 'length'
        ? t('ai.notice.length')
        : (stopReason === 'error' || errorMessage) && stopReason !== 'pending'
          ? fmt(t('ai.notice.error'), { M: errorMessage ?? '' })
          : // 末条仍是 toolUse = 运行在"还想继续调工具"时被截断(工具轮数上限)。
            // ⚠ 必须限定"整段对话的最后一条":中间任何调过工具的助手消息都是 toolUse 状态
            //   (循环接着跑下一轮),不限定就会满屏都是这条提示。
            stopReason === 'toolUse' && isFinal
            ? t('ai.notice.toolLimit')
            : null
  const cost = usage?.cost
  if (!notice && !(usage && usage.totalTokens > 0)) return null
  return (
    <div className="ai-msg-meta">
      {notice && <span className="ai-msg-notice">{notice}</span>}
      {usage && usage.totalTokens > 0 && (
        <span className="ai-msg-usage">
          {usage.totalTokens} tok
          {/* 只在有真实计价时显示:OpenAI 兼容端点连到哪家未知,目录价一律补 0,
             显示 $0.0000 会被读成"免费"而不是"不知道",不如不显示 */}
          {cost && cost.total > 0 ? ` · $${cost.total.toFixed(4)}` : ''}
        </span>
      )}
    </div>
  )
}

// ── 工具步骤块(demo aiStepsHtml/aiStepHtml;归组规则见文件头)──

interface StepItem {
  id: string
  tool: string
  args: string
  status: 'run' | 'ok' | 'warn' | 'err'
  ms: number
  out: { text: string; ts: string }[]
}

function AiSteps({ items }: { items: StepItem[] }): React.JSX.Element {
  const t = useT()
  const fmt = useFmt()
  const [collapsed, setCollapsed] = useState(false)
  const wasRunning = useRef(false)
  const running = items.some((i) => i.status === 'run')
  // 运行结束自动折叠(demo aiFinishRun);开始运行自动展开,保证过程可见
  useEffect(() => {
    if (wasRunning.current && !running) setCollapsed(true)
    if (!wasRunning.current && running) setCollapsed(false)
    wasRunning.current = running
  }, [running])

  const done = items.filter((i) => i.status !== 'run').length
  const totalMs = items.reduce((n, i) => n + i.ms, 0)
  const sum = running
    ? fmt(t('ai.steps.running'), { N: done })
    : fmt(t('ai.steps.done'), { N: items.length, T: aiFmtMs(totalMs) })

  return (
    <div className={`ai-steps${collapsed ? '' : ' open'}`}>
      <div className="ai-steps-hd" onClick={() => setCollapsed((v) => !v)}>
        <i className="fa-solid fa-bolt" />
        <span>{sum}</span>
        <i className={`fa-solid fa-chevron-right ai-chev${collapsed ? '' : ' open'}`} />
      </div>
      <div className="ai-steps-body">
        {items.map((it) => (
          <AiStep key={it.id} item={it} />
        ))}
      </div>
    </div>
  )
}

function AiStep({ item }: { item: StepItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const hasOut = item.out.length > 0
  const stIcon =
    item.status === 'run' ? (
      <i className="fa-solid fa-circle-notch ai-spin" />
    ) : (
      <span className={`ai-step-dot ${item.status}`} />
    )
  return (
    <div className={`ai-step${hasOut ? '' : ' no-out'}`}>
      <div
        className="ai-step-hd"
        onClick={() => {
          if (hasOut) setOpen((v) => !v)
        }}
      >
        {stIcon}
        <span className="ai-tool">{item.tool}</span>
        {item.args !== '{}' && (
          <span className="ai-step-args" title={item.args}>
            {item.args}
          </span>
        )}
        <span className="ai-step-ms">{item.status === 'run' ? '' : aiFmtMs(item.ms)}</span>
        {hasOut && <i className={`fa-solid fa-chevron-right ai-step-chev${open ? ' open' : ''}`} />}
      </div>
      {hasOut && (
        <div className={`ai-step-out${open ? ' open' : ''}`}>
          {item.out.map((o, i) => (
            <div className="log-line" key={i}>
              <span className="log-ts">{o.ts}</span>
              <span className="log-txt">{o.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── thinking 块(demo 无此渲染;流式空正文沿用三点,有正文可折叠,完成后默认折叠)──

function AiThinking({ block, streaming }: { block: AiThinkingBlock; streaming: boolean }): React.JSX.Element {
  const t = useT()
  const [toggled, setToggled] = useState<boolean | null>(null)
  const open = toggled ?? streaming
  const hasText = block.thinking.trim() !== ''

  // 流式且还没有正文:demo 的「思考中」三点
  if (streaming && !hasText) {
    return (
      <div className="ai-thinking">
        <span className="ai-dots">
          <i />
          <i />
          <i />
        </span>
        <span>{t('ai.thinking')}</span>
      </div>
    )
  }
  // redacted:正文被服务端加密,只提示不展示
  if (!hasText) {
    return (
      <div className="ai-thinking">
        <span>{t('ai.thinking.redacted')}</span>
      </div>
    )
  }
  return (
    <div className="ai-thinking stack">
      <div
        className="ai-thinking-hd"
        onClick={() => setToggled(!open)}
        role="button"
        tabIndex={0}
      >
        <span>{streaming ? t('ai.thinking') : t('ai.thinking.done')}</span>
        <i className={`fa-solid fa-chevron-right ai-chev${open ? ' open' : ''}`} />
      </div>
      {open && (
        <div className="ai-thinking-body">
          {block.redacted ? t('ai.thinking.redacted') : block.thinking}
        </div>
      )}
    </div>
  )
}

// ── 欢迎态(demo aiWelcomeHtml;数据来自 dataSource().ai.skills())──

function AiWelcome(): React.JSX.Element {
  const t = useT()
  const skills = useAiStore((s) => s.skills)
  const send = useAiStore((s) => s.send)
  const guard = useAiStore((s) => s.guardConfigured)
  const run = (text: string, skillId?: string): void => {
    if (!guard()) return
    void send(text, skillId ? { skillId } : undefined)
  }
  return (
    <div className="ai-welcome">
      <div className="ai-welcome-greet">
        <i className="fa-solid fa-wand-magic-sparkles" />
        {t('ai.welcome.greet')}
      </div>
      <div className="ai-welcome-sub">{t('ai.welcome.sub')}</div>
      <div
        className="ai-health-card"
        onClick={() => run(`${t('ai.welcome.healthTitle')}：${t('ai.welcome.healthDesc')}`)}
      >
        <span className="ai-health-icon">
          <i className="fa-solid fa-stethoscope" />
        </span>
        <div className="ai-health-body">
          <div className="ai-health-title">{t('ai.welcome.healthTitle')}</div>
          <div className="ai-health-desc">{t('ai.welcome.healthDesc')}</div>
        </div>
        <i className="fa-solid fa-arrow-right ai-health-arrow" />
      </div>
      <div className="ai-skill-lbl">{t('ai.welcome.skills')}</div>
      <div className="ai-skill-grid">
        {skills.map((s) => (
          <div key={s.id} className="ai-skill-card" onClick={() => run(t(s.nameKey), s.id)}>
            <div className="ai-skill-card-hd">
              <i className={`fa-solid ${s.icon} ai-skill-card-icon`} />
              <span className="ai-skill-card-name">{t(s.nameKey)}</span>
              <TagChip text={s.tag} cls={s.tag} />
            </div>
            <div className="ai-skill-card-desc">{t(s.descKey)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
