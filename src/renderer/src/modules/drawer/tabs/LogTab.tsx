// ported-from: docs/demo/index.html #dft-log + drawer.js addLogLine/clearLog @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 日志 tab(demo #dft-log:4.5s live 流 + 初始 MOCK_DATA.drawer.logLines + 清空/导出/查看文件)
import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../hooks/useT'
import { useDrawerStore } from '../../../state/drawer-store'
import { dataSource } from '../../../data'
import { showToast } from '../../../lib/utils'
import type { LogLine } from '@shared/models'

// 日志行渲染(抽屉日志 tab 与 Cron 日志抽屉共用形态)
export function LogLines({ lines }: { lines: LogLine[] }): React.JSX.Element {
  return (
    <>
      {lines.map((l, i) => (
        <div className="log-line" key={i}>
          <span className="log-ts">{l.ts}</span>
          <span className={`log-txt ${l.type}`}>{l.text}</span>
        </div>
      ))}
    </>
  )
}

export function LogTab(): React.JSX.Element {
  const t = useT()
  const logLines = useDrawerStore((s) => s.logLines)
  const clearLog = useDrawerStore((s) => s.clearLog)
  const pushLogLine = useDrawerStore((s) => s.pushLogLine)
  const open = useDrawerStore((s) => s.open)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [level, setLevel] = useState('')

  // 实时日志流(demo 4.5s interval;strictMode 下订阅幂等,退订清理)
  useEffect(() => {
    if (!open) return
    return dataSource().logs.subscribe(pushLogLine)
  }, [open, pushLogLine])

  // 自动滚底(demo addLogLine scrollTop = scrollHeight)
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logLines.length])

  const visible = level
    ? logLines.filter((l) =>
        level === 'INFO' ? l.type === 'info' || l.type === 'ok' : level === 'WARN' ? l.type === 'warn' : l.type === 'err'
      )
    : logLines

  return (
    <div className="drawer-section active" id="dft-log" style={{ display: 'flex' }}>
      <div className="log-section-body">
        <div className="log-section-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fa-solid fa-scroll" style={{ color: 'var(--accent2)', fontSize: 12 }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t('log.title')}
            </span>
            <div className="live-badge">
              <div className="live-dot" />
              LIVE
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--border2)',
                borderRadius: 6,
                color: 'var(--muted)',
                fontSize: 10.5,
                padding: '3px 7px',
                fontFamily: 'inherit',
                outline: 'none'
              }}
            >
              <option value="">{t('log.level.all')}</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
            </select>
          </div>
        </div>
        <div className="log-section-content" id="ef_logBody" ref={bodyRef}>
          <LogLines lines={visible} />
        </div>
        <div className="log-section-bottom">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', animation: 'pulse-g 1.2s infinite' }} />
            <span style={{ fontSize: 10, color: 'var(--dim)' }}>{t('log.trackLive')}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="d-btn" type="button" style={{ padding: '4px 9px', fontSize: 10.5 }} onClick={clearLog}>
              <i className="fa-solid fa-trash-can" /> <span>{t('log.clear')}</span>
            </button>
            <button
              className="d-btn"
              type="button"
              style={{ padding: '4px 9px', fontSize: 10.5 }}
              onClick={() => showToast(t('toast.logExported'), '#4ade80', 'fa-download')}
            >
              <i className="fa-solid fa-download" /> <span>{t('log.export')}</span>
            </button>
            <button
              className="d-btn accent"
              type="button"
              style={{ padding: '4px 9px', fontSize: 10.5 }}
              onClick={() => showToast(t('toast.logFileJumped'), '#a78bfa', 'fa-file-lines')}
            >
              <i className="fa-solid fa-file-lines" /> <span>{t('log.viewFile')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
