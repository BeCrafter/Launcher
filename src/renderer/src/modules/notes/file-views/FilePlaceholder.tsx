// 无法在应用内预览时的占位:说明原因,并给出「用默认应用打开 / 在访达中显示」。

import { useT } from '../../../hooks/useT'

export function FilePlaceholder({
  path,
  icon,
  title,
  hint
}: {
  path: string
  icon?: string
  title: string
  hint?: string
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="file-placeholder">
      <i className={`fa-solid ${icon ?? 'fa-file-circle-question'}`} />
      <div className="file-placeholder-title">{title}</div>
      {hint !== undefined && <div className="file-placeholder-hint">{hint}</div>}
      <div className="file-placeholder-actions">
        <button
          type="button"
          className="d-btn accent"
          onClick={() => void window.launcher.notes.openFile(path)}
        >
          <i className="fa-solid fa-arrow-up-right-from-square" />
          <span>{t('notes.file.openExternal')}</span>
        </button>
        <button
          type="button"
          className="d-btn"
          onClick={() => void window.launcher.notes.reveal(path)}
        >
          <i className="fa-solid fa-folder-open" />
          <span>{t('notes.file.reveal')}</span>
        </button>
      </div>
    </div>
  )
}
