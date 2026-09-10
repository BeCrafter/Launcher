// StartCalendarInterval 规则构建器(demo sciAddEntry/sciUpdatePreview/sciInsertPreset + 内联样式逐字)
// 五列输入(分/时/日/星期/月份,省略 = 通配)+ 每规则 preview 行;聚合 preview 是 demo 死代码,不移植
import { useT } from '../../hooks/useT'
import { useSettingsStore } from '../../state/settings-store'
import { sciDescribe, sciPlistFragment, SCI_PRESETS, SCI_PRESET_LABEL_KEYS, type SciData } from '../../lib/sci'
import { showToast } from '../../lib/utils'
import type { SciEntry } from '@shared/models'

// demo sci-entry 容器内联样式(样式全部内联,无 CSS 规则)
const ENTRY_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
  padding: '9px 10px',
  background: 'rgba(255,255,255,0.025)',
  border: '1px solid var(--border)',
  borderRadius: 8
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  fontFamily: "'SF Mono', Menlo, monospace",
  fontSize: 12,
  fontWeight: 600,
  textAlign: 'center',
  padding: '7px 4px',
  borderRadius: 6
}

const SELECT_STYLE: React.CSSProperties = {
  width: '100%',
  fontSize: 12,
  fontWeight: 500,
  padding: '7px 4px',
  textAlign: 'center',
  borderRadius: 6,
  textAlignLast: 'center',
  cursor: 'pointer'
}

