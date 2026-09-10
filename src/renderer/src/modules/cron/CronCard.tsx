// ported-from: docs/demo/js/crontab.js 卡片/内联编辑面板 + index.html #cronGrid 嵌套 @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// Cron 卡片(demo renderCron 卡片 markup + row-expand hover 详情 + cron-edit-expand 内联编辑)
// #cronGrid > .cron-cell > (.cron-col-card + .row-expand + .cron-edit-expand) 嵌套为 CSS hover 契约,逐字保留
import { useMemo, useState } from 'react'
import { useT } from '../../hooks/useT'
import { StatusDot } from '../../components/ui/StatusDot'
import { TagChip } from '../../components/ui/TagChip'
import { ActBtn } from '../../components/ui/ActBtn'
import { Toggle } from '../../components/ui/Toggle'
import { parseCronExpr } from '../../lib/cron'
import { cronLogPath } from '../../data/mock/mock-source'
import { MOCK_DATA } from '../../data/mock/mock-data'
import { copyText, showToast } from '../../lib/utils'
import { useCronStore } from '../../state/cron-store'
import { useSettingsStore } from '../../state/settings-store'
import { useUiStore } from '../../state/ui-store'
import { cronLogDrawer } from './CronLogDrawer'
import { ELEVATION, confirmDangerous } from '../../lib/elevation'
import type { CronJob } from '@shared/models'

const FIELDS = ['Min', 'Hour', 'Dom', 'Mon', 'Dow'] as const

