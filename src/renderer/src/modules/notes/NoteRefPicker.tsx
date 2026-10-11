// 关联选择器:从当前**真实的**三个域里挑对象挂到笔记上。
//
// 挂到根级(App.tsx)—— rail 与编辑区都是 overflow:auto,挂里面会被裁掉。
// 数据取自各域已加载的 store,不额外发 IPC:用户要挂的必然是刚刚在界面上看到的那一个。

import { useEffect, useMemo, useState } from 'react'
import type { NoteRef } from '@shared/notes'
import { Modal } from '../../components/Modal'
import { EmptyState } from '../../components/ui/EmptyState'
import { useT } from '../../hooks/useT'
import { EMPTY_OVERRIDES, refForAgent, refForCron, refForService } from '../../lib/note-refs'
import { serviceIdentityKey } from '@shared/service-identity'
import { useAgentsStore } from '../../state/agents-store'
import { useCronStore } from '../../state/cron-store'
import { useNoteRefPickerStore } from '../../state/note-ref-picker-store'
import { useNotesStore } from '../../state/notes-store'
import { useServicesStore } from '../../state/services-store'
import { useSettingsStore } from '../../state/settings-store'
import { showToast } from '../../lib/utils'

const EMPTY_REFS: NoteRef[] = []

const PANEL_W = 460
const PANEL_H = 520

interface Row {
  ref: NoteRef
  /** 第二行:作用域 / 表达式 / host:port —— 帮用户区分同名项 */
  sub: string
  icon: string
}

export function NoteRefPicker(): React.JSX.Element {
  const t = useT()
  const open = useNoteRefPickerStore((s) => s.open)
  const x = useNoteRefPickerStore((s) => s.x)
  const y = useNoteRefPickerStore((s) => s.y)
  const close = useNoteRefPickerStore((s) => s.close)

  const agents = useAgentsStore((s) => s.agents)
  const crons = useCronStore((s) => s.crons)
  const services = useServicesStore((s) => s.services)
  const overrides = useSettingsStore((s) => s.settings?.serviceOverrides ?? EMPTY_OVERRIDES)
  const addRef = useNotesStore((s) => s.addRef)
  // ⚠ 空数组兜底必须是同一个引用:内联 `?? []` 会让选择器每次返回新数组 → 无限重渲染
  const existing = useNotesStore((s) => s.draft?.refs ?? EMPTY_REFS)

  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) {
      setQ('')
      setPicked(new Set())
    }
  }, [open])

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase()
    const hit = (...fields: string[]): boolean =>
      s === '' || fields.some((f) => f.toLowerCase().includes(s))

    const agentRows: Row[] = agents
      .filter((a) => hit(a.label, a.fileName ?? '', a.program))
      .map((a) => ({ ref: refForAgent(a), sub: a.scope, icon: 'fa-solid fa-rocket' }))

    const cronRows: Row[] = crons
      .filter((j) => hit(j.desc, j.cmd, j.expr))
      .map((j) => ({ ref: refForCron(j), sub: `${j.expr} · ${j.cmd}`, icon: 'fa-regular fa-clock' }))

    const svcRows: Row[] = services
      .filter((sv) => hit(sv.name, sv.cmd, sv.command, String(sv.port)))
      .map((sv) => ({
        ref: refForService(sv, overrides[serviceIdentityKey(sv)]),
        sub: `${sv.addr === '*' || sv.addr === '' ? '127.0.0.1' : sv.addr}:${sv.port}`,
        icon: 'fa-solid fa-network-wired'
      }))

    return [
      { key: 'agent', title: t('notes.ref.picker.groupAgent'), rows: agentRows },
      { key: 'cron', title: t('notes.ref.picker.groupCron'), rows: cronRows },
      { key: 'service', title: t('notes.ref.picker.groupService'), rows: svcRows }
    ].filter((g) => g.rows.length > 0)
  }, [agents, crons, services, overrides, q, t])

  const already = new Set(existing.map((r) => `${r.type}:${r.key}`))
  const total = groups.reduce((n, g) => n + g.rows.length, 0)

  const left = Math.min(x, window.innerWidth - PANEL_W - 12)
  const top = Math.min(y, window.innerHeight - PANEL_H - 12)

  function confirm(): void {
    let added = 0
    for (const g of groups) {
      for (const row of g.rows) {
        const id = `${row.ref.type}:${row.ref.key}`
        if (!picked.has(id) || already.has(id)) continue
        addRef(row.ref)
        added++
      }
    }
    close()
    if (added > 0) showToast(t('toast.noteRefAdded'), '#4ade80', 'fa-link')
  }

  return (
    <Modal id="noteRefPicker" open={open} onClose={close}>
      <div className="note-ref-picker" style={{ left, top, width: PANEL_W, maxHeight: PANEL_H }}>
        <div className="note-ref-picker-hd">
          <i className="fa-solid fa-link" />
          <span>{t('notes.ref.picker.title')}</span>
          <button type="button" className="modal-close" onClick={close} title={t('common.close')}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="note-ref-picker-search">
          <i className="fa-solid fa-magnifying-glass" />
          <input
            autoFocus
            value={q}
            placeholder={t('notes.ref.picker.search')}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="note-ref-picker-body">
          {total === 0 && <EmptyState icon="fa-regular fa-face-meh" text={t('notes.ref.picker.empty')} />}
          {groups.map((g) => (
            <div key={g.key} className="note-ref-picker-group">
              <div className="note-ref-picker-group-title">{g.title}</div>
              {g.rows.map((row) => {
                const id = `${row.ref.type}:${row.ref.key}`
                const isAlready = already.has(id)
                return (
                  <label key={id} className={'note-ref-picker-row' + (isAlready ? ' disabled' : '')}>
                    <input
                      type="checkbox"
                      disabled={isAlready}
                      checked={picked.has(id)}
                      onChange={(e) => {
                        const next = new Set(picked)
                        if (e.target.checked) next.add(id)
                        else next.delete(id)
                        setPicked(next)
                      }}
                    />
                    <i className={row.icon} />
                    <span className="note-ref-picker-label">{row.ref.label}</span>
                    <span className="note-ref-picker-sub">{isAlready ? t('notes.ref.picker.added') : row.sub}</span>
                  </label>
                )
              })}
            </div>
          ))}
        </div>
        <div className="note-ref-picker-ft">
          <button type="button" className="d-btn" onClick={close}>
            <span>{t('common.cancel')}</span>
          </button>
          <button type="button" className="d-btn accent" disabled={picked.size === 0} onClick={confirm}>
            <span>{picked.size > 0 ? t('notes.ref.picker.addN').replace('{N}', String(picked.size)) : t('notes.ref.picker.add')}</span>
          </button>
        </div>
      </div>
    </Modal>
  )
}
