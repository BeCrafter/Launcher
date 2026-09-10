// 布局同步(逐行为移植 modules.js syncSidebarLayout + checkMobile):
// 量 .main-content 实际边界 → 写 CSS 变量 + 状态栏内联几何(折叠动画期间随帧更新)
import { useEffect } from 'react'

// 写入 --content-left/--content-width/--sidebar-width + 状态栏内联几何
// 直接读取右侧主内容区域实际边界(兼容折叠动画/移动端/滚动条差异,demo 同款)
export function syncSidebarLayout(): void {
  const mc = document.querySelector('.main-content')
  const sb = document.getElementById('launchStatusBar')
  if (!mc) return
  const contentRect = mc.getBoundingClientRect()
  const left = Math.max(0, contentRect.left)
  const width = Math.max(0, contentRect.width)
  document.documentElement.style.setProperty('--content-left', `${left}px`)
  document.documentElement.style.setProperty('--content-width', `${width}px`)
  document.documentElement.style.setProperty('--sidebar-width', `${left}px`)
  if (sb) {
    sb.style.left = `${left}px`
    sb.style.width = `${width}px`
    sb.style.right = 'auto'
    sb.style.maxWidth = `${width}px`
  }
}

export function useSidebarLayout(sidebarCollapsed: boolean): void {
  useEffect(() => {
    const mainContent = document.querySelector('.main-content')
    if (!mainContent) return

    function checkMobile(): void {
      const w = window.innerWidth
      const sb = document.getElementById('sidebar')
      const btn = document.getElementById('menuToggle')
      if (sb && w > 680) sb.classList.remove('mobile-open')
      syncSidebarLayout()
      if (btn) btn.style.display = w <= 680 ? 'flex' : 'none'
    }

    syncSidebarLayout()
    const ro = new ResizeObserver(syncSidebarLayout)
    ro.observe(mainContent)
    window.addEventListener('resize', checkMobile)
    checkMobile()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', checkMobile)
    }
  }, [sidebarCollapsed])
}

// 侧边栏折叠(逐行为移植 toggleSidebarCollapse:过渡类 + rAF/transitionend/360ms 兜底三重同步)
// 折叠状态持久化在 settings store(替代 demo localStorage);toast 文案保留 demo 硬编码中文(已记差异)
export function toggleSidebarCollapse(forceCollapsed?: boolean, onDone?: (collapsed: boolean) => void): void {
  const sidebar = document.getElementById('sidebar')
  if (!sidebar || window.innerWidth <= 680) return
  const shouldCollapse =
    typeof forceCollapsed === 'boolean' ? forceCollapsed : !sidebar.classList.contains('collapsed')
  // 避免连续点击造成过渡状态叠加,统一以当前目标状态为准
  sidebar.classList.toggle('is-transitioning', true)
  sidebar.classList.toggle('collapsed', shouldCollapse)
  syncSidebarLayout()
  requestAnimationFrame(syncSidebarLayout)
  const finishSync = (event: TransitionEvent): void => {
    if (event && event.propertyName !== 'width') return
    sidebar.classList.remove('is-transitioning')
    syncSidebarLayout()
    sidebar.removeEventListener('transitionend', finishSync)
  }
  sidebar.addEventListener('transitionend', finishSync)
  setTimeout(() => {
    sidebar.classList.remove('is-transitioning')
    syncSidebarLayout()
  }, 360)
  onDone?.(shouldCollapse)
}
