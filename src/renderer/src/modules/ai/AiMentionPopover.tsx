// @ 引用弹层:fixed 定位、挂 body(demo createElement 到 body 的 React 等价物,createPortal)
// 数据源:真实 agents + crons + 笔记;过滤规则对应 aiMentionBuild
//
// 两种选法并存,别把它们合成一种:
//   · **点行本体** = 立刻引用这一项并关掉弹层(原有手感,选一个就走);
//   · **点行首的勾选框** = 攒进待选区、弹层不关,攒够了按底部那颗按钮一次挂上。
// 后者是为「同时引用多篇笔记」加的:一个个 @ 十次太慢,而把点行改成勾选又会毁掉前者的干脆。
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../hooks/useT'
import { StatusDot } from '../../components/ui/StatusDot'
import { useAgentsStore } from '../../state/agents-store'
import { useCronStore } from '../../state/cron-store'
import { useNotesStore } from '../../state/notes-store'
import { dataSource } from '../../data'
import { mentionIcon } from '../../lib/ai-mention-icon'
import { fmt } from '../../i18n'
import type { Agent } from '@shared/models'
import type { NoteMeta } from '@shared/notes'
import type { AiMention } from '@shared/ai'

/** 正文检索要打 IPC,给个门槛与防抖;短词(一两个字)命中的太多,反而淹掉按标题找的那几个 */
const FULLTEXT_MIN = 2
const FULLTEXT_DEBOUNCE_MS = 200
const FULLTEXT_LIMIT = 20
/** 每个分组最多渲染几行(笔记可以上千篇;弹层不是列表页,截断 + 提示继续输入) */
const MAX_ROWS = 30

interface Row {
  mention: AiMention
  label: string
  sub: string
  /** 图标类(fa-*);agent 行用状态点,不设它 */
  icon?: string
  /** agent 行的状态点 */
  status?: Agent['status']
}

