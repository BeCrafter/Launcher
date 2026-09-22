// ported-from: docs/demo/js/ai.js + index.html #view-ai @ 06ff9ba — demo UI 基线(AI 页为冻结例外,2026-09-13 重设计)
// AI 助手对话页(逐行为移植 ai.js renderAiChat 的 React 版):
// 左会话栏(collapsed 持久化 localStorage)+ 右对话画布(贴底滚动/回底浮标)+ 悬浮输入区。
// 消息模型为 shared/ai.ts 的内容块数组,渲染归组见 AiMessages.tsx。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../../hooks/useT'
import { useAiStore } from '../../state/ai-store'
import { AiRail } from './AiRail'
import { AiMessages } from './AiMessages'
import { AiComposer } from './AiComposer'
import { AiMcpModal } from './AiMcpModal'

const RAIL_LS_KEY = 'launcherAiRailCollapsed'

export function AiView(): React.JSX.Element {
  const t = useT()
  // store 引导(事件订阅/引擎/技能/会话列表;模块级幂等)
  useAiStore((s) => s.sessions)
  useAiStore((s) => s.engine)
  useAiStore((s) => s.skills)
  useEffect(() => {
    const st = useAiStore.getState()
    st.init()
    // 每次进入 AI 页都重新拉引擎态与会话列表:init 只跑一次,
    // 而「去设置页配好模型再回来」是最常见的路径 —— 不刷新就会停在旧的「未配置」,
    // 表现为发送钮一直置灰、点了没反应
    void st.loadEngine()
    void st.loadSessions()
  }, [])

  // ── 滚动(demo aiOnScroll/aiScrollBottom)──
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)
  const [showBot, setShowBot] = useState(false)
  const messages = useAiStore((s) => s.messages)
  const currentId = useAiStore((s) => s.currentId)

  const onScroll = useCallback((): void => {
    const sc = scrollRef.current
    if (!sc) return
    const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80
    stickRef.current = near
    setShowBot(!near && useAiStore.getState().messages.length > 0)
  }, [])

  const scrollBottom = useCallback((force = false): void => {
    if (!stickRef.current && !force) return
    const sc = scrollRef.current
    if (sc) sc.scrollTop = sc.scrollHeight
  }, [])

  // 消息流式增长:贴底跟随(demo 每次 patch 后 aiScrollBottom)
  useEffect(() => {
    scrollBottom()
    setShowBot(!stickRef.current && messages.length > 0)
  }, [messages, scrollBottom])
  // 切会话/新对话强制回底(demo aiRenderMessages(true))
  useEffect(() => {
    stickRef.current = true
    setShowBot(false)
    requestAnimationFrame(() => scrollBottom(true))
  }, [currentId, scrollBottom])

  // ── 会话栏开合(collapsed 持久化;≤900px 为覆盖层)──
  const [railCollapsed, setRailCollapsed] = useState(
    () => localStorage.getItem(RAIL_LS_KEY) === 'true'
  )
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 900)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)')
    const sync = (): void => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const toggleRail = useCallback((): void => {
    if (window.innerWidth <= 900) {
      setMobileOpen((v) => !v)
    } else {
      setRailCollapsed((v) => {
        const next = !v
        localStorage.setItem(RAIL_LS_KEY, next ? 'true' : 'false')
        return next
      })
    }
  }, [])

  // 折叠钮的 is-in 与 tooltip 跟随可见性(demo aiSyncRailToggle:图标恒为 fa-angles-right,展开态 CSS 旋转 180°)
  const railVisible = isMobile ? mobileOpen : !railCollapsed

  return (
    <div id="view-ai" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>
      <div className="ai-shell" id="aiShell">
        <AiRail collapsed={railCollapsed} mobileOpen={mobileOpen} />
        <section className="ai-main">
          <button
            className={`ai-rail-toggle${railVisible ? ' is-in' : ''}`}
            type="button"
            onClick={toggleRail}
            title={t(railVisible ? 'ai.rail.collapse' : 'ai.rail.expand')}
          >
            <i className="fa-solid fa-angles-right" />
          </button>
          <div className="ai-scroll" id="aiScroll" ref={scrollRef} onScroll={onScroll}>
            <div className="ai-col" id="aiCol">
              <AiMessages />
            </div>
          </div>
          <AiComposer showBot={showBot} scrollBottom={scrollBottom} />
        </section>
      </div>
      <AiMcpModal />
    </div>
  )
}
