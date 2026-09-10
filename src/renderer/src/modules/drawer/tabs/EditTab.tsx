// ported-from: docs/demo/index.html #dft-edit + drawer.js 表单逻辑 @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 编辑 tab(demo #dft-edit:标识/执行/调度触发/I/O 四组 + 底部操作栏;内联样式逐字保留)
import { useState } from 'react'
import { useT } from '../../../hooks/useT'
import { useDrawerStore } from '../../../state/drawer-store'
import { Toggle } from '../../../components/ui/Toggle'
import { ArgsList, EnvList, WatchList } from '../MultiValueList'
import { SciBuilder } from '../SciBuilder'
import { showToast } from '../../../lib/utils'

// 折叠组(demo toggleCfg:body display 切换 + chevron open 类)
function CfgGroup({
  icon,
  title,
  subtitle,
  children,
  defaultOpen = true
}: {
  icon: string
  title: string
  subtitle: string
  children: React.ReactNode
  defaultOpen?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="cfg-group">
      <div className="cfg-group-hdr" onClick={() => setOpen(!open)}>
        <i className={icon} />
        <span className="cfg-group-title">{title}</span>
        <span className="cfg-group-subtitle">{subtitle}</span>
        <i className={`fa-solid fa-chevron-down cfg-chevron${open ? ' open' : ''}`} />
      </div>
      <div className="cfg-group-body" style={{ display: open ? 'flex' : 'none' }}>
        {children}
      </div>
    </div>
  )
}

// 触发卡(demo trigger-card;on 态由 checked 驱动)
function TriggerCard({
  id,
  icon,
  name,
  sub,
  checked,
  onToggle,
  trailing
}: {
  id: string
  icon: string
  name: string
  sub: string
  checked: boolean
  onToggle?: (v: boolean) => void
  trailing?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={`trigger-card${checked ? ' on' : ''}`} id={id}>
      <div className="trig-icon">
        <i className={icon} />
      </div>
      <div className="trig-text">
        <div className="trig-name">{name}</div>
        <div className="trig-sub">{sub}</div>
      </div>
      {onToggle ? (
        <Toggle checked={checked} onChange={onToggle} />
      ) : (
        trailing
      )}
    </div>
  )
}

