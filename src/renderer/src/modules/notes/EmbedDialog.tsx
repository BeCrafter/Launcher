// 网页嵌入对话框。
//
// 两条路径,代价完全不同,所以界面上必须说清楚:
//   · 相对路径(assets/report.html)→ 走笔记目录的自定义协议,**不发任何网络请求**;
//   · http(s) 地址 → 预览会**直接去那个地址取页面**。
// 后者是用户明确要的能力(见 docs/help.md),但它与「本地优先、无遥测」是冲突的,
// 所以提示写在输入框下面,而不是藏在文档里。

import { useEffect, useRef, useState } from 'react'
import { useT } from '../../hooks/useT'
import { Modal } from '../../components/Modal'

const HEIGHTS = [240, 380, 520, 720] as const

export function EmbedDialog({
  open,
  onClose,
  onInsert
}: {
  open: boolean
  onClose: () => void
  onInsert: (spec: { url: string; height: number | null }) => void
}): React.JSX.Element | null {
  const t = useT()
  const [url, setUrl] = useState('')
  const [height, setHeight] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 每次打开都清空:上次那个地址留着只会让人误插
  useEffect(() => {
    if (!open) return
    setUrl('')
    setHeight(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  if (!open) return null

  const trimmed = url.trim()
  const remote = /^https?:\/\//i.test(trimmed)

  const submit = (): void => {
    if (trimmed === '') return
    onInsert({ url: trimmed, height })
    onClose()
  }

  return (
    <Modal id="embedDialog" open={open} onClose={onClose}>
      <div className="modal-box embed-box">
        <div className="modal-hdr">
          <span className="modal-title">
            <i className="fa-solid fa-globe" style={{ color: 'var(--accent2)', marginRight: 7 }} />
            <span>{t('notes.embed.title')}</span>
          </span>
          <button className="modal-close" onClick={onClose} aria-label={t('common.close')}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="modal-body embed-body">
          <label className="embed-label" htmlFor="embed-url">
            {t('notes.embed.url')}
          </label>
          <input
            id="embed-url"
            ref={inputRef}
            className="embed-input"
            value={url}
            spellCheck={false}
            placeholder={t('notes.embed.urlPlaceholder')}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />

          <label className="embed-label">{t('notes.embed.height')}</label>
          <div className="embed-heights">
            <button
              type="button"
              className={'embed-height' + (height === null ? ' active' : '')}
              onClick={() => setHeight(null)}
            >
              {t('notes.embed.heightAuto')}
            </button>
            {HEIGHTS.map((h) => (
              <button
                key={h}
                type="button"
                className={'embed-height' + (height === h ? ' active' : '')}
                onClick={() => setHeight(h)}
              >
                {h}px
              </button>
            ))}
          </div>

          {/* 远程地址那条路会发网络请求 —— 说在明面上 */}
          <div className={'embed-hint' + (remote ? ' warn' : '')}>
            <i className={'fa-solid ' + (remote ? 'fa-tower-broadcast' : 'fa-hard-drive')} />
            <span>{t('notes.embed.hint')}</span>
          </div>
        </div>

        <div className="modal-footer">
          <button className="d-btn" onClick={onClose}>
            <span>{t('common.cancel')}</span>
          </button>
          <button className="d-btn accent" disabled={trimmed === ''} onClick={submit}>
            <i className="fa-solid fa-check" /> <span>{t('notes.embed.insert')}</span>
          </button>
        </div>
      </div>
    </Modal>
  )
}
