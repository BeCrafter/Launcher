// 关联 chip:让用户一眼看出「哪个 type 当中的哪个服务」,并处理失效/漂移两种退化。
//
// 解析在渲染层做(对着已加载的 store)—— 主进程没有更便宜的答案,而这些列表本来就是新鲜的
// (端口服务 3s 一轮、agent 目录变化会推事件)。

import type { NoteRef } from '@shared/notes'
import { useT } from '../../hooks/useT'
import { navigateToRef, openNotesFor } from '../../lib/notes-nav'
import { refTypeIcon, refTypeLabel, resolveRef, useRefContext } from '../../lib/note-refs'
import { showToast } from '../../lib/utils'

export function NoteRefChips({
  refs,
  onRemove,
  onUpdate,
  compact = false
}: {
  refs: NoteRef[]
  /** 给出则可移除 */
  onRemove?: (r: NoteRef) => void
  /** 给出则「已漂移」的关联可一键更新到新键 */
  onUpdate?: (old: NoteRef, next: NoteRef) => void
  compact?: boolean
}): React.JSX.Element | null {
  const t = useT()
  const ctx = useRefContext()

  if (refs.length === 0) return null

  return (
    <div className={'note-refs' + (compact ? ' compact' : '')}>
      {refs.map((r) => {
        const res = resolveRef(r, ctx)
        const tone = res.state === 'ok' ? 'ok' : res.state === 'changed' ? 'changed' : 'stale'
        const label = res.state === 'stale' ? r.label : res.label
        return (
          <span
            key={`${r.type}:${r.key}`}
            className={`note-ref note-ref-${tone}`}
            title={
              res.state === 'stale'
                ? t('notes.ref.stale.title')
                : res.state === 'changed'
                  ? t('notes.ref.changed.title')
                  : `${refTypeLabel(r.type, t)} · ${label}`
            }
          >
            <button
              type="button"
              className="note-ref-main"
              disabled={res.state === 'stale'}
              onClick={() => {
                if (res.state === 'stale') return
                navigateToRef(r, ctx)
              }}
            >
              <i className={refTypeIcon(r.type)} />
              <span className="note-ref-type">{refTypeLabel(r.type, t)}</span>
              <span className="note-ref-label">{label}</span>
              {res.state === 'stale' && <span className="note-ref-flag">{t('notes.ref.stale')}</span>}
            </button>
            {res.state === 'changed' && onUpdate && (
              <button
                type="button"
                className="note-ref-act"
                title={t('notes.ref.update')}
                onClick={() => {
                  const next: NoteRef =
                    res.target.kind === 'agent'
                      ? { type: 'agent', key: res.target.id, label: res.label, detail: r.detail }
                      : res.target.kind === 'cron'
                        ? { type: 'cron', key: res.target.id, label: res.label, detail: r.detail }
                        : { type: 'service', key: r.key, label: res.label, detail: r.detail }
                  onUpdate(r, next)
                  showToast(t('toast.noteRefUpdated'), '#4ade80', 'fa-link')
                }}
              >
                <i className="fa-solid fa-rotate" />
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                className="note-ref-act"
                title={t('notes.ref.remove')}
                onClick={() => onRemove(r)}
              >
                <i className="fa-solid fa-xmark" />
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
}

/** 服务侧入口用的「相关笔记 (N)」按钮内容 */
export function RelatedNotesHint({ count }: { count: number }): React.JSX.Element {
  const t = useT()
  return (
    <>
      <i className="fa-regular fa-note-sticky" />
      <span>{t('notes.ref.related')}</span>
      <span className="note-related-count">{count}</span>
    </>
  )
}

export { openNotesFor }
