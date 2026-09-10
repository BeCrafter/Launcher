import { useEffect, useState } from 'react'
import { ROCKET_ORBIT_DATAURL } from '../assets/rocketOrbit'
import { ROCKET_ORBIT2_DARK_DATAURL, ROCKET_ORBIT2_LIGHT_DATAURL } from '../assets/rocketOrbit2Theme'

// 主题探测：父级传 theme 优先；否则侦听 body.light-theme（与 demo/theme.css 约定一致）
export type LogoTheme = 'dark' | 'light'

function useLogoTheme(theme?: LogoTheme): LogoTheme {
  const [auto, setAuto] = useState<LogoTheme>(
    typeof document !== 'undefined' && document.body.classList.contains('light-theme') ? 'light' : 'dark'
  )
  useEffect(() => {
    if (theme) return
    const sync = (): void =>
      setAuto(document.body.classList.contains('light-theme') ? 'light' : 'dark')
    const mo = new MutationObserver(sync)
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [theme])
  return theme ?? auto
}

// 图标体系：两款星际火箭插画（2026-09 定稿）
//  v1 rocketOrbit ：原始蓝青插画（单图，无主题变体）
//  v2 rocketOrbit2：紫调双主题（深/浅两版 dataURL，随主题热切换）
//  资源产物：resources/logo/<variant>/（512 图标 + 菜单栏模板 + icns），生成见 scripts/gen-*.mjs
export type LogoVariant = 'rocketOrbit' | 'rocketOrbit2'

export const LOGO_VARIANTS: { id: LogoVariant; label: string }[] = [
  { id: 'rocketOrbit', label: '星际火箭（插画 v1）' },
  { id: 'rocketOrbit2', label: '星际火箭（插画 v2）' }
]

export default function Logo({
  variant = 'rocketOrbit2',
  size = 48,
  theme
}: {
  variant?: LogoVariant
  size?: number
  theme?: LogoTheme
}): React.JSX.Element {
  const themeL = useLogoTheme(theme)
  const href =
    variant === 'rocketOrbit2'
      ? themeL === 'light'
        ? ROCKET_ORBIT2_LIGHT_DATAURL
        : ROCKET_ORBIT2_DARK_DATAURL
      : ROCKET_ORBIT_DATAURL
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" role="img" aria-label="Launcher Logo">
      <image href={href} x="0" y="0" width="256" height="256" preserveAspectRatio="xMidYMid meet" />
    </svg>
  )
}
