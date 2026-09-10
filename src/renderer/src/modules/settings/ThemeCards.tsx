// ported-from: docs/demo/index.html theme-cards-grid + settings.js setTheme @ 06ff9ba — demo UI 基线(docs/design/demo-react-migration-map.md)
// 主题三卡选择器(demo #sp-general theme-cards-grid;preview 色块内联样式逐字保留)
import { useT } from '../../hooks/useT'
import { useSettingsStore } from '../../state/settings-store'
import { fmt } from '../../i18n'
import { showToast } from '../../lib/utils'
import type { ThemeMode } from '@shared/settings'

const CARDS: { id: ThemeMode; preview: string; barStyle: React.CSSProperties; dotStyle: React.CSSProperties }[] = [
  { id: 'system', preview: 'preview-system', barStyle: {}, dotStyle: {} },
  {
    id: 'light',
    preview: 'preview-light',
    barStyle: { background: '#6a58e0' },
    dotStyle: { background: '#c3c9d6' }
  },
  {
    id: 'dark',
    preview: 'preview-dark',
    barStyle: { background: '#7c6af4' },
    dotStyle: { background: '#6aa7f0' }
  }
]

export function ThemeCards(): React.JSX.Element {
  const t = useT()
  const theme = useSettingsStore((s) => s.settings?.theme ?? 'system')
  const set = useSettingsStore((s) => s.set)

  const onPick = (id: ThemeMode): void => {
    set({ theme: id })
    showToast(fmt(t('toast.themeSwitched'), { N: t('settings.theme.' + id) }), '#a78bfa', 'fa-palette')
  }

  return (
    <div className="theme-cards-grid">
      {CARDS.map((c) => (
        <div
          key={c.id}
          className={`theme-card-item${theme === c.id ? ' selected' : ''}`}
          data-theme-card={c.id}
          onClick={() => onPick(c.id)}
        >
          <div className={`theme-card-preview ${c.preview}`}>
            <div className="theme-mini-bar" style={c.barStyle} />
            <div className="theme-mini-rects">
              <div className="theme-mini-dot" style={c.dotStyle} />
              <div className="theme-mini-dot" style={c.dotStyle} />
            </div>
          </div>
          <div className="theme-card-footer">
            <div>
              <div className="theme-card-label">{t('settings.theme.' + c.id)}</div>
              <div className="theme-card-sub">{t('settings.theme.' + c.id + 'Sub')}</div>
            </div>
            <i className="fa-solid fa-circle-check theme-check-icon" />
          </div>
        </div>
      ))}
    </div>
  )
}
