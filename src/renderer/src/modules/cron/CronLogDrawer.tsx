// ported-from: docs/demo/index.html #cronLogDrawer + crontab.js showCronLog @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// Cron 日志抽屉(demo cronLogDrawer:右侧抽屉 + cronLogLines 近 3 天窗口)
import { useEffect, useState } from 'react'
import { useT } from '../../hooks/useT'
import { Modal } from '../../components/Modal'
import { LogLines } from '../drawer/tabs/LogTab'
import { useUiStore } from '../../state/ui-store'
import { useSettingsStore } from '../../state/settings-store'
import { dataSource } from '../../data'
import { fmt } from '../../i18n'
import type { CronJob, LogLine } from '@shared/models'

// 轻量事件总线:CronCard「查看日志」→ 抽屉(避免为单一消费建全局 store)
const listeners = new Set<(id: string) => void>()
export const cronLogDrawer = {
  emit(id: string): void {
    listeners.forEach((l) => l(id))
  },
  subscribe(l: (id: string) => void): () => void {
    listeners.add(l)
    return () => listeners.delete(l)
  }
}

export function CronLogDrawer(): React.JSX.Element {
  const t = useT()
  const open = useUiStore((s) => s.overlays.includes('cronLogDrawer'))
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const retainDays = useSettingsStore((s) => s.settings?.cronLogRetainDays ?? 3)
  const [job, setJob] = useState<CronJob | null>(null)
  const [lines, setLines] = useState<LogLine[]>([])

  useEffect(
    () =>
      cronLogDrawer.subscribe(async (id) => {
        const j = useCronStoreSafe(id)
        setJob(j)
        setLines(await dataSource().crons.readLog(id))
      }),
    []
  )

  return (
    <Modal id="cronLogDrawer" kind="drawer" open={open} onClose={() => closeOverlay('cronLogDrawer')}>
      <div className="edit-drawer">
        <div className="drawer-hdr">
          <div className="drawer-title-area">
            <div className="drawer-title-icon">
              <i className="fa-solid fa-scroll" style={{ color: 'var(--cyan)' }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="drawer-title-main">{t('cron.log.title')}</div>
              <div className="drawer-title-sub" id="cronLogPath" style={{ fontFamily: 'monospace' }}>
                {job?.logPath ?? ''}
              </div>
            </div>
          </div>
          <div className="drawer-hdr-right">
            <button className="modal-close" type="button" onClick={() => closeOverlay('cronLogDrawer')} title={t('common.close')}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        </div>
        <div className="drawer-body">
          <div className="log-section-body" style={{ flex: 1, minHeight: 0 }}>
            <div className="log-section-content" id="cronLogBody">
              {lines.length > 0 ? (
                <LogLines lines={lines} />
              ) : (
                <div style={{ padding: '18px 14px', fontSize: 11, color: 'var(--dim)' }}>
                  <i className="fa-regular fa-file-lines" style={{ marginRight: 6 }} />
                  {t('cron.log.empty')}
                </div>
              )}
            </div>
          </div>
          <div className="xml-section-bottom">
            <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>
              <i className="fa-solid fa-clock-rotate-left" style={{ marginRight: 4 }} />
              <span>{fmt(t('cron.log.retainHintDyn'), { D: retainDays })}</span>
            </span>
            <button className="d-btn" type="button" onClick={() => closeOverlay('cronLogDrawer')}>
              <span>{t('common.close')}</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

import { useCronStore } from '../../state/cron-store'

function useCronStoreSafe(id: string): CronJob | null {
  return useCronStore.getState().crons.find((x) => x.id === id) ?? null
}
