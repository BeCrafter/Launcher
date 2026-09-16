// 二选一决策浮层(应用新增 UI,超出 demo 冻结基线)
// 场景:维度联动需要用户拍板时(如停止一个「开机自启」的任务)——用询问代替灰按钮或报错
import { useEffect, useState } from 'react'
import { useT } from '../../hooks/useT'
import { Modal } from '../Modal'
import { CHOICE, type ChoiceRequest } from '../../lib/choice'

export function ChoiceModal(): React.JSX.Element {
  const t = useT()
  const [req, setReq] = useState<ChoiceRequest | null>(null)
  useEffect(() => CHOICE.subscribe((r) => setReq(r)), [])

  return (
    <Modal id="choiceModal" open={!!req} onClose={() => CHOICE.cancel()}>
      <div className="modal-box" style={{ width: 440 }}>
        <div className="modal-hdr">
          <span className="modal-title">
            <i className="fa-solid fa-circle-question" style={{ color: 'var(--accent2)', marginRight: 7 }} />
            <span>{req?.header ?? ''}</span>
          </span>
          <button className="modal-close" type="button" onClick={() => CHOICE.cancel()}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>{req?.title ?? ''}</div>
        </div>
        <div className="modal-footer">
          <button className="d-btn" type="button" onClick={() => CHOICE.cancel()}>
            <span>{t('common.cancel')}</span>
          </button>
          {req?.options.map((o) => (
            <button key={o.value} className="d-btn accent" type="button" onClick={() => CHOICE.pick(o.value)}>
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
