// 应用组合根:引导(设置生效 + splash 移除)→ 外壳
import { bootstrap } from './state/bootstrap'
import { AppShell } from './layout/AppShell'

bootstrap()

export default function App(): React.JSX.Element {
  // preload 未成功注入时给出可诊断的错误页而非白屏
  if (!window.launcher) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
        <h1>preload 未加载</h1>
        <p style={{ color: '#c00' }}>window.launcher 不存在——请检查主进程 preload 路径与构建输出是否一致。</p>
      </div>
    )
  }
  return <AppShell />
}
