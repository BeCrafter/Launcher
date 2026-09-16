// Cron 日志抽屉(demo cronLogDrawer 的移植 + 分段文件列表:按小时分段后,每个段是一个文件)
// 左栏 = 已有日志文件列表(可切换查看 / 可单独删除),右栏 = 选中段的正文。
// ⚠ 抽屉是快照式(无轮询):删除/清理后必须主动 refetch,否则界面不动会被读成"操作失败"。
import { useCallback, useEffect, useState } from 'react'
import { useT } from '../../hooks/useT'
import { Modal } from '../../components/Modal'
import { LogLines } from '../drawer/tabs/LogTab'
import { useUiStore } from '../../state/ui-store'
import { useSettingsStore } from '../../state/settings-store'
import { useCronStore } from '../../state/cron-store'
import { dataSource } from '../../data'
import { fmt } from '../../i18n'
import { showToast } from '../../lib/utils'
import { cronErrorToast, segmentRangeLabel } from '../../lib/cron'
import type { CronJob, CronLogFileInfo, LogLine } from '@shared/models'

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

function sizeLabel(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

// 左栏折叠偏好(跨会话记忆):对齐 demo 的会话栏(`launcherAiRailCollapsed`)——纯 UI chrome,不进设置文件
const LIST_COLLAPSED_KEY = 'launcherCronLogListCollapsed'

export function CronLogDrawer(): React.JSX.Element {
  const t = useT()
  const open = useUiStore((s) => s.overlays.includes('cronLogDrawer'))
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const retainDays = useSettingsStore((s) => s.settings?.cronLogRetainDays ?? 3)
  const [job, setJob] = useState<CronJob | null>(null)
  const [files, setFiles] = useState<CronLogFileInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [lines, setLines] = useState<LogLine[]>([])
  const [listOpen, setListOpen] = useState(() => localStorage.getItem(LIST_COLLAPSED_KEY) !== 'true')

  const toggleList = (): void => {
    const next = !listOpen
    localStorage.setItem(LIST_COLLAPSED_KEY, next ? 'false' : 'true')
    setListOpen(next)
  }

  /** 拉取文件列表 + 选中段正文;keep 命中则保持选中(如刷新后该文件还在),否则回落到最新非空段 */
  const refresh = useCallback(async (id: string, keep: string | null): Promise<void> => {
    const list = await dataSource().crons.listLogs(id)
    setFiles(list)
    const pick =
      (keep !== null && list.some((f) => f.name === keep) ? keep : null) ??
      list.find((f) => f.size > 0)?.name ??
      list[0]?.name ??
      null
    setSelected(pick)
    setLines(pick === null ? [] : await dataSource().crons.readLog(id, pick))
  }, [])

  useEffect(
    () =>
      cronLogDrawer.subscribe(async (id) => {
        setJob(useCronStore.getState().crons.find((x) => x.id === id) ?? null)
        await refresh(id, null)
      }),
    [refresh]
  )

  const onSelect = async (name: string): Promise<void> => {
    if (!job) return
    setSelected(name)
    setLines(await dataSource().crons.readLog(job.id, name))
  }

  const onDelete = async (name: string): Promise<void> => {
    if (!job) return
    try {
      await dataSource().crons.deleteLog(job.id, name)
      await refresh(job.id, null) // 删掉的段自动让位给下一段
      void useCronStore.getState().load() // 卡片的「共 N 段」跟着更新
      showToast(t('toast.cronLogDeleted'), '#f87171', 'fa-trash-can')
    } catch (err) {
      cronErrorToast(err, t)
    }
  }

  const onCleanup = async (): Promise<void> => {
    if (!job) return
    try {
      const n = await dataSource().crons.cleanupLogs()
      await refresh(job.id, selected)
      void useCronStore.getState().load()
      showToast(fmt(t('cron.log.cleaned'), { N: n }), '#4ade80', 'fa-broom')
    } catch (err) {
      cronErrorToast(err, t)
    }
  }

  // 「当前段」只标真正的分段文件:刚迁移完时 logPath 会回落到历史整份,那一行不该被当成新分段
  const templated = !!job?.logTemplate
  const currentName = templated && job?.logPath ? (job.logPath.split('/').pop() ?? null) : null
  const segmentCount = files.filter((f) => !f.legacy).length

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
                {selected ?? job?.logPath ?? ''}
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
          <div className="cron-log-split">
            <div className={`cron-log-list${listOpen ? '' : ' collapsed'}`} id="cronLogFiles">
              <div className="cron-log-list-hd">
                <span className="cron-log-list-title">{t('cron.log.segments')}</span>
                <button
                  className="cron-log-list-collapse"
                  type="button"
                  title={t('cron.log.list.collapse')}
                  onClick={toggleList}
                >
                  <i className="fa-solid fa-angles-left" />
                </button>
              </div>
              {files.length === 0 ? (
                <div className="cron-log-list-empty">{t('cron.log.noSegmentYet')}</div>
              ) : (
                files.map((f) => (
                  <div
                    key={f.name}
                    className={`cron-log-item${selected === f.name ? ' active' : ''}`}
                    title={f.name}
                    onClick={() => void onSelect(f.name)}
                  >
                    <span className="cron-log-item-name">
                      {f.legacy ? t('cron.log.segment.legacy') : (segmentRangeLabel(f.stamp ?? '') ?? f.name)}
                      {!f.legacy && f.name === currentName && (
                        <span className="cron-log-item-cur">{t('cron.log.segment.current')}</span>
                      )}
                    </span>
                    <span className="cron-log-item-size">{sizeLabel(f.size)}</span>
                    <button
                      className="cron-log-item-del"
                      type="button"
                      title={t('cron.log.segment.deleteTitle')}
                      onClick={(e) => {
                        e.stopPropagation()
                        void onDelete(f.name)
                      }}
                    >
                      <i className="fa-solid fa-xmark" />
                    </button>
                  </div>
                ))
              )}
            </div>
            {/* 折叠后的窄栏:仅容一个展开钮(顶部、左右居中) */}
            {!listOpen && (
              <div className="cron-log-rail">
                <button
                  className="cron-log-expand"
                  type="button"
                  title={t('cron.log.list.expand')}
                  onClick={toggleList}
                >
                  <i className="fa-solid fa-angles-right" />
                </button>
              </div>
            )}
            <div className="cron-log-view">
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
            </div>
          </div>
          <div className="xml-section-bottom cron-log-footer">
            <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>
              <i className="fa-solid fa-clock-rotate-left" style={{ marginRight: 4 }} />
              <span>
                {fmt(t('cron.log.retainHintDyn'), { D: retainDays })} · {fmt(t('cron.log.segmentedCount'), { N: segmentCount })}
              </span>
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="d-btn" type="button" onClick={() => void onCleanup()} title={t('cron.log.cleanup.title')}>
                <i className="fa-solid fa-broom" /> <span>{t('cron.log.cleanup')}</span>
              </button>
              <button className="d-btn" type="button" onClick={() => closeOverlay('cronLogDrawer')}>
                <span>{t('common.close')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