export function EditTab(): React.JSX.Element {
  const t = useT()
  const form = useDrawerStore((s) => s.form)
  const updateForm = useDrawerStore((s) => s.updateForm)
  const remove = useDrawerStore((s) => s.remove)
  const clone = useDrawerStore((s) => s.clone)
  const save = useDrawerStore((s) => s.save)
  const xml = useDrawerStore((s) => s.xml)
  const setXml = useDrawerStore((s) => s.setXml)
  if (!form) return <div />

  const trig = form.triggers
  const setTrig = (patch: Partial<typeof trig>): void => updateForm({ triggers: { ...trig, ...patch } })

  return (
    <div className="drawer-section active" id="dft-edit" style={{ display: 'flex' }}>
      <div className="section-scroll-area">
        {/* § 标识 */}
        <CfgGroup icon="fa-solid fa-fingerprint" title={t('cfg.group.ident')} subtitle="Identification">
          <div className="f-row center">
            <span className="f-lbl">Label</span>
            <input className="f-input mono" type="text" value={form.label} onChange={(e) => updateForm({ label: e.target.value })} />
          </div>
          <div className="f-row center">
            <span className="f-lbl">{t('cfg.desc')}</span>
            <textarea className="f-input" rows={2} value={form.desc} onChange={(e) => updateForm({ desc: e.target.value })} />
          </div>
          <div className="f-row center">
            <span className="f-lbl">ProcessType</span>
            <select className="f-input" value={form.processType} onChange={(e) => updateForm({ processType: e.target.value })}>
              <option>Background</option>
              <option>Standard</option>
              <option>Adaptive</option>
              <option>Interactive</option>
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 9px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 7 }}>
              <label className="toggle" style={{ flexShrink: 0 }}>
                <input type="checkbox" />
                <div className="toggle-track" />
                <div className="toggle-thumb" />
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap' }}>Disabled</span>
                <span style={{ fontSize: 9.5, color: 'var(--dim)', whiteSpace: 'nowrap' }}>{t('cfg.disabled.hint')}</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 9px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 7 }}>
              <label className="toggle" style={{ flexShrink: 0 }}>
                <input type="checkbox" />
                <div className="toggle-track" />
                <div className="toggle-thumb" />
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap' }}>EnableTransactions</span>
                <span style={{ fontSize: 9.5, color: 'var(--dim)', whiteSpace: 'nowrap' }}>{t('cfg.transactions.hint')}</span>
              </div>
            </div>
          </div>
        </CfgGroup>

        {/* § 执行 */}
        <CfgGroup icon="fa-solid fa-terminal" title={t('cfg.group.exec')} subtitle="Execution">
          <div className="f-row center">
            <span className="f-lbl">Program</span>
            <input className="f-input mono" type="text" value={form.program} onChange={(e) => updateForm({ program: e.target.value })} />
            <button
              className="act-btn"
              type="button"
              style={{ flexShrink: 0, width: 28 }}
              onClick={() => showToast(t('toast.chooseExecutable'), '#60a5fa', 'fa-folder-open')}
            >
              <i className="fa-solid fa-folder-open" style={{ fontSize: 10 }} />
            </button>
          </div>
          <div className="f-row">
            <span className="f-lbl" style={{ paddingTop: 6 }}>Arguments</span>
            <ArgsList args={form.args} onChange={(args) => updateForm({ args })} />
          </div>
          <div className="f-row center">
            <span className="f-lbl">WorkingDir</span>
            <input className="f-input mono" type="text" value={form.workingDir} onChange={(e) => updateForm({ workingDir: e.target.value })} />
          </div>
          <div className="f-row center">
            <span className="f-lbl">UserName</span>
            <input className="f-input mono" type="text" placeholder="_www（daemon 专用）" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="f-row center">
              <span className="f-lbl">Nice</span>
              <input
                className="f-input"
                type="number"
                min={-20}
                max={20}
                value={form.nice}
                style={{ maxWidth: 70 }}
                onChange={(e) => updateForm({ nice: Number(e.target.value) })}
              />
              <span style={{ fontSize: 10, color: 'var(--dim)', marginLeft: 5 }}>{t('cfg.nice.range')}</span>
            </div>
            <div className="f-row center">
              <span className="f-lbl">ThrottleInt</span>
              <input
                className="f-input"
                type="number"
                min={0}
                value={form.throttleInterval}
                style={{ maxWidth: 70 }}
                onChange={(e) => updateForm({ throttleInterval: Number(e.target.value) })}
              />
              <span style={{ fontSize: 10, color: 'var(--dim)', marginLeft: 5 }}>{t('unit.second')}</span>
            </div>
          </div>
          <div className="f-row">
            <span className="f-lbl" style={{ paddingTop: 6 }}>EnvVars</span>
            <EnvList env={form.env} onChange={(env) => updateForm({ env })} />
          </div>
        </CfgGroup>

        {/* § 调度 / 触发 */}
        <CfgGroup icon="fa-solid fa-sliders" title={t('cfg.group.schedule')} subtitle="Scheduling">
          <div className="trigger-grid">
            <TriggerCard id="ef_trig_run" icon="fa-solid fa-arrow-right-to-bracket" name={t('trig.runAtLoad')} sub="RunAtLoad" checked={trig.runAtLoad} onToggle={(v) => setTrig({ runAtLoad: v })} />
            <TriggerCard id="ef_trig_keep" icon="fa-solid fa-heart-pulse" name={t('trig.keepAlive')} sub="KeepAlive" checked={trig.keepAlive} onToggle={(v) => setTrig({ keepAlive: v })} />
            <TriggerCard id="ef_trig_watch" icon="fa-solid fa-eye" name={t('trig.watchPaths')} sub="WatchPaths" checked={trig.watchPaths} onToggle={(v) => setTrig({ watchPaths: v })} />
            <TriggerCard id="ef_trig_cron" icon="fa-regular fa-clock" name={t('trig.startCalendarInterval')} sub="StartCalendarInterval" checked={trig.startCalendarInterval} onToggle={(v) => setTrig({ startCalendarInterval: v })} />
            <div className="trigger-card on" id="ef_trig_interval" style={{ gridColumn: '1/-1' }}>
              <div className="trig-icon"><i className="fa-solid fa-stopwatch" /></div>
              <div className="trig-text">
                <div className="trig-name">{t('trig.startInterval')}</div>
                <div className="trig-sub">StartInterval</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                <input
                  type="number"
                  className="f-input"
                  min={1}
                  value={trig.startInterval}
                  style={{ maxWidth: 65, fontSize: 11, padding: '4px 7px' }}
                  onChange={(e) => setTrig({ startInterval: Number(e.target.value) })}
                />
                <span style={{ fontSize: 10, color: 'var(--dim)' }}>{t('unit.second')}</span>
              </div>
            </div>
          </div>

          {trig.keepAlive && (
            <div id="ef_keepAliveArea">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>{t('ka.mode')}</span>
                <button className={`chip${form.keepAliveMode === 'bool' ? ' active' : ''}`} type="button" style={{ padding: '3px 10px' }} onClick={() => updateForm({ keepAliveMode: 'bool' })}>
                  Bool
                </button>
                <button className={`chip${form.keepAliveMode === 'dict' ? ' active' : ''}`} type="button" style={{ padding: '3px 10px' }} onClick={() => updateForm({ keepAliveMode: 'dict' })}>
                  {t('ka.dict')}
                </button>
              </div>
              {form.keepAliveMode === 'dict' && (
                <div className="ka-dict" id="ef_kaDictArea">
                  {(
                    [
                      ['crashed', 'Crashed', 'ka.crashed'],
                      ['afterInitialDemand', 'AfterInitialDemand', 'ka.afterInitialDemand'],
                      ['successfulExit', 'SuccessfulExit', 'ka.successfulExit']
                    ] as const
                  ).map(([key, name, descKey]) => (
                    <div className="ka-row" key={key}>
                      <div>
                        <div className="trig-name">{name}</div>
                        <div className="ka-desc">{t(descKey)}</div>
                      </div>
                      <Toggle
                        checked={form.keepAliveDict[key]}
                        onChange={(v) => updateForm({ keepAliveDict: { ...form.keepAliveDict, [key]: v } })}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {trig.watchPaths && (
            <div id="ef_watchArea">
              <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 7 }}>
                  <i className="fa-solid fa-eye" style={{ marginRight: 5 }} />
                  WatchPaths
                </div>
                <WatchList paths={form.watchPaths} onChange={(watchPaths) => updateForm({ watchPaths })} />
              </div>
            </div>
          )}

          {trig.startCalendarInterval && (
            <div id="ef_cronArea">
              <SciBuilder entries={form.sciEntries} onChange={(sciEntries) => updateForm({ sciEntries })} />
            </div>
          )}
        </CfgGroup>

        {/* § I/O */}
        <CfgGroup icon="fa-solid fa-file-lines" title={t('cfg.group.io')} subtitle="Stdio">
          <div className="f-row center">
            <span className="f-lbl">Stdout</span>
            <input className="f-input mono" type="text" value={form.stdout} onChange={(e) => updateForm({ stdout: e.target.value })} />
          </div>
          <div className="f-row center">
            <span className="f-lbl">Stderr</span>
            <input className="f-input mono" type="text" value={form.stderr} onChange={(e) => updateForm({ stderr: e.target.value })} />
          </div>
          <div className="f-row center">
            <span className="f-lbl">Stdin</span>
            <input className="f-input mono" type="text" placeholder="StandardInputPath（可选）" />
          </div>
          <div className="f-row center">
            <span className="f-lbl">Debug</span>
            <Toggle checked={false} onChange={() => {}} />
            <span style={{ fontSize: 10.5, color: 'var(--dim)', marginLeft: 7 }}>{t('cfg.debug.hint')}</span>
          </div>
        </CfgGroup>
      </div>

      {/* 编辑 Tab 固定底部操作栏 */}
      <div className="section-footer">
        <div className="section-footer-left">
          <button className="d-btn" type="button" onClick={() => showToast(t('toast.undone'), '#888', 'fa-rotate-left')}>
            <i className="fa-solid fa-rotate-left" /> <span>{t('btn.undo')}</span>
          </button>
          <button className="d-btn red" type="button" onClick={() => void remove()}>
            <i className="fa-solid fa-trash-can" /> <span>{t('btn.delete')}</span>
          </button>
          <button className="d-btn" type="button" onClick={() => void clone()}>
            <i className="fa-solid fa-copy" /> <span>{t('btn.clone')}</span>
          </button>
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          <button
            className="d-btn blue"
            type="button"
            onClick={() => {
              setXml(xml)
              showToast(t('toast.draftSaved'), '#60a5fa', 'fa-floppy-disk')
            }}
          >
            <i className="fa-solid fa-floppy-disk" /> <span>{t('btn.draft')}</span>
          </button>
          <button className="d-btn accent" type="button" style={{ padding: '7px 20px' }} onClick={() => void save()}>
            <i className="fa-solid fa-check" /> <span>{t('btn.saveReload')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