export function SciBuilder({
  entries,
  onChange
}: {
  entries: SciEntry[]
  onChange: (next: SciEntry[]) => void
}): React.JSX.Element {
  const t = useT()
  const lang = useSettingsStore((s) => s.settings?.language ?? 'zh-CN')

  const asData = (e: SciEntry): SciData => ({
    Minute: e.Minute ?? null,
    Hour: e.Hour ?? null,
    Day: e.Day ?? null,
    Weekday: e.Weekday ?? null,
    Month: e.Month ?? null
  })

  const patch = (i: number, key: keyof SciEntry, raw: string): void => {
    const next = [...entries]
    const v = raw === '' ? undefined : Number(raw)
    if (v === undefined) delete next[i][key]
    else next[i] = { ...next[i], [key]: v }
    onChange(next)
  }

  const updateWeekday = (i: number, raw: string): void => {
    const next = [...entries]
    if (raw === '') delete next[i].Weekday
    else next[i] = { ...next[i], Weekday: Number(raw) }
    onChange(next)
  }

  const updateMonth = (i: number, raw: string): void => {
    const next = [...entries]
    if (raw === '') delete next[i].Month
    else next[i] = { ...next[i], Month: Number(raw) }
    onChange(next)
  }

  const insertPreset = (p: Partial<SciEntry>, labelKey: string): void => {
    onChange([...entries, p])
    showToast(t('toast.insertedPreset') + ' ' + t(labelKey), '#fbbf24', 'fa-clock')
  }

  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      {/* 顶部标题栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '9px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--hover)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <i className="fa-regular fa-clock" style={{ color: 'var(--muted)', fontSize: 11 }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>StartCalendarInterval</span>
          <span
            style={{
              fontSize: 9.5,
              color: 'var(--dim)',
              background: 'var(--hover)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '1px 6px'
            }}
          >
            {t('sci.wildcardHint')}
          </span>
        </div>
        <button
          className="add-row-btn"
          type="button"
          style={{ padding: '3px 10px', margin: 0, borderStyle: 'solid', borderColor: 'var(--border2)', color: 'var(--muted)' }}
          onClick={() => onChange([...entries, {}])}
        >
          <i className="fa-solid fa-plus" style={{ fontSize: 9 }} /> <span>{t('sci.addRule')}</span>
        </button>
      </div>

      {/* 字段标题行 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr) 30px',
          gap: 8,
          padding: '8px 14px 6px',
          background: 'var(--hover)'
        }}
      >
        {(
          [
            ['sci.col.minute', '0–59'],
            ['sci.col.hour', '0–23'],
            ['sci.col.day', '1–31'],
            ['sci.col.weekday', '0=日'],
            ['sci.col.month', '1–12']
          ] as const
        ).map(([key, range]) => (
          <div key={key} style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center', fontWeight: 600, letterSpacing: '0.02em' }}>
            <span>{t(key)}</span> <span style={{ fontSize: 9, color: 'var(--dim)', fontWeight: 400 }}>{range}</span>
          </div>
        ))}
        <div />
      </div>

      {/* 规则条目 */}
      <div style={{ display: 'flex', flexDirection: 'column', padding: '8px 12px 10px', gap: 10, maxHeight: 240, overflowY: 'auto' }}>
        {entries.map((e, i) => {
          const d = asData(e)
          return (
            <div key={i} className="sci-entry" style={ENTRY_STYLE}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr) 30px', gap: 8, alignItems: 'center' }}>
                <div>
                  <input
                    type="number"
                    className="f-input"
                    placeholder="*"
                    min={0}
                    max={59}
                    value={e.Minute ?? ''}
                    style={INPUT_STYLE}
                    title="Minute (0-59)"
                    onChange={(ev) => patch(i, 'Minute', ev.target.value)}
                  />
                </div>
                <div>
                  <input
                    type="number"
                    className="f-input"
                    placeholder="*"
                    min={0}
                    max={23}
                    value={e.Hour ?? ''}
                    style={INPUT_STYLE}
                    title="Hour (0-23)"
                    onChange={(ev) => patch(i, 'Hour', ev.target.value)}
                  />
                </div>
                <div>
                  <input
                    type="number"
                    className="f-input"
                    placeholder="*"
                    min={1}
                    max={31}
                    value={e.Day ?? ''}
                    style={INPUT_STYLE}
                    title="Day of Month (1-31)"
                    onChange={(ev) => patch(i, 'Day', ev.target.value)}
                  />
                </div>
                <div>
                  <select
                    className="f-input"
                    style={SELECT_STYLE}
                    title="Weekday (0=Sunday)"
                    value={e.Weekday ?? ''}
                    onChange={(ev) => updateWeekday(i, ev.target.value)}
                  >
                    <option value="">*</option>
                    {Array.from({ length: 7 }, (_, wd) => (
                      <option key={wd} value={String(wd)}>
                        {t('cron.wd.' + wd)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <select
                    className="f-input"
                    style={SELECT_STYLE}
                    title="Month (1-12)"
                    value={e.Month ?? ''}
                    onChange={(ev) => updateMonth(i, ev.target.value)}
                  >
                    <option value="">*</option>
                    {Array.from({ length: 12 }, (_, m) => (
                      <option key={m + 1} value={String(m + 1)}>
                        {t('cron.mo.' + (m + 1))}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  className="mv-del"
                  type="button"
                  style={{ width: 30, height: 30, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}
                  title={t('sci.deleteRule')}
                  onClick={() => onChange(entries.filter((_, j) => j !== i))}
                >
                  <i className="fa-solid fa-xmark" style={{ fontSize: 11 }} />
                </button>
              </div>
              <div
                className="sci-preview"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 9px',
                  background: 'rgba(34,211,238,0.06)',
                  border: '1px solid rgba(34,211,238,0.18)',
                  borderRadius: 6
                }}
              >
                <i className="fa-regular fa-clock" style={{ fontSize: 10, color: 'var(--cyan)', flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--cyan)', fontWeight: 600 }} className="sci-preview-text">
                  {sciDescribe(d, lang, t)}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--dim)',
                    marginLeft: 'auto',
                    fontFamily: "'SF Mono', Menlo, monospace",
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: 210
                  }}
                  className="sci-plist-text"
                >
                  {sciPlistFragment(d, t)}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* 快速预设 */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px', background: 'var(--hover)' }}>
        <div style={{ fontSize: 9, color: 'var(--dim)', marginBottom: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {t('sci.quickPreset')}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {SCI_PRESETS.map((p, idx) => (
            <button
              key={SCI_PRESET_LABEL_KEYS[idx]}
              type="button"
              className="cron-preset-chip"
              style={{ fontSize: 10, padding: '2px 8px' }}
              onClick={() => insertPreset(p.entry, p.labelKey)}
            >
              {t(SCI_PRESET_LABEL_KEYS[idx])}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
