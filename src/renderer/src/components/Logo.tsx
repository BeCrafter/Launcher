import { useEffect, useState } from 'react'
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

// 品牌图标（2026-09 定稿）：v2 星际火箭紫调双主题为项目唯一图标，
// 深浅两版 dataURL 随主题热切换（v1 rocketOrbit 仅作仓库备份 resources/logo/rocketOrbit/）。
export default function Logo({
  size = 48,
  theme
}: {
  size?: number
  theme?: LogoTheme
}): React.JSX.Element {
  const themeL = useLogoTheme(theme)
  const href = themeL === 'light' ? ROCKET_ORBIT2_LIGHT_DATAURL : ROCKET_ORBIT2_DARK_DATAURL
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" role="img" aria-label="Launcher Logo">
      <image href={href} x="0" y="0" width="256" height="256" preserveAspectRatio="xMidYMid meet" />
    </svg>
  )
}
