// 状态 tab(demo #dft-status:stat 卡片 + CPU/内存条 + 元信息 chips + 路径信息组;数据 = readStatus)
import { useT } from '../../../hooks/useT'
import { useDrawerStore } from '../../../state/drawer-store'

export function StatusTab(): React.JSX.Element {
  const t = useT()
  const st = useDrawerStore((s) => s.statusModel)
  if (!st) return <div className="drawer-section" id="dft-status" />

  return (
    <div className="drawer-section active" id="dft-status" style={{ display: 'flex' }}>
      <div className="section-scroll-area">
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">{t('status.state')}</div>
            <div className="stat-val" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <div className={`status-dot ${st.state}`} />
              <span>{t('status.' + st.state)}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">PID</div>
            <div className="stat-val" style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{st.pid ?? '—'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{t('status.runtime')}</div>
            <div className="stat-val" style={{ color: 'var(--text)' }}>{st.uptime ?? '—'}</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="stat-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span className="stat-label">
                <i className="fa-solid fa-microchip" style={{ color: 'var(--muted)', marginRight: 3 }} />
                CPU
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{st.cpu}</span>
            </div>
            <div className="res-bar">
              <div className="res-fill" style={{ width: st.cpuWidth, background: 'linear-gradient(90deg,#7c6af4,#a78bfa)' }} />
            </div>
          </div>
          <div className="stat-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span className="stat-label">
                <i className="fa-solid fa-memory" style={{ color: 'var(--muted)', marginRight: 3 }} />
                <span>{t('status.memory')}</span>
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{st.mem}</span>
            </div>
            <div className="res-bar">
              <div className="res-fill" style={{ width: st.memWidth, background: 'linear-gradient(90deg,#7c6af4,#a78bfa)' }} />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 11 }}>
            <i className="fa-solid fa-right-from-bracket" style={{ color: 'var(--dim)', fontSize: 10 }} />
            <span style={{ color: 'var(--muted)' }}>{t('status.exitCode')}</span>
            <span style={{ color: 'var(--text)', fontWeight: 700, fontFamily: 'monospace' }}>{st.exitCode ?? '—'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 11 }}>
            <i className="fa-solid fa-arrows-rotate" style={{ color: 'var(--dim)', fontSize: 10 }} />
            <span style={{ color: 'var(--muted)' }}>{t('status.restarts')}</span>
            <span style={{ color: 'var(--text)', fontWeight: 700, fontFamily: 'monospace' }}>{st.restarts}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 11 }}>
            <i className="fa-solid fa-calendar-day" style={{ color: 'var(--dim)', fontSize: 10 }} />
            <span style={{ color: 'var(--muted)' }}>{t('status.startTime')}</span>
            <span style={{ color: 'var(--text)', fontWeight: 600, fontFamily: 'monospace' }}>{st.startTime}</span>
          </div>
        </div>
        <div className="cfg-group">
          <div className="cfg-group-hdr">
            <i className="fa-solid fa-folder" />
            <span className="cfg-group-title">{t('status.pathInfo')}</span>
            <i className="fa-solid fa-chevron-down cfg-chevron open" />
          </div>
          <div className="cfg-group-body">
            <div className="expand-grid">
              <div className="expand-field">
                <div className="expand-key">{t('status.plistPath')}</div>
                <div className="expand-val">{st.plistPath}</div>
              </div>
              <div className="expand-field">
                <div className="expand-key">{t('status.workDir')}</div>
                <div className="expand-val">{st.workDir}</div>
              </div>
              <div className="expand-field">
                <div className="expand-key">Scope</div>
                <div className="expand-val" style={{ color: 'var(--blue)' }}>{st.scope}</div>
              </div>
              <div className="expand-field">
                <div className="expand-key">{t('status.manageMethod')}</div>
                <div className="expand-val">{t('status.launchdNative')}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
