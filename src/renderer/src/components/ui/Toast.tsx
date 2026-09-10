// 全局 Toast(单条;色值映射表逐字保留自 demo utils.js showToast)
import { useUiStore } from '../../state/ui-store'

function resolveColor(color: string | undefined, isLight: boolean): string {
  const map: Record<string, string> = {
    '#60a5fa': isLight ? '#3d7fd6' : '#6aa7f0',
    '#4ade80': isLight ? '#1f9d6b' : '#3ecf8e',
    '#22d3ee': isLight ? '#1f9bb3' : '#45cbe0',
    '#f87171': isLight ? '#d75a5a' : '#ef8080',
    '#fbbf24': isLight ? '#c8932a' : '#eec04d',
    '#fb923c': isLight ? '#d9833a' : '#f09a55',
    '#f97316': isLight ? '#d97a32' : '#ef8840',
    '#a78bfa': isLight ? '#6a58e0' : '#a78bfa',
    '#8888aa': isLight ? '#a0a7bb' : '#8e8ea8'
  }
  return (color && map[color]) || color || (isLight ? '#1f9d6b' : 'var(--green)')
}

export function Toast(): React.JSX.Element {
  const toast = useUiStore((s) => s.toast)
  const isLight = document.body.classList.contains('light-theme')
  return (
    <div id="toast" className={toast ? 'show' : ''}>
      <i
        className={`fa-solid ${toast?.icon ?? 'fa-check-circle'}`}
        id="toastIcon"
        style={{ color: resolveColor(toast?.color, isLight) }}
      />
      <span id="toastMsg">{toast?.msg ?? ''}</span>
    </div>
  )
}
