// 渲染层入口:样式加载顺序对齐 demo(index.html link 顺序):
// FontAwesome(最先,同 demo) → 字体 → base → layout → views → settings → drawer → ai
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fortawesome/fontawesome-free/css/all.min.css'
import '@fontsource/noto-sans-sc/400.css'
import '@fontsource/noto-sans-sc/500.css'
import '@fontsource/noto-sans-sc/700.css'
import '@fontsource/noto-serif-sc/700.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/views.css'
import './styles/settings.css'
import './styles/drawer.css'
import './styles/ai.css'
import './styles/app-chrome.css'
import App from './App'
import { AppErrorBoundary } from './boot/ErrorBoundary'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {/* 兜底要在最外层:commit 之后的渲染/副作用异常否则会把整棵树卸掉,留下一扇空窗口 */}
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
)
