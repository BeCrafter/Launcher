// ported-from: docs/demo/js/ai.js aiEnsureMentionPop/aiMentionBuild/aiPickMention @ 06ff9ba — demo UI 基线
// @ 引用弹层:fixed 定位、挂 body(demo createElement 到 body 的 React 等价物,createPortal)
// 数据源:真实 agents + crons(非 demo MOCK_DATA);过滤规则逐行对应 aiMentionBuild
import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../hooks/useT'
import { StatusDot } from '../../components/ui/StatusDot'
import { useAgentsStore } from '../../state/agents-store'
import { useCronStore } from '../../state/cron-store'
import type { AiMention } from '@shared/ai'

export function AiMentionPopover({
  open,
  btnMode,
  query,
  anchorRef,
  onPick,
  onClose
}: {
  open: boolean
  /** true = 由 @ 按钮打开(不过滤,列全部) */
  btnMode: boolean
  query: string
  anchorRef: React.RefObject<HTMLButtonElement | null>
  onPick: (m: AiMention) => void
  onClose: () => void
}): React.JSX.Element | null {
  const t = useT()
  const agents = useAgentsStore((s) => s.agents)
  const crons = useCronStore((s) => s.crons)
  const loadAgents = useAgentsStore((s) => s.load)
  const loadCrons = useCronStore((s) => s.load)
  const popRef = useRef<HTMLDivElement | null>(null)

  // 首开兜底加载(bootstrap 已预载;这里防手动刷新后的空列表)
  useEffect(() => {
    if (!open) return
    if (agents.length === 0) void loadAgents().catch(() => {})
    if (crons.length === 0) void loadCrons().catch(() => {})
  }, [open, agents.length, crons.length, loadAgents, loadCrons])

  // 外点关闭(demo document click 委托;锚点按钮自身点击由调用方 toggle,这里放行)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      const el = e.target as HTMLElement | null
      if (el?.closest('#aiMentionPop') || el?.closest('#aiMentionBtn')) return
      onClose()
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [open, onClose])

  const { agentHits, cronHits } = useMemo(() => {
    // 按钮模式/无 @ 查询词时不过滤(demo aiMentionBuild force 分支)
    const low = btnMode ? '' : query.trim().toLowerCase()
    const a = agents.filter(
      (ag) =>
        !ag.isNotTask &&
        ag.label !== '' &&
        (!low || ag.label.toLowerCase().includes(low) || ag.desc.toLowerCase().includes(low))
    )
    const c = crons.filter(
      (cr) => !low || (cr.desc || '').toLowerCase().includes(low) || cr.expr.includes(low)
    )
    return { agentHits: a, cronHits: c }
  }, [agents, crons, btnMode, query])

  // 定位:跟随锚点按钮(demo aiMentionOpen;窗宽内取 max(10, left),贴按钮上缘 8px)
  if (!open) return null
  const r = anchorRef.current?.getBoundingClientRect()
  const style: React.CSSProperties = r
    ? { left: Math.max(10, r.left), bottom: window.innerHeight - r.top + 8, top: 'auto' }
    : { left: 10, bottom: 80, top: 'auto' }

  const pickAgent = (a: (typeof agents)[number]): void =>
    onPick({ key: `agent:${a.id}`, type: 'agent', id: a.id, label: a.label, scope: a.scope })
  const pickCron = (c: (typeof crons)[number]): void =>
    onPick({ key: `cron:${c.id}`, type: 'cron', id: c.id, label: c.desc || c.expr })

  const body: React.ReactNode[] = []
  if (agentHits.length) {
    body.push(
      <div className="ai-mention-lbl" key="lbl-agents">
        {t('ai.mention.section.agents')}
      </div>,
      agentHits.map((a) => (
        <div className="ai-mention-item" key={a.id} onClick={() => pickAgent(a)}>
          <StatusDot status={a.status} />
          <span>{a.label}</span>
          <span className="ai-mention-sub">{(a.program || '').replace(/^.*\//, '')}</span>
        </div>
      ))
    )
  }
  if (cronHits.length) {
    body.push(
      <div className="ai-mention-lbl" key="lbl-crons">
        {t('ai.mention.section.crons')}
      </div>,
      cronHits.map((c) => (
        <div className="ai-mention-item" key={c.id} onClick={() => pickCron(c)}>
          <i className="fa-regular fa-clock" />
          <span>{c.desc || c.cmd}</span>
          <span className="ai-mention-sub">{c.expr}</span>
        </div>
      ))
    )
  }

  return createPortal(
    <div className="ai-mention-pop open" id="aiMentionPop" ref={popRef} style={style}>
      {body.length ? body : <div className="ai-mention-empty">{t('ai.mention.empty')}</div>}
    </div>,
    document.body
  )
}
