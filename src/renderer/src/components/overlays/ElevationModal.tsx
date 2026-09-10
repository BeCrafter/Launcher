// 提权授权 + 危险确认模态(demo elevationModal/dangerModal;密码框按 refactor-plan 移除,记已知差异)
import { useEffect, useState } from 'react'
import { useT } from '../../hooks/useT'
import { Modal } from '../Modal'
import { ELEVATION, confirmDangerous } from '../../lib/elevation'

export function ElevationModal(): React.JSX.Element {
  const t = useT()
  const [req, setReq] = useState<{ detail: string; command: string } | null>(null)
  useEffect(() => ELEVATION.subscribe((r) => setReq(r)), [])

  return (
    <Modal id="elevationModal" open={!!req} onClose={() => ELEVATION.cancel()}>
      <div className="modal-box" style={{ width: 440 }}>
        <div className="modal-hdr">
          <span className="modal-title">
            <i className="fa-solid fa-shield-halved" style={{ color: 'var(--yellow)', marginRight: 7 }} />
            <span>{t('elev.title')}</span>
          </span>
          <button className="modal-close" onClick={() => ELEVATION.cancel()}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="modal-body" style={{ gap: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>{req?.detail}</div>
          <div>
            <div
              style={{
                fontSize: 9.5,
                color: 'var(--dim)',
                marginBottom: 4,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}
            >
              {t('elev.cmdLabel')}
            </div>
            <div
              className="expand-val"
              style={{
                background: 'rgba(0,0,0,0.18)',
                border: '1px solid var(--border)',
                borderRadius: 7,
                padding: '7px 9px',
                fontSize: 10
              }}
            >
              {req?.command}
            </div>
          </div>
          {/* demo 的密码输入框在此移除:真机走 osascript 原生授权框,应用不碰密码 */}
        </div>
        <div className="modal-footer">
          <button className="d-btn" onClick={() => ELEVATION.cancel()}>
            <span>{t('elev.cancel')}</span>
          </button>
          <button className="d-btn accent" onClick={() => ELEVATION.grant()}>
            <i className="fa-solid fa-shield-halved" /> <span>{t('elev.authorize')}</span>
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function DangerModal(): React.JSX.Element {
  const t = useT()
  const [req, setReq] = useState<{ detail: string } | null>(null)
  useEffect(() => confirmDangerous.subscribe((r) => setReq(r)), [])

  return (
    <Modal id="dangerModal" open={!!req} onClose={() => confirmDangerous.cancel()}>
      <div className="modal-box" style={{ width: 420 }}>
        <div className="modal-hdr">
          <span className="modal-title">
            <i className="fa-solid fa-triangle-exclamation" style={{ color: 'var(--red)', marginRight: 7 }} />
            <span>{t('dgr.title')}</span>
          </span>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>{req?.detail}</div>
        </div>
        <div className="modal-footer">
          <button className="d-btn" onClick={() => confirmDangerous.cancel()}>
            <span>{t('common.cancel')}</span>
          </button>
          <button className="d-btn red" onClick={() => confirmDangerous.confirm()}>
            <i className="fa-solid fa-trash-can" /> <span>{t('common.confirm')}</span>
          </button>
        </div>
      </div>
    </Modal>
  )
}
