// 应用外壳的兜底(应用新增,非 demo 移植)
//
// 为什么需要它:启动过渡页只覆盖「首次 commit 之前」,8s 兜底也只在过渡页还在 DOM 里时才生效 ——
// commit 之后再抛错,React 会把整棵树卸掉,用户得到一扇「活着但什么都没有」的主题色空窗口,
// 没有文案也没有重试入口(2026-09-23 白屏修复的同一类失败形态,只是发生在更晚的时刻)。
//
// 样式用应用自己的 CSS 变量(--bg/--text/--muted):能走到这里说明界面已经挂载过,样式表一定在。

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('[app] 界面渲染失败', error)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: '0 24px',
          textAlign: 'center',
          background: 'var(--bg, #0e0e17)',
          color: 'var(--text, #e6e6f0)',
          fontFamily: 'system-ui, sans-serif'
        }}
        role="alert"
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>界面出错了</div>
        <div style={{ fontSize: 12, color: 'var(--muted, #8e8ea8)', maxWidth: 560, wordBreak: 'break-word' }}>
          {this.state.error.message}
        </div>
        <button
          type="button"
          style={{
            marginTop: 4,
            padding: '6px 14px',
            border: '1px solid var(--border2, rgba(255,255,255,.1))',
            borderRadius: 8,
            background: 'transparent',
            color: 'var(--accent, #7c6af4)',
            fontSize: 12,
            cursor: 'pointer'
          }}
          onClick={() => window.location.reload()}
        >
          重新加载
        </button>
      </div>
    )
  }
}
