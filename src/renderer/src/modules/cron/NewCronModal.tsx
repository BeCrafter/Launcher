// ported-from: docs/demo/index.html #newCronModal + modals.js createCronJob @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 新建 Cron 模态(demo newCronModal + createCronJob:预设 chips + 表达式实时预览 + 提权分流)
import { useState } from 'react'
import { useT } from '../../hooks/useT'
import { Modal } from '../../components/Modal'
import { Toggle } from '../../components/ui/Toggle'
import { parseCronExpr, formatNextRun, cronErrorToast } from '../../lib/cron'
import { CRON_PRESETS } from '../../lib/cron-presets'
import { showToast } from '../../lib/utils'
import { useCronStore } from '../../state/cron-store'
import { useSettingsStore } from '../../state/settings-store'
import { useUiStore } from '../../state/ui-store'
import { ELEVATION } from '../../lib/elevation'
import type { CronJob } from '@shared/models'

const FIELDS = [
  { id: 'min', labelKey: 'modal.newCron.field.minute', init: '0' },
  { id: 'hour', labelKey: 'modal.newCron.field.hour', init: '9' },
  { id: 'dom', labelKey: 'modal.newCron.field.day', init: '*' },
  { id: 'mon', labelKey: 'modal.newCron.field.month', init: '*' },
  { id: 'dow', labelKey: 'modal.newCron.field.week', init: '*' }
] as const

export function NewCronModal(): React.JSX.Element {
  const t = useT()
  const lang = useSettingsStore((s) => s.settings?.language ?? 'zh-CN')
  const open = useUiStore((s) => s.overlays.includes('newCronModal'))
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const create = useCronStore((s) => s.create)
  // /etc/crontab 不存在时系统级写入必失败(SIP 禁止在 /etc 下新建,见 crontab-service.ts:25)
  // → 提前置灰入口,避免「填完整张表单、点保存才报错」
  const systemAvailable = useCronStore((s) => s.headers.system.exists)

  const [fields, setFields] = useState<string[]>(FIELDS.map((f) => f.init))
  const [activePreset, setActivePreset] = useState<string | null>('0 9 * * *')
  const [cmd, setCmd] = useState('')
  const [desc, setDesc] = useState('')
  const [scope, setScope] = useState<'user' | 'system'>('user')
  const [log, setLog] = useState(false)

  const expr = fields.map((f) => f || '*').join(' ')
  const exprDesc = desc.trim() || parseCronExpr(expr, lang, t)

  const applyPreset = (expr2: string): void => {
    setFields(expr2.split(' '))
    setActivePreset(expr2)
  }

  const onCreate = async (): Promise<void> => {
    if (!cmd.trim()) {
      showToast(t('toast.requireCommand'), '#f87171', 'fa-circle-exclamation')
      return
    }
    try {
      if (scope === 'system') {
        const ok = await ELEVATION.request({
          detail: t('elev.cron.detail'),
          command: t('elev.cron.cmdCreate')
        })
        if (!ok) return
      }
      const input: Omit<CronJob, 'id'> = {
        user: scope === 'system' ? 'root' : 'user',
        expr,
        cmd: cmd.trim(),
        desc: desc.trim(),
        enabled: true,
        system: scope === 'system',
        log
      }
      await create(input)
      setCmd('')
      setDesc('')
      setLog(false)
      closeOverlay('newCronModal')
    } catch (err) {
      cronErrorToast(err, t)
    }
  }

  return (
    <Modal id="newCronModal" open={open} onClose={() => closeOverlay('newCronModal')}>
      <div className="modal-box" style={{ width: 580 }}>
        <div className="modal-hdr">
          <span className="modal-title">
            <i className="fa-regular fa-clock" style={{ color: 'var(--yellow)', marginRight: 7 }} />
            <span>{t('modal.newCron.title')}</span>
          </span>
          <button className="modal-close" type="button" onClick={() => closeOverlay('newCronModal')}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 2, fontWeight: 600 }}>
            {t('modal.newCron.presetHeader')}
          </div>
          <div className="cron-preset-row" id="newCronPresets" style={{ marginBottom: 10 }}>
            {CRON_PRESETS.map((p) => (
              <button
                key={p.expr}
                type="button"
                className={`cron-preset-chip${activePreset === p.expr ? ' active' : ''}`}
                onClick={() => applyPreset(p.expr)}
              >
                <span>{t(p.labelKey)}</span>
              </button>
            ))}
          </div>

          <div className="cron-expr-preview" style={{ marginBottom: 12 }}>
            <i className="fa-regular fa-clock" style={{ color: 'var(--cyan)', fontSize: 13, flexShrink: 0 }} />
            <code id="newCronExprCode">{expr}</code>
            <span className="cron-expr-desc" id="newCronExprDesc">{exprDesc}</span>
            <span style={{ fontSize: 10, color: 'var(--dim)', flexShrink: 0 }}>
              <i className="fa-regular fa-hourglass-half" style={{ marginRight: 3 }} />
              {formatNextRun(expr, t)}
            </span>
          </div>

          <div className="cron-edit-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 12 }}>
            {FIELDS.map((f, i) => (
              <div key={f.id}>
                <div style={{ fontSize: 9.5, color: 'var(--dim)', textAlign: 'center', marginBottom: 3 }}>{t(f.labelKey)}</div>
                <input
                  className="f-input mono"
                  type="text"
                  value={fields[i]}
                  style={{ textAlign: 'center', padding: '5px 2px' }}
                  onChange={(e) => {
                    const next = [...fields]
                    next[i] = e.target.value
                    setFields(next)
                    setActivePreset(null)
                  }}
                />
              </div>
            ))}
          </div>

          <div className="f-row center">
            <span className="f-lbl">{t('modal.newCron.cmdPath')}</span>
            <input className="f-input mono" type="text" placeholder="/usr/local/bin/backup.sh" value={cmd} onChange={(e) => setCmd(e.target.value)} />
          </div>
          <div className="f-row center">
            <span className="f-lbl">{t('modal.newCron.desc')}</span>
            <input className="f-input" type="text" placeholder="例：每日自动备份数据库" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="f-row center">
            <span className="f-lbl">{t('modal.newCron.scope')}</span>
            <select className="f-input" id="newCronScope" value={scope} onChange={(e) => setScope(e.target.value as 'user' | 'system')}>
              <option value="user">{t('modal.newCron.scopeUser')}</option>
              <option value="system" disabled={!systemAvailable}>
                {t('modal.newCron.scopeSystem')}
              </option>
            </select>
          </div>
          {!systemAvailable && (
            <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 8 }}>{t('cron.systemUnavailable')}</div>
          )}
          <div className="f-row center">
            <span className="f-lbl">{t('cron.log.label')}</span>
            <Toggle checked={log} onChange={setLog} />
            <span style={{ fontSize: 10, color: 'var(--dim)', flex: 1, minWidth: 0 }}>{t('cron.log.hint')}</span>
          </div>
        </div>
        <div className="modal-footer">
          <button className="d-btn" type="button" onClick={() => closeOverlay('newCronModal')}>
            <span>{t('common.cancel')}</span>
          </button>
          <button
            className="d-btn accent"
            type="button"
            disabled={scope === 'system' && !systemAvailable}
            onClick={() => void onCreate()}
          >
            <i className="fa-solid fa-plus" /> <span>{t('modal.newCron.addTask')}</span>
          </button>
        </div>
      </div>
    </Modal>
  )
}