export function AiMentionPopover({
  open,
  btnMode,
  query,
  anchorRef,
  picked,
  onPick,
  onPickMany,
  onClose
}: {
  open: boolean
  /** true = 由 @ 按钮打开(不过滤,列全部) */
  btnMode: boolean
  query: string
  anchorRef: React.RefObject<HTMLButtonElement | null>
  /** 已经引用上的(行上标「已引用」并禁用) */
  picked: AiMention[]
  onPick: (m: AiMention) => void
  /** 一次挂上多项(底部那颗按钮) */
  onPickMany: (ms: AiMention[]) => void
  onClose: () => void
}): React.JSX.Element | null {
  const t = useT()
  const agents = useAgentsStore((s) => s.agents)
  const crons = useCronStore((s) => s.crons)
  const notes = useNotesStore((s) => s.notes)
  const loadAgents = useAgentsStore((s) => s.load)
  const loadCrons = useCronStore((s) => s.load)
  const loadNotes = useNotesStore((s) => s.load)
  const popRef = useRef<HTMLDivElement | null>(null)

  /** 待选区(勾选框攒起来的 key) */
  const [checked, setChecked] = useState<Set<string>>(new Set())
  /** 正文命中的笔记(本地过滤只看得到标题/标签/摘要,正文要靠检索) */
  const [fullTextHits, setFullTextHits] = useState<NoteMeta[]>([])

  // 首开兜底加载(bootstrap 已预载;这里防手动刷新后的空列表)
  useEffect(() => {
    if (!open) return
    if (agents.length === 0) void loadAgents().catch(() => {})
    if (crons.length === 0) void loadCrons().catch(() => {})
    if (notes.length === 0) void loadNotes().catch(() => {})
  }, [open, agents.length, crons.length, notes.length, loadAgents, loadCrons, loadNotes])

  // 每次开合都从干净的待选区开始(关掉就是放弃这次挑选)
  useEffect(() => {
    setChecked(new Set())
    setFullTextHits([])
  }, [open])

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

  const low = btnMode ? '' : query.trim().toLowerCase()

  // 笔记正文检索(带防抖与过期丢弃;只有它需要走 IPC,本地过滤覆盖标题/标签/摘要)
  useEffect(() => {
    if (!open || low.length < FULLTEXT_MIN) {
      setFullTextHits([])
      return
    }
    let alive = true
    const timer = setTimeout(() => {
      void dataSource()
        .notes.search(low, FULLTEXT_LIMIT)
        .then((hits) => {
          if (alive) setFullTextHits(hits)
        })
        .catch(() => {
          /* 检索失败就只按本地过滤的结果列,不打扰用户 */
        })
    }, FULLTEXT_DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [open, low])

  const groups = useMemo(() => {
    const hit = (...fields: string[]): boolean =>
      low === '' || fields.some((f) => f.toLowerCase().includes(low))

    const agentRows: Row[] = agents
      .filter((a) => !a.isNotTask && a.label !== '' && hit(a.label, a.desc, a.fileName ?? ''))
      .map((a) => ({
        mention: { key: `agent:${a.id}`, type: 'agent' as const, id: a.id, label: a.label, scope: a.scope },
        label: a.label,
        sub: (a.program || '').replace(/^.*\//, ''),
        status: a.status
      }))

    const cronRows: Row[] = crons
      .filter((cr) => hit(cr.desc || '', cr.cmd, cr.expr))
      .map((cr) => ({
        mention: { key: `cron:${cr.id}`, type: 'cron' as const, id: cr.id, label: cr.desc || cr.cmd },
        label: cr.desc || cr.cmd,
        sub: cr.expr,
        icon: 'fa-regular fa-clock'
      }))

    // 本地能命中的(标题/路径/标签/摘要)+ 正文命中的,按 id 去重
    const noteRows: Row[] = []
    const seen = new Set<string>()
    const pushNote = (n: NoteMeta, byContent: boolean): void => {
      if (seen.has(n.id)) return
      seen.add(n.id)
      noteRows.push({
        mention: { key: `note:${n.id}`, type: 'note', id: n.id, label: n.title },
        label: n.title,
        sub: byContent ? t('ai.mention.noteByContent') : n.id,
        icon: 'fa-solid fa-note-sticky'
      })
    }
    for (const n of notes) {
      if (hit(n.title, n.id, ...n.tags, n.excerpt)) pushNote(n, false)
    }
    for (const n of fullTextHits) pushNote(n, true)

    return [
      { key: 'note', title: t('ai.mention.section.notes'), rows: noteRows },
      { key: 'agent', title: t('ai.mention.section.agents'), rows: agentRows },
      { key: 'cron', title: t('ai.mention.section.crons'), rows: cronRows }
    ]
      .filter((g) => g.rows.length > 0)
      // 笔记可能有上千篇:全渲染出来会把弹层拖垮,截断并如实说明还剩多少
      .map((g) => ({ ...g, rows: g.rows.slice(0, MAX_ROWS), more: Math.max(0, g.rows.length - MAX_ROWS) }))
  }, [agents, crons, notes, fullTextHits, low, t])

  // 定位:跟随锚点按钮(demo aiMentionOpen;窗宽内取 max(10, left),贴按钮上缘 8px)
  if (!open) return null
  const r = anchorRef.current?.getBoundingClientRect()
  const style: React.CSSProperties = r
    ? { left: Math.max(10, r.left), bottom: window.innerHeight - r.top + 8, top: 'auto' }
    : { left: 10, bottom: 80, top: 'auto' }

  const already = new Set(picked.map((m) => m.key))
  const byKey = new Map<string, Row>()
  for (const g of groups) for (const row of g.rows) byKey.set(row.mention.key, row)

  const toggle = (key: string): void => {
    setChecked((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const confirmMany = (): void => {
    const ms: AiMention[] = []
    for (const key of checked) {
      const row = byKey.get(key)
      if (row && !already.has(key)) ms.push(row.mention)
    }
    if (ms.length > 0) onPickMany(ms)
    onClose()
  }

  const rowNode = (row: Row): React.JSX.Element => {
    const isAlready = already.has(row.mention.key)
    const isChecked = checked.has(row.mention.key)
    return (
      <div
        key={row.mention.key}
        className={'ai-mention-item' + (isAlready ? ' disabled' : '') + (isChecked ? ' checked' : '')}
        onClick={() => {
          if (!isAlready) onPick(row.mention)
        }}
      >
        {/* 勾选框:阻止冒泡,否则会把「攒多项」变成「立刻引用这一项」 */}
        <input
          type="checkbox"
          className="ai-mention-check"
          tabIndex={-1}
          disabled={isAlready}
          checked={isChecked}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggle(row.mention.key)}
        />
        {row.status !== undefined ? (
          <StatusDot status={row.status} />
        ) : (
          // row.icon 自带 fa-regular / fa-solid 前缀(时钟是 regular 才好看),不要替它拼
          <i className={row.icon ?? `fa-solid ${mentionIcon(row.mention.type)}`} />
        )}
        <span className="ai-mention-name">{row.label}</span>
        <span className="ai-mention-sub">{isAlready ? t('ai.mention.added') : row.sub}</span>
      </div>
    )
  }

  const body: React.ReactNode[] = []
  for (const g of groups) {
    body.push(
      <div className="ai-mention-lbl" key={`lbl-${g.key}`}>
        {g.title}
      </div>
    )
    body.push(...g.rows.map(rowNode))
    if (g.more > 0) {
      body.push(
        <div className="ai-mention-more" key={`more-${g.key}`}>
          {fmt(t('ai.mention.more'), { N: String(g.more) })}
        </div>
      )
    }
  }

  return createPortal(
    <div className="ai-mention-pop open" id="aiMentionPop" ref={popRef} style={style}>
      {body.length ? body : <div className="ai-mention-empty">{t('ai.mention.empty')}</div>}
      {checked.size > 0 && (
        <div className="ai-mention-foot">
          <button type="button" className="d-btn accent" onClick={confirmMany}>
            <span>{fmt(t('ai.mention.pickN'), { N: String(checked.size) })}</span>
          </button>
        </div>
      )}
    </div>,
    document.body
  )
}
