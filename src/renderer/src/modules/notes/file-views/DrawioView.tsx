// draw.io 文件视图:文本 → iframe 编辑器。
// 在线/离线由全局偏好决定;离线包缺失时回退在线,不挡住打开文件。

import { useEffect, useRef, useState, type Ref } from 'react'
import { blankDrawioXml, isDrawioText, type DrawioMode } from '@shared/drawio'
import { useT } from '../../../hooks/useT'
import { useEffectiveTheme } from '../../../hooks/useEffectiveTheme'
import { effectiveDrawioMode, useDrawioStore } from '../../../state/drawio-store'
import { DrawioFrame, type DrawioFrameHandle } from './DrawioFrame'

interface DrawioViewProps {
  text: string
  frameRef?: Ref<DrawioFrameHandle>
  onAutosave: (xml: string) => void
  onSave: (xml: string) => void
  onReplace: (xml: string) => void
  onOpenLink: (href: string) => void
}

export function DrawioView({
  text,
  frameRef,
  onAutosave,
  onSave,
  onReplace,
  onOpenLink
}: DrawioViewProps): React.JSX.Element {
  const t = useT()
  const theme = useEffectiveTheme()
  // 主题只在打开时取一次:编辑中切主题不应该重载 iframe 丢掉画布。
  // draw.io 的界面配色也跟着这条快照走(configure 时下发),重开文件才会换成新主题。
  const darkRef = useRef(theme === 'dark')
  const pref = useDrawioStore((s) => s.mode)
  const status = useDrawioStore((s) => s.status)
  const ensureStatus = useDrawioStore((s) => s.ensureStatus)
  const requestOffline = useDrawioStore((s) => s.requestOffline)
  const switchOnline = useDrawioStore((s) => s.switchOnline)
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    void ensureStatus().catch(() => {})
  }, [ensureStatus])

  const mode: DrawioMode = effectiveDrawioMode(pref, status)
  const valid = isDrawioText(text)

  useEffect(() => {
    setFailed(false)
  }, [mode, attempt])

  if (status === null) {
    return (
      <div className="drawio-loading standalone">
        <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true" />
        <span>{t('notes.drawio.loading')}</span>
      </div>
    )
  }

  if (!valid) {
    return (
      <div className="drawio-error">
        <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
        <div className="drawio-error-title">{t('notes.drawio.invalid')}</div>
        <p className="drawio-error-hint">{t('notes.drawio.invalidHint')}</p>
        <button type="button" className="d-btn accent" onClick={() => onReplace(blankDrawioXml())}>
          {t('notes.drawio.replaceBlank')}
        </button>
      </div>
    )
  }

  if (failed) {
    return (
      <div className="drawio-error">
        <i className="fa-solid fa-plug-circle-xmark" aria-hidden="true" />
        <div className="drawio-error-title">{t('notes.drawio.failed')}</div>
        <p className="drawio-error-hint">
          {mode === 'offline' ? t('notes.drawio.failedOffline') : t('notes.drawio.failedOnline')}
        </p>
        <div className="drawio-error-actions">
          <button type="button" className="d-btn" onClick={() => setAttempt((n) => n + 1)}>
            {t('notes.drawio.retry')}
          </button>
          {mode === 'offline' ? (
            <button type="button" className="d-btn" onClick={() => switchOnline()}>
              {t('notes.drawio.useOnline')}
            </button>
          ) : (
            <button
              type="button"
              className="d-btn"
              onClick={() => {
                switchOnline()
                void requestOffline()
              }}
            >
              {status.installed ? t('notes.drawio.useOffline') : t('notes.drawio.installOffline')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      {pref === 'offline' && !status.installed && (
        <div className="drawio-notice">
          <i className="fa-solid fa-cloud" aria-hidden="true" />
          <span>{t('notes.drawio.missingPack')}</span>
          <button type="button" className="d-btn" onClick={() => void requestOffline()}>
            {t('notes.drawio.install')}
          </button>
        </div>
      )}
      <DrawioFrame
        key={`${mode}-${attempt}`}
        ref={frameRef}
        xml={text}
        mode={mode}
        dark={darkRef.current}
        lang={document.documentElement.lang.toLowerCase().startsWith('en') ? 'en' : 'zh'}
        onAutosave={onAutosave}
        onSave={onSave}
        onOpenLink={onOpenLink}
        onError={() => setFailed(true)}
      />
    </>
  )
}