export function CronCard({ job }: { job: CronJob }): React.JSX.Element {
  const t = useT()
  const lang = useSettingsStore((s) => s.settings?.language ?? 'zh-CN')
  const editingId = useCronStore((s) => s.editingId)
  const setEditingId = useCronStore((s) => s.setEditingId)
  const setEnabled = useCronStore((s) => s.setEnabled)
  const setLog = useCronStore((s) => s.setLog)
  const save = useCronStore((s) => s.save)
  const remove = useCronStore((s) => s.remove)
  const cronDesc = useMemo(() => parseCronExpr(job.expr, lang, t), [job.expr, lang, t])

  // 内联编辑字段(demo 由 DOM 输入框直接承载;React 收敛为本地 state)
  const [fields, setFields] = useState(job.expr.split(' '))
  const [cmd, setCmd] = useState(job.cmd)
  const [desc, setDesc] = useState(job.desc)
  const [presetActive, setPresetActive] = useState<string | null>(null)
  const isEditing = editingId === job.id

  const openEdit = (): void => {
    setFields(job.expr.split(' '))
    setCmd(job.cmd)
    setDesc(job.desc)
    setPresetActive(null)
    setEditingId(isEditing ? null : job.id)
    // demo toggleCronEdit:滚动让面板进入可视区
    setTimeout(() => {
      const el = document.getElementById('cronEdit_' + job.id)
      const scrollBox = el?.closest('.list-container') as HTMLElement | null
      const card = el?.closest('.cron-col-card')
      if (el && scrollBox && card) {
        scrollBox.scrollTop += card.getBoundingClientRect().top - scrollBox.getBoundingClientRect().top - 12
      }
    }, 100)
  }

  const applyPreset = (expr: string): void => {
    setFields(expr.split(' '))
    setPresetActive(expr)
  }

  const liveExpr = fields.map((f) => f || '*').join(' ')
  const liveDesc = parseCronExpr(liveExpr, lang, t)

  const onSave = async (): Promise<void> => {
    if (job.system) {
      const ok = await ELEVATION.request({
        detail: t('elev.cron.detail'),
        command: `osascript -e 'do shell script "crontab -l > /tmp/crontab.bak" with administrator privileges'`
      })
      if (!ok) return
    }
    await save(job.id, { expr: liveExpr, cmd, desc })
  }

  const onDelete = async (): Promise<void> => {
    if (job.system) {
      const confirmed = await confirmDangerous.request(t('elev.cron.detail') + '（/etc/crontab）')
      if (!confirmed) return
      const ok = await ELEVATION.request({
        detail: t('elev.cron.detail'),
        command: `osascript -e 'do shell script "crontab -r" with administrator privileges'`
      })
      if (!ok) return
    }
    await remove(job.id)
  }

  const copyPath = async (): Promise<void> => {
    await copyText(cronLogPath(job.id))
    showToast(t('toast.pathCopied'), '#22d3ee', 'fa-copy')
  }

  const viewLog = (): void => {
    useUiStore.getState().openOverlay('cronLogDrawer')
    cronLogDrawer.emit(job.id)
  }

  return (
    <div className="cron-cell">
      <div className="cron-col-card">
        <div className="cron-r1">
          <StatusDot status={job.enabled ? 'running' : 'stopped'} />
          <span className="cron-cmd" title={job.cmd}>
            {job.cmd}
          </span>
          <label className="toggle" title={job.enabled ? t('cron.disable') : t('cron.enable')}>
            <input
              type="checkbox"
              checked={job.enabled}
              onChange={(e) => void setEnabled(job.id, e.target.checked)}
            />
            <div className="toggle-track" />
            <div className="toggle-thumb" />
          </label>
        </div>
        <div className="cron-desc">{job.desc}</div>
        <div className="cron-repeat">
          <span className="cron-repeat-text">{cronDesc}</span>
          <span className="cron-repeat-tags">
            <TagChip text={job.user} cls="blue" />
            <TagChip text={job.system ? t('cron.tag.systemEtc') : t('cron.tag.user')} cls={job.system ? 'red' : 'blue'} />
          </span>
        </div>
        <div className="cron-r4">
          <span className="cron-expr" title={job.expr}>
            {job.expr}
          </span>
          <div className="row-actions" onClick={(e) => e.stopPropagation()}>
            <ActBtn icon={isEditing ? 'fa-solid fa-xmark' : 'fa-solid fa-pen'} opts={{ cls: 'accent', title: t('cron.edit'), onPress: openEdit }} />
            <ActBtn icon="fa-solid fa-trash-can" opts={{ cls: 'red', title: t('cron.delete'), onPress: () => void onDelete() }} />
          </div>
        </div>
      </div>

      {/* hover 详情(demo 纯 CSS hover 契约) */}
      <div className="row-expand" id={`exp_cron_${job.id}`}>
        <div className="cron-log-block">
          <div className="expand-field" style={{ marginBottom: 8 }}>
            <div className="expand-key">{t('cron.log.path')}</div>
            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} className="expand-val">
              {job.log ? cronLogPath(job.id) : t('cron.log.no')}
            </div>
          </div>
          <div className="cron-log-row" style={{ display: job.log ? 'flex' : 'none', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--dim)' }}>{t('cron.log.retainHint')}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="d-btn blue" type="button" style={{ padding: '4px 10px', fontSize: 10.5 }} disabled={!job.log} onClick={() => void copyPath()}>
                <i className="fa-solid fa-copy" /> <span>{t('cron.log.copyPath')}</span>
              </button>
              <button className="d-btn accent" type="button" style={{ padding: '4px 10px', fontSize: 10.5 }} disabled={!job.log} onClick={viewLog}>
                <i className="fa-solid fa-scroll" /> <span>{t('cron.log.view')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 内联编辑面板 */}
      <div className={`cron-edit-expand${isEditing ? ' open' : ''}`} id={`cronEdit_${job.id}`}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>
          <i className="fa-regular fa-clock" style={{ color: 'var(--accent2)', marginRight: 5 }} />
          {t('cron.editTitle')}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 6, fontWeight: 600 }}>{t('cron.quickPreset')}</div>
        <div className="cron-preset-row" id={`cronPresets_${job.id}`}>
          {MOCK_DATA.cronPresets.map((p) => (
            <button
              key={p.expr}
              type="button"
              className={`cron-preset-chip ${(presetActive ?? job.expr) === p.expr && presetActive !== null ? 'active' : ''}`}
              onClick={() => applyPreset(p.expr)}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
        <div className="cron-expr-preview" id={`cronExprPreview_${job.id}`}>
          <i className="fa-regular fa-clock" style={{ color: 'var(--cyan)', fontSize: 13, flexShrink: 0 }} />
          <code id={`cronExprCode_${job.id}`}>{liveExpr}</code>
          <span className="cron-expr-desc" id={`cronExprDescText_${job.id}`}>{liveDesc}</span>
        </div>
        <div className="cron-edit-grid">
          {FIELDS.map((f, i) => (
            <div className="f-row center" key={f}>
              <span className="f-lbl" style={{ width: 60 }}>{t('cron.field.' + ['minute', 'hour', 'day', 'month', 'dow'][i])}</span>
              <input
                className="f-input mono"
                type="text"
                value={fields[i] ?? '*'}
                onChange={(e) => {
                  const next = [...fields]
                  next[i] = e.target.value
                  setFields(next)
                }}
              />
            </div>
          ))}
        </div>
        <div className="f-row center" style={{ marginBottom: 8 }}>
          <span className="f-lbl" style={{ width: 60 }}>{t('cron.field.cmd')}</span>
          <input className="f-input mono" type="text" value={cmd} onChange={(e) => setCmd(e.target.value)} />
        </div>
        <div className="f-row center" style={{ marginBottom: 8 }}>
          <span className="f-lbl" style={{ width: 60 }}>{t('cron.field.desc')}</span>
          <input className="f-input" type="text" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <div className="f-row center">
          <span className="f-lbl" style={{ width: 60 }}>{t('cron.log.label')}</span>
          <Toggle checked={!!job.log} onChange={(v) => void setLog(job.id, v)} />
          <span style={{ fontSize: 10, color: 'var(--dim)', flex: 1, minWidth: 0 }}>{t('cron.log.hint')}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7, marginTop: 12 }}>
          <button className="d-btn" type="button" onClick={() => setEditingId(null)}>
            <i className="fa-solid fa-xmark" /> {t('common.cancel')}
          </button>
          <button className="d-btn accent" type="button" onClick={() => void onSave()}>
            <i className="fa-solid fa-check" /> {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
