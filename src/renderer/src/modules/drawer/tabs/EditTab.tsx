// ported-from: docs/demo/index.html #dft-edit + drawer.js 表单逻辑 @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 编辑 tab(demo #dft-edit:标识/执行/调度触发/I/O 四组 + 底部操作栏;内联样式逐字保留)
// 2026-09-18:表单兼容守卫横幅 + KeepAlive 三态(移除 AfterInitialDemand)+ ThrottleInterval 未设置态
//            + UserName(仅 daemon)接线 + 删除未接线的 Disabled/EnableTransactions/Debug 与「存草稿」
// 2026-09-19:Stdin(StandardInPath)移出表单 → 无 UI 往返白名单(launchd 任务非交互,正常场景用不到;XML tab 兜底)
import { useState } from 'react'
import { useT, useFmt } from '../../../hooks/useT'
import { useDrawerStore } from '../../../state/drawer-store'
import { Toggle } from '../../../components/ui/Toggle'
import { CfgGroup } from '../../../components/ui/CfgGroup'
import { ArgsList, EnvList, WatchList } from '../MultiValueList'
import { SciBuilder } from '../SciBuilder'
import { showToast } from '../../../lib/utils'
import { keepAlivePreset, keepAlivePresetState, type KeepAlivePreset } from '../../../lib/keep-alive'
import { CHOICE } from '../../../lib/choice'

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
  const kaCustom = useDrawerStore((s) => s.kaCustom)
  const setKaCustom = useDrawerStore((s) => s.setKaCustom)
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
  const calendarSet = trig.startCalendarInterval
  const timeScheduleSet = intervalSet || calendarSet
  const timeScheduleOverlap = intervalSet && calendarSet
  const keepAliveConflicts = trig.keepAlive && (intervalSet || trig.startCalendarInterval || trig.watchPaths)

  const confirmScheduleSwitch = async (target: 'calendar' | 'interval'): Promise<boolean> => {
    const picked = await CHOICE.request({
      header: t('cfg.schedule.replace.header'),
      title: target === 'calendar' ? t('cfg.schedule.replace.calendar.title') : t('cfg.schedule.replace.interval.title'),
      options: [
        { label: target === 'calendar' ? t('cfg.schedule.replace.calendar.ok') : t('cfg.schedule.replace.interval.ok'), value: 'replace' },
        { label: t('cfg.schedule.replace.cancel'), value: 'cancel' }
      ]
    })
    return picked === 'replace'
  }

  const setCalendarSchedule = async (enabled: boolean): Promise<void> => {
    if (!enabled) {
      setTrig({ startCalendarInterval: false })
      return
    }
    if (intervalSet && !(await confirmScheduleSwitch('calendar'))) return
    if (trig.keepAlive) {
      const picked = await CHOICE.request({
        header: t('cfg.keepAlive.replace.header'),
        title: t('cfg.keepAlive.replace.schedule.title'),
        options: [
          { label: t('cfg.keepAlive.replace.schedule.ok'), value: 'replace' },
          { label: t('cfg.schedule.replace.cancel'), value: 'cancel' }
        ]
      })
      if (picked !== 'replace') return
      updateForm({
        triggers: { ...trig, keepAlive: false, startCalendarInterval: true, startInterval: null },
        keepAliveMode: 'bool',
        keepAliveDict: { crashed: null, successfulExit: null }
      })
      return
    }
    updateForm({ triggers: { ...trig, startCalendarInterval: true, startInterval: null } })
  }

  const setIntervalSchedule = async (enabled: boolean): Promise<void> => {
    if (!enabled) {
      setTrig({ startInterval: null })
      return
    }
    if (calendarSet && !(await confirmScheduleSwitch('interval'))) return
    if (trig.keepAlive) {
      const picked = await CHOICE.request({
        header: t('cfg.keepAlive.replace.header'),
        title: t('cfg.keepAlive.replace.schedule.title'),
        options: [
          { label: t('cfg.keepAlive.replace.schedule.ok'), value: 'replace' },
          { label: t('cfg.schedule.replace.cancel'), value: 'cancel' }
        ]
      })
      if (picked !== 'replace') return
      updateForm({
        triggers: { ...trig, keepAlive: false, startCalendarInterval: false, startInterval: 60 },
        keepAliveMode: 'bool',
        keepAliveDict: { crashed: null, successfulExit: null },
        sciEntries: []
      })
      return
    }
    updateForm({ triggers: { ...trig, startInterval: 60, startCalendarInterval: false }, sciEntries: [] })
  }

  const setKeepAlive = async (enabled: boolean): Promise<void> => {
    if (!enabled) {
      const next = keepAlivePresetState('off')
      setKaCustom(false)
      updateForm({ triggers: { ...trig, keepAlive: false }, keepAliveMode: next.mode, keepAliveDict: next.dict })
      return
    }
    if (timeScheduleSet) {
      const picked = await CHOICE.request({
        header: t('cfg.keepAlive.replace.header'),
        title: t('cfg.keepAlive.replace.keepAlive.title'),
        options: [
          { label: t('cfg.keepAlive.replace.keepAlive.ok'), value: 'replace' },
          { label: t('cfg.schedule.replace.cancel'), value: 'cancel' }
        ]
      })
      if (picked !== 'replace') return
      const next = keepAlivePresetState('always')
      setKaCustom(false)
      updateForm({
        triggers: { ...trig, keepAlive: true, startCalendarInterval: false, startInterval: null },
        keepAliveMode: next.mode,
        keepAliveDict: next.dict,
        sciEntries: []
      })
      return
    }
    const next = keepAlivePresetState('always')
    setKaCustom(false)
    updateForm({ triggers: { ...trig, keepAlive: true }, keepAliveMode: next.mode, keepAliveDict: next.dict })
  }
  const currentKeepAlivePreset = keepAlivePreset(form)
  // 下拉框显示的是「模式」:显式选过自定义就一直是自定义,不因形态恰好等于某个预设而被改回具名。
  // 仍以 `keepAliveMode === 'dict'` 收口 —— XML 保存可能把形态换回 bool,此时模式位必须让位给实际形态。
  const kaCustomMode = kaCustom && form.keepAliveMode === 'dict'
  const shownPreset = kaCustomMode ? 'custom' : currentKeepAlivePreset
  const setKeepAlivePreset = (nextPreset: KeepAlivePreset): void => {
    setKaCustom(nextPreset === 'custom')
    const next = nextPreset === 'custom'
      ? { keepAlive: true, mode: 'dict' as const, dict: { ...form.keepAliveDict } }
      : keepAlivePresetState(nextPreset)
    updateForm({ triggers: { ...trig, keepAlive: next.keepAlive }, keepAliveMode: next.mode, keepAliveDict: next.dict })
  }

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
          <div className="f-row">
            <span className="f-lbl" style={{ paddingTop: 6 }}>EnvVars</span>
            <EnvList env={form.env} onChange={(env) => updateForm({ env })} />
          </div>
        </CfgGroup>

        {/* § 启动时机 */}
        <CfgGroup icon="fa-solid fa-clock" title={t('cfg.group.schedule')} subtitle="Startup timing">
          <div className="trigger-grid">
            <TriggerCard id="ef_trig_run" icon="fa-solid fa-arrow-right-to-bracket" name={t('trig.runAtLoad')} sub="RunAtLoad" checked={trig.runAtLoad} onToggle={(v) => setTrig({ runAtLoad: v })} hint={t('trig.runAtLoad.hint')} />
            <TriggerCard id="ef_trig_watch" icon="fa-solid fa-eye" name={t('trig.watchPaths')} sub="WatchPaths" checked={trig.watchPaths} onToggle={(v) => setTrig({ watchPaths: v })} hint={t('cfg.watch.risk')} />
            <TriggerCard id="ef_trig_cron" icon="fa-regular fa-clock" name={t('trig.startCalendarInterval')} sub="StartCalendarInterval" checked={trig.startCalendarInterval} onToggle={(v) => void setCalendarSchedule(v)} />
            {/* 固定间隔:未设置(plist 无该键)与「显式 0」是两回事 —— 开关表达 presence,留空即不写该键 */}
            <div className={`trigger-card${intervalSet ? ' on' : ''}`} id="ef_trig_interval" title={t('trig.interval.hint')}>
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
                <Toggle checked={trig.startInterval !== null} onChange={(v) => void setIntervalSchedule(v)} />
              </div>
            </div>
          </div>

          <HintLine text={t('trig.runAtLoad.hint')} />
          {timeScheduleOverlap && <HintLine text={t('cfg.schedule.overlap')} />}

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

        {/* § 进程生命周期 */}
        <CfgGroup icon="fa-solid fa-heart-pulse" title={t('cfg.group.lifetime')} subtitle="Process lifetime">
          <div className={`keep-alive-layout${trig.keepAlive ? '' : ' solo'}`}>
            <TriggerCard id="ef_trig_keep" icon="fa-solid fa-heart-pulse" name={t('trig.keepAlive')} sub="KeepAlive" checked={trig.keepAlive} onToggle={(v) => void setKeepAlive(v)} />

            {trig.keepAlive && (
              /* 与左侧「保持存活」同款卡片(图标 + 标题 + 英文小字 + 右侧控件);策略说明走 title 提示,不再占一行 */
              <TriggerCard
                id="ef_keepAliveArea"
                icon="fa-solid fa-sliders"
                name={t('ka.policy')}
                sub="KeepAlive policy"
                checked
                hint={t(`ka.preset.${shownPreset}.hint`)}
                trailing={
                  <select
                    className="f-input"
                    style={{ flex: '0 0 auto', width: 152, fontSize: 11, padding: '4px 7px' }}
                    value={shownPreset}
                    onChange={(e) => setKeepAlivePreset(e.target.value as KeepAlivePreset)}
                  >
                    <option value="always">{t('ka.preset.always')}</option>
                    <option value="crashed">{t('ka.preset.crashed')}</option>
                    <option value="successfulExit">{t('ka.preset.successfulExit')}</option>
                    <option value="failedExit">{t('ka.preset.failedExit')}</option>
                    <option value="custom">{t('ka.preset.custom')}</option>
                  </select>
                }
              />
            )}
          </div>

          {keepAliveConflicts && <HintLine text={t('cfg.keepAlive.conflict')} />}

          {/* 条件编辑器只在「自定义」模式下出现,并由模式位(而非派生值)决定留存:
              否则形态一旦恰好等于某个具名预设,用户点第一个 chip 时编辑器会整块消失 */}
          {trig.keepAlive && kaCustomMode && (
            <div className="ka-dict" id="ef_kaDictArea" style={{ marginTop: 8 }}>
              {(
                [
                  ['crashed', 'Crashed', 'ka.crashed'],
                  ['successfulExit', 'SuccessfulExit', 'ka.successfulExit']
                ] as const
              ).map(([key, name, descKey]) => (
                <div className="ka-row ka-item" key={key}>
                  <div>
                    <div className="trig-name">{name}</div>
                    <div className="ka-desc">{t(descKey)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {(
                      [
                        ['unset', null],
                        ['yes', true],
                        ['no', false]
                      ] as const
                    ).map(([stateKey, value]) => (
                      <button
                        key={stateKey}
                        type="button"
                        className={`chip${form.keepAliveDict[key] === value ? ' active' : ''}`}
                        style={{ padding: '3px 10px' }}
                        onClick={() => updateForm({ keepAliveDict: { ...form.keepAliveDict, [key]: value } })}
                      >
                        {t(`ka.state.${stateKey}`)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {/* 说明行走自己的一行:.ka-dict 是两列 grid,不跨列会缩在第 1 列里 */}
              <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 4, gridColumn: '1 / -1' }}>{t('ka.custom.hint')}</div>
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
