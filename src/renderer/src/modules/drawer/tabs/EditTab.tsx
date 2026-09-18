// ported-from: docs/demo/index.html #dft-edit + drawer.js 表单逻辑 @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 编辑 tab(demo #dft-edit:标识/执行/调度触发/I/O 四组 + 底部操作栏;内联样式逐字保留)
// 2026-09-18:表单兼容守卫横幅 + KeepAlive 三态(移除 AfterInitialDemand)+ ThrottleInterval 未设置态
//            + UserName(仅 daemon)/ StandardInPath 接线 + 删除未接线的 Disabled/EnableTransactions/Debug 与「存草稿」
import { useState } from 'react'
import { useT, useFmt } from '../../../hooks/useT'
import { useDrawerStore } from '../../../state/drawer-store'
import { Toggle } from '../../../components/ui/Toggle'
import { CfgGroup } from '../../../components/ui/CfgGroup'
import { ArgsList, EnvList, WatchList } from '../MultiValueList'
import { SciBuilder } from '../SciBuilder'
import { showToast } from '../../../lib/utils'

// 触发卡(demo trigger-card;on 态由 checked 驱动)
function TriggerCard({
  id,
  icon,
  name,
  sub,
  checked,
  onToggle,
  trailing,
  hint
}: {
  id: string
  icon: string
  name: string
  sub: string
  checked: boolean
  onToggle?: (v: boolean) => void
  trailing?: React.ReactNode
  hint?: string
}): React.JSX.Element {
  return (
    <div className={`trigger-card${checked ? ' on' : ''}`} id={id} title={hint}>
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

// 风险/引导提示行(应用新增;官方文档明确不建议但仍保留可操作性时使用)
function HintLine({ text }: { text: string }): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        alignItems: 'flex-start',
        fontSize: 10.5,
        color: 'var(--muted)',
        background: 'rgba(251,191,36,0.06)',
        border: '1px solid rgba(251,191,36,0.18)',
        borderRadius: 6,
        padding: '6px 9px'
      }}
    >
      <i className="fa-solid fa-triangle-exclamation" style={{ color: '#fbbf24', marginTop: 2 }} />
      <span>{text}</span>
    </div>
  )
}

