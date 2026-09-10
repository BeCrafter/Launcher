import { useEffect, useState } from 'react'
import Logo, { LOGO_VARIANTS, type LogoVariant } from './components/Logo'

export default function App(): React.JSX.Element {
  const [pong, setPong] = useState('')
  const [variant, setVariant] = useState<LogoVariant>('rocketOrbit2')
  const [light, setLight] = useState(false)

  // 移除「启动中」过渡页（幂等；先于错误分支，避免遮盖错误信息）
  document.getElementById('boot-splash')?.remove()

  // preload 未成功注入时给出可诊断的错误页而非白屏
  if (!window.launcher) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
        <h1>preload 未加载</h1>
        <p style={{ color: '#c00' }}>window.launcher 不存在——请检查主进程 preload 路径与构建输出是否一致。</p>
      </div>
    )
  }

  const { appName, versions } = window.launcher

  useEffect(() => {
    window.launcher.ping().then(setPong)
    window.launcher.logoGet().then((v) => setVariant(v as LogoVariant))
  }, [])

  const pickVariant = (v: LogoVariant): void => {
    setVariant(v)
    window.launcher.logoSet(v)
  }

  const toggleTheme = (): void => {
    const next = !light
    setLight(next)
    document.body.classList.toggle('light-theme', next)
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Logo variant={variant} size={56} />
        <div>
          <h1 style={{ margin: 0 }}>{appName}</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--app-dim)' }}>
            Electron {versions.electron} · Node {versions.node} · IPC ping: {pong || '…'}
          </p>
        </div>
        <button onClick={toggleTheme} style={{ marginLeft: 'auto' }}>
          {light ? '切换深色' : '切换浅色'}
        </button>
      </header>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 14, color: 'var(--app-dim)' }}>选择 Logo（临时预览，阶段 5 并入设置页）</h2>
        <div style={{ display: 'flex', gap: 16 }}>
          {LOGO_VARIANTS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => pickVariant(id)}
              title={`切换菜单栏 / Dock / 应用内 Logo`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                padding: 16,
                borderRadius: 12,
                cursor: 'pointer',
                background: 'transparent',
                color: 'inherit',
                border: id === variant ? '2px solid #7c6af4' : '1px solid #666'
              }}
            >
              <Logo variant={id} size={56} />
              <span style={{ fontSize: 13 }}>{label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
