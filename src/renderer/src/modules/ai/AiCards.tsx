// 内联领域卡(report/cron/plist/approve)+ 追问建议 chips
// 授权卡与 demo 的机制差异:demo 是内容里的卡自己续播;真实链路是 main 的 beforeToolCall 暂停工具调用,
// 卡片按钮只负责 respondApproval,执行与状态落定都由 main 的事件驱动
import { useState } from 'react'
import { useT } from '../../hooks/useT'
import { getCurrentLang } from '../../i18n'
import { parseCronExpr } from '../../lib/cron'
import { confirmDangerous } from '../../lib/elevation'
import { Chip } from '../../components/ui/Chip'
import { copyText, showToast } from '../../lib/utils'
import { useAiStore } from '../../state/ai-store'
import { useUiStore } from '../../state/ui-store'
import type { AiAgentPreparationCard, AiApproveCard, AiCronCard, AiDomainCard, AiPlistCard, AiReportCard } from '@shared/ai'

export function AiCard({
  card,
  pendingToolCallId
}: {
  card: AiDomainCard
  /** 与待应答表配对的 toolCallId(approve 卡专用;null = 无配对,按钮禁用) */
  pendingToolCallId: string | null
}): React.JSX.Element | null {
  switch (card.kind) {
    case 'report':
      return <ReportCard card={card} />
    case 'cron':
      return <CronCard card={card} />
    case 'plist':
      return <PlistCard card={card} />
    case 'agentPreparation':
      return <AgentPreparationCard card={card} />
    case 'approve':
      return <ApproveCard card={card} pendingToolCallId={pendingToolCallId} />
    default:
      return null
  }
}

// ── 系统体检报告 ──

const REPORT_ICONS: Record<string, string> = {
  ok: 'fa-circle-check',
  warn: 'fa-triangle-exclamation',
  err: 'fa-circle-xmark'
}

