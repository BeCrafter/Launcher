// 当前**实际生效**的主题(light / dark)。
//
// 不读设置里的 theme,而是读 body 上的 `light-theme` 类 —— 那是 settings-store
// 三种模式(light / dark / system)最终落到 DOM 的唯一结果,也是 CSS 变量真正生效的地方。
// 读它就不必自己再实现一遍「system 时跟随系统」的逻辑,而且换主题的每条路径都能覆盖到。
//
// 用 MutationObserver 而不是订阅 store:主题也可能被别的地方(首帧注入、系统外观变化)改掉,
// 观察 DOM 是唯一不会漏的信源。

import { useEffect, useState } from 'react'

function read(): 'light' | 'dark' {
  return document.body.classList.contains('light-theme') ? 'light' : 'dark'
}

export function useEffectiveTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(read)
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()))
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return theme
}