export function EditTab(): React.JSX.Element {
  const t = useT()
  const fmt = useFmt()
  const form = useDrawerStore((s) => s.form)
  const updateForm = useDrawerStore((s) => s.updateForm)
  const formHistory = useDrawerStore((s) => s.formHistory)
  const undoForm = useDrawerStore((s) => s.undoForm)
  const remove = useDrawerStore((s) => s.remove)
  const clone = useDrawerStore((s) => s.clone)
  const save = useDrawerStore((s) => s.save)
  const isNotTask = useDrawerStore((s) => s.isNotTask)
  const document = useDrawerStore((s) => s.document)
  const unsupportedKeys = document?.compatibility.unsupportedPaths ?? []
  const preservedKeys = document?.compatibility.preservedTopLevelKeys ?? []
  const warnings = document?.compatibility.warnings ?? []
  const warningKeys = document?.compatibility.warningKeys ?? []
  const entries = document?.compatibility.entries ?? []
  const setTab = useDrawerStore((s) => s.setTab)
  const scope = useDrawerStore((s) => s.scope)
  // 损坏文件:没有可解析的字典,表单无从填起 → 给出去处(XML 修复)并保留唯一的动作(删除)
  if (!form) {
    return (
      <div className="drawer-section active" id="dft-edit" style={{ display: 'flex' }}>
        <div className="section-scroll-area">
          <div className="nontask-notice broken" title={t('agent.broken.title')}>
            <i className="fa-solid fa-triangle-exclamation" />
            <span>{t('agent.broken.title')}</span>
          </div>
        </div>
        <div className="section-footer">
          <div className="section-footer-left">
            <button className="d-btn red" type="button" onClick={() => void remove()}>
              <i className="fa-solid fa-trash-can" /> <span>{t('btn.delete')}</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  const trig = form.triggers
  const setTrig = (patch: Partial<typeof trig>): void => updateForm({ triggers: { ...trig, ...patch } })
  const blocked = unsupportedKeys.length > 0
  const intervalSet = typeof trig.startInterval === 'number' && trig.startInterval > 0
  const keepAliveConflicts = trig.keepAlive && (intervalSet || trig.startCalendarInterval || trig.watchPaths)

  return (
    <div className="drawer-section active" id="dft-edit" style={{ display: 'flex' }}>
      <div className="section-scroll-area">
        {/* 表单兼容守卫:含表单表达不了的键 → 禁止表单保存(与 main 侧保存守卫同判据),引导去 XML */}
        {blocked && (
          <div className="nontask-notice" title={t('cfg.unsupported.hint')}>
            <i className="fa-solid fa-triangle-exclamation" />
            <span>{fmt(t('cfg.unsupported.title'), { K: unsupportedKeys.join(', ') })}</span>
            <button
              className="d-btn"
              type="button"
              style={{ marginLeft: 'auto', padding: '3px 9px', fontSize: 10.5, flexShrink: 0 }}
              onClick={() => setTab('xml')}
            >
              <i className="fa-solid fa-code" /> <span>{t('cfg.unsupported.jump')}</span>
            </button>
          </div>
        )}
        {/* 表单不展示但原样保留的第三方键(如 MachServices):只提示,不拦保存 */}
        {!blocked && preservedKeys.length > 0 && (
          <div className="nontask-notice">
            <i className="fa-solid fa-circle-info" />
            <span>{fmt(t('cfg.preserved.title'), { N: preservedKeys.length, K: preservedKeys.join(', ') })}</span>
          </div>
        )}
        {/* B 类/保留项的可读说明(复审 item 5):键名 + 类型 + 值摘要 + 原因 + 保真等级 */}
        {entries.length > 0 && (
          <div className="nontask-notice" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 11 }}>{fmt(t('cfg.compat.title'), { N: entries.length })}</span>
            {entries.map((e) => (
              <div key={e.path} style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 10.5, color: 'var(--dim)' }}>
                <code style={{ color: 'var(--muted)', flexShrink: 0 }}>{e.path}</code>
                <span style={{ flexShrink: 0 }}>{e.type}</span>
                {e.summary !== '' && <span style={{ color: 'var(--muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>= {e.summary}</span>}
                <span style={{ opacity: 0.85 }}>{e.reasonKey ? t(e.reasonKey) : e.reason}</span>
              </div>
            ))}
          </div>
        )}
        {/* 运行效果说明(P1-4 分层提示:既有配置只说明,不做判断);KeepAlive 那条由下面的实时提示承担,避免重复 */}
        {warnings.map((w, i) => ({ w, i })).filter(({ w }) => !(keepAliveConflicts && w.startsWith('KeepAlive'))).map(({ w, i }) => (
          <div className="nontask-notice" key={w}>
            <i className="fa-solid fa-circle-info" />
            <span>{warningKeys[i] ? t(warningKeys[i]) : w}</span>
          </div>
        ))}
        {/* 非任务文件:填上 Label 并保存即成为真正的任务(原地重写,保留原文件名) */}
        {isNotTask && (
          <div className="nontask-notice" title={t('agent.notTask.title')}>
            <i className="fa-solid fa-file-circle-question" />
            <span>{t('agents.notTask.labelRequired')}</span>
          </div>
        )}
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
              <option value="">{t('cfg.option.default')}</option>
              <option>Background</option>
              <option>Standard</option>
              <option>Adaptive</option>
              <option>Interactive</option>
            </select>
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
              onClick={() => {
                void window.launcher
                  .pickFile({ mode: 'executable', title: t('dialog.pickExecutable') })
                  .then((picked) => {
                    if (picked) updateForm({ program: picked.path })
                  })
                  .catch((err) => showToast(String(err), '#f87171', 'fa-circle-exclamation'))
              }}
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
          {/* 非 daemon 域:文件里若已有 UserName,如实展示为只读(launchd 会忽略;保存原值保留) */}
          {scope !== 'daemon' && form.userName !== '' && (
            <div className="f-row center" title={t('cfg.userName.ignored')}>
              <span className="f-lbl">UserName</span>
              <input className="f-input mono" type="text" value={form.userName} readOnly disabled />
              <span style={{ fontSize: 10, color: 'var(--dim)', marginLeft: 5, flexShrink: 0 }}>{t('cfg.userName.ignored')}</span>
            </div>
          )}
          {/* UserName 仅特权 system 域(daemon)生效,launchd 对 agent 会忽略该键 → 只在 daemon 域暴露(demo 页脚设计原意) */}
          {scope === 'daemon' && (
            <div className="f-row center">
              <span className="f-lbl">UserName</span>
              <input
                className="f-input mono"
                type="text"
                value={form.userName}
                placeholder={t('cfg.userName.placeholder')}
                onChange={(e) => updateForm({ userName: e.target.value })}
              />
            </div>
          )}
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
              <i className="fa-solid fa-circle-info" title={t('cfg.nice.prefer')} style={{ fontSize: 10, color: 'var(--dim)', marginLeft: 4, flexShrink: 0 }} />
            </div>
            <div className="f-row center">
              <span className="f-lbl">ThrottleInt</span>
              <input
                className="f-input"
                type="number"
                min={0}
                value={form.throttleInterval ?? ''}
                placeholder="10"
                style={{ maxWidth: 70 }}
                onChange={(e) => updateForm({ throttleInterval: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <span style={{ fontSize: 10, color: 'var(--dim)', marginLeft: 5 }}>{t('unit.second')}</span>
              <i className="fa-solid fa-circle-info" title={t('cfg.throttle.hint')} style={{ fontSize: 10, color: 'var(--dim)', marginLeft: 4, flexShrink: 0 }} />
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
            <TriggerCard id="ef_trig_watch" icon="fa-solid fa-eye" name={t('trig.watchPaths')} sub="WatchPaths" checked={trig.watchPaths} onToggle={(v) => setTrig({ watchPaths: v })} hint={t('cfg.watch.risk')} />
            <TriggerCard id="ef_trig_cron" icon="fa-regular fa-clock" name={t('trig.startCalendarInterval')} sub="StartCalendarInterval" checked={trig.startCalendarInterval} onToggle={(v) => setTrig({ startCalendarInterval: v })} />
            {/* 固定间隔:未设置(plist 无该键)与「显式 0」是两回事 —— 开关表达 presence,留空即不写该键 */}
            <div className={`trigger-card${intervalSet ? ' on' : ''}`} id="ef_trig_interval" style={{ gridColumn: '1/-1' }} title={t('trig.interval.hint')}>
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
                  value={trig.startInterval ?? ''}
                  placeholder="—"
                  disabled={trig.startInterval === null}
                  style={{ maxWidth: 65, fontSize: 11, padding: '4px 7px' }}
                  onChange={(e) => setTrig({ startInterval: e.target.value === '' ? null : Number(e.target.value) })}
                />
                <span style={{ fontSize: 10, color: 'var(--dim)' }}>{t('unit.second')}</span>
                <Toggle checked={trig.startInterval !== null} onChange={(v) => setTrig({ startInterval: v ? 60 : null })} />
              </div>
            </div>
          </div>

          {/* KeepAlive 会持续拉起任务(且隐含 RunAtLoad),同时开的定时/监视触发实际轮不到 → 只提示不阻止 */}
          {keepAliveConflicts && <HintLine text={t('cfg.keepAlive.conflict')} />}

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
                      ['successfulExit', 'SuccessfulExit', 'ka.successfulExit']
                    ] as const
                  ).map(([key, name, descKey]) => (
                    <div className="ka-row" key={key}>
                      <div>
                        <div className="trig-name">{name}</div>
                        <div className="ka-desc">{t(descKey)}</div>
                      </div>
                      {/* 三态:未设置 = 不写该子键;是/否 = true/false(launchd 把条件 OR 起来,false 是反向条件) */}
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {(
                          [
                            ['unset', null],
                            ['yes', true],
                            ['no', false]
                          ] as const
                        ).map(([stateKey, v]) => (
                          <button
                            key={stateKey}
                            type="button"
                            className={`chip${form.keepAliveDict[key] === v ? ' active' : ''}`}
                            style={{ padding: '3px 10px' }}
                            onClick={() => updateForm({ keepAliveDict: { ...form.keepAliveDict, [key]: v } })}
                          >
                            {t(`ka.state.${stateKey}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {form.keepAliveDict.crashed === null && form.keepAliveDict.successfulExit === null && (
                    <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 4 }}>{t('ka.empty.hint')}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {trig.watchPaths && (
            <div id="ef_watchArea">
              <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>
                  <i className="fa-solid fa-eye" style={{ marginRight: 5 }} />
                  WatchPaths
                </div>
                <WatchList paths={form.watchPaths} onChange={(watchPaths) => updateForm({ watchPaths })} />
                <HintLine text={t('cfg.watch.risk')} />
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
            <input
              className="f-input mono"
              type="text"
              value={form.stdin}
              placeholder={t('cfg.stdin.placeholder')}
              onChange={(e) => updateForm({ stdin: e.target.value })}
            />
          </div>
        </CfgGroup>
      </div>

      {/* 编辑 Tab 固定底部操作栏 */}
      <div className="section-footer">
        <div className="section-footer-left">
          <button
            className="d-btn"
            type="button"
            disabled={formHistory.length === 0}
            title={t('btn.undo')}
            onClick={() => undoForm()}
          >
            <i className="fa-solid fa-rotate-left" /> <span>{t('btn.undo')}</span>
          </button>
          <button className="d-btn red" type="button" onClick={() => void remove()}>
            <i className="fa-solid fa-trash-can" /> <span>{t('btn.delete')}</span>
          </button>
          <button
            className="d-btn"
            type="button"
            disabled={isNotTask}
            title={isNotTask ? t('agent.notTask.title') : undefined}
            onClick={() => void clone()}
          >
            <i className="fa-solid fa-copy" /> <span>{t('btn.clone')}</span>
          </button>
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          <button
            className="d-btn"
            type="button"
            style={{ padding: '7px 16px' }}
            disabled={blocked}
            title={blocked ? t('cfg.unsupported.hint') : t('btn.save.hint')}
            onClick={() => void save('save')}
          >
            <i className="fa-solid fa-floppy-disk" /> <span>{t('btn.save')}</span>
          </button>
          <button
            className="d-btn accent"
            type="button"
            style={{ padding: '7px 18px' }}
            disabled={blocked}
            title={blocked ? t('cfg.unsupported.hint') : t('btn.saveApply.hint')}
            onClick={() => void save('saveAndApply')}
          >
            <i className="fa-solid fa-check" /> <span>{t('btn.saveApply')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