function ReportCard({ card }: { card: AiReportCard }): React.JSX.Element {
  const t = useT()
  const switchModule = useUiStore((s) => s.switchModule)
  return (
    <div className="ai-card">
      <div className="ai-card-hd">
        <i className="fa-solid fa-clipboard-check" style={{ color: 'var(--accent2)' }} />
        {t('ai.report.title')}
      </div>
      {card.items.map((it, i) => (
        <div className={`ai-report-item ${it.level}`} key={i}>
          <i className={`fa-solid ${REPORT_ICONS[it.level] ?? 'fa-circle-info'}`} />
          <span>{it.text}</span>
          {it.goto && (
            <button className="d-btn accent ai-report-go" type="button" onClick={() => switchModule(it.goto!)}>
              <span>{t('ai.report.goto')}</span>
              <i className="fa-solid fa-arrow-right" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ── 建议的定时任务 ──

function CronCard({ card }: { card: AiCronCard }): React.JSX.Element {
  const t = useT()
  const lang = getCurrentLang()
  return (
    <div className="ai-card">
      <div className="ai-card-hd">
        <i className="fa-solid fa-clock" style={{ color: 'var(--accent2)' }} />
        {t('ai.cron.title')}
      </div>
      <div className="ai-code">{card.cmd}</div>
      <div className="ai-cron-row">
        <i className="fa-solid fa-calendar-day" />
        <span>{t('ai.cron.schedule')}</span>
        <span className="ai-cron-expr">{card.expr}</span>
        <span style={{ color: 'var(--dim)' }}>·</span>
        <span>{parseCronExpr(card.expr, lang, t)}</span>
      </div>
    </div>
  )
}

// ── plist 配置草稿 ──

function PlistCard({ card }: { card: AiPlistCard }): React.JSX.Element {
  const t = useT()
  const switchModule = useUiStore((s) => s.switchModule)
  const onCopy = (): void => {
    void copyText(card.xml).then(() => showToast(t('toast.xmlCopied'), '#22d3ee', 'fa-copy'))
  }
  return (
    <div className="ai-card">
      <div className="ai-card-hd">
        <i className="fa-solid fa-file-code" style={{ color: 'var(--accent2)' }} />
        {t('ai.plist.title')}
        {card.path && <span className="ai-card-sub">{card.path}</span>}
      </div>
      <div className="ai-code">{card.xml}</div>
      <div className="ai-card-actions">
        <button className="d-btn" type="button" onClick={onCopy}>
          <i className="fa-solid fa-copy" />
          <span>{t('xml.copy')}</span>
        </button>
        <button className="d-btn accent" type="button" onClick={() => switchModule('agents')}>
          <i className="fa-solid fa-arrow-up-right-from-square" />
          <span>{t('ai.plist.open')}</span>
        </button>
      </div>
    </div>
  )
}

// ── Agent 创建准备计划（只读，不执行）──

function AgentPreparationCard({ card }: { card: AiAgentPreparationCard }): React.JSX.Element {
  const t = useT()
  const blocked = card.readiness === 'blocked'
  const Section = ({ title, items, cls }: { title: string; items: string[]; cls?: string }): React.JSX.Element | null =>
    items.length === 0 ? null : (
      <div className={`ai-plan-section${cls ? ` ${cls}` : ''}`}>
        <div className="ai-plan-section-title">{title}</div>
        {items.map((item, index) => (
          <div className="ai-plan-item" key={`${title}-${index}`}>
            <i className={`fa-solid ${cls === 'risk' ? 'fa-triangle-exclamation' : cls === 'question' ? 'fa-circle-question' : 'fa-check'}`} />
            <span>{item}</span>
          </div>
        ))}
      </div>
    )
  return (
    <div className={`ai-card ai-plan${blocked ? ' blocked' : ''}`}>
      <div className="ai-card-hd">
        <i className={`fa-solid ${blocked ? 'fa-triangle-exclamation' : 'fa-route'}`} style={{ color: blocked ? 'var(--yellow)' : 'var(--accent2)' }} />
        {t('ai.plan.title')}
        <span className={`ai-plan-state ${blocked ? 'blocked' : 'ready'}`}>
          {t(blocked ? 'ai.plan.blocked' : 'ai.plan.ready')}
        </span>
      </div>
      <div className="ai-plan-target">
        <span>{card.label}</span>
        <span>{card.scope}</span>
      </div>
      <div className="ai-appr-cmd">{card.command}</div>
      <div className="ai-plan-summary">
        <div><span>{t('ai.plan.trigger')}</span>{card.trigger}</div>
        <div><span>{t('ai.plan.logs')}</span>{card.logs.length > 0 ? card.logs.join(' / ') : t('ai.plan.noLogs')}</div>
        {card.port && <div><span>{t('ai.plan.port')}</span>{card.port.value} · {card.port.detail}</div>}
      </div>
      <Section title={t('ai.plan.risks')} items={card.risks} cls="risk" />
      <Section title={t('ai.plan.questions')} items={card.questions} cls="question" />
      <Section title={t('ai.plan.verify')} items={card.verification} />
      <div className="ai-plan-hint">{t('ai.plan.hint')}</div>
    </div>
  )
}

// ── 写操作授权卡 ──

function ApproveCard({
  card,
  pendingToolCallId
}: {
  card: AiApproveCard
  pendingToolCallId: string | null
}): React.JSX.Element {
  const t = useT()
  const respond = useAiStore((s) => s.respondApproval)
  const [busy, setBusy] = useState(false)
  const icon = card.dangerous ? 'fa-triangle-exclamation' : 'fa-shield-halved'

  const onApprove = async (): Promise<void> => {
    if (!pendingToolCallId || busy) return
    // 危险操作先走应用内二次确认(demo confirmDangerousAction;系统级授权由工具执行时 osascript 负责)
    if (card.dangerous) {
      setBusy(true)
      const ok = await confirmDangerous.request(card.detail)
      setBusy(false)
      if (!ok) return
    }
    void respond(pendingToolCallId, 'approve')
  }

  const onCancel = (): void => {
    if (!pendingToolCallId || busy) return
    void respond(pendingToolCallId, 'cancel')
  }

  let foot: React.JSX.Element
  if (card.state === 'pending') {
    foot = (
      <div className="ai-card-actions">
        <button className="d-btn accent" type="button" disabled={!pendingToolCallId || busy} onClick={() => void onApprove()}>
          <i className="fa-solid fa-check" />
          <span>{t('ai.appr.approve')}</span>
        </button>
        <button className="d-btn" type="button" disabled={!pendingToolCallId || busy} onClick={onCancel}>
          <span>{t('ai.appr.cancel')}</span>
        </button>
      </div>
    )
  } else if (card.state === 'approved') {
    foot = (
      <div className="ai-appr-st done">
        <i className="fa-solid fa-circle-check" />
        <span>
          {t('ai.appr.done')} · {card.tool}
        </span>
      </div>
    )
  } else {
    foot = (
      <div className="ai-appr-st cancelled">
        <i className="fa-solid fa-ban" />
        <span>{t('ai.appr.cancelled')}</span>
      </div>
    )
  }

  return (
    <div className="ai-card ai-appr">
      <div className="ai-card-hd">
        <i className={`fa-solid ${icon}`} style={{ color: 'var(--accent2)' }} />
        {t('ai.appr.title')}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>{card.detail}</div>
      <div className="ai-appr-cmd">{card.command}</div>
      {foot}
    </div>
  )
}

// ── 追问建议 ──

export function AiSuggest({ items }: { items: string[] }): React.JSX.Element | null {
  const t = useT()
  const send = useAiStore((s) => s.send)
  if (!items.length) return null
  return (
    <div className="ai-suggest">
      <span className="ai-suggest-lbl">{t('ai.suggest.title')}</span>
      {items.map((s) => (
        <Chip
          key={s}
          label={s}
          onClick={() => {
            // demo aiSendSuggest:运行中忽略;经 store 的用户消息/事件链上屏
            if (useAiStore.getState().runId) return
            void send(s)
          }}
        />
      ))}
    </div>
  )
}
