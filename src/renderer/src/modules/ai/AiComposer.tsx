// ported-from: docs/demo/js/ai.js aiSyncComposer/aiAutoGrow/aiInputKey/aiMention*/aiRenderEngineState/aiRenderConnectCard @ 06ff9ba — demo UI 基线
// 悬浮输入区:引擎 chip(点击跳设置页 AI 面板)/ 未配置引导卡(pulse)/ @ 引用 chips / 自增高 textarea / 发送↔停止
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../../hooks/useT'
import { useAiStore, isRunningHere } from '../../state/ai-store'
import { useUiStore } from '../../state/ui-store'
import { useSettingsNav } from '../../state/settings-nav-store'
import { AiMentionPopover } from './AiMentionPopover'
import type { AiMention } from '@shared/ai'

export function AiComposer({
  showBot,
  scrollBottom
}: {
  showBot: boolean
  scrollBottom: (force?: boolean) => void
}): React.JSX.Element {
  const t = useT()
  const send = useAiStore((s) => s.send)
  const stop = useAiStore((s) => s.stop)
  const guard = useAiStore((s) => s.guardConfigured)
  const engine = useAiStore((s) => s.engine)
  const currentId = useAiStore((s) => s.currentId)
  const runSessionId = useAiStore((s) => s.runSessionId)
  const connectPulse = useAiStore((s) => s.connectPulse)
  const switchModule = useUiStore((s) => s.switchModule)
  const configured = engine?.configured ?? false
  const running = isRunningHere({ runSessionId, currentId })

  const [text, setText] = useState('')
  const [mentions, setMentions] = useState<AiMention[]>([])
  const [popOpen, setPopOpen] = useState(false)
  const [btnMode, setBtnMode] = useState(false)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const mentionBtnRef = useRef<HTMLButtonElement | null>(null)

  // demo aiAutoGrow:高度自适应,上限 160px
  const grow = useCallback((): void => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }, [])

  // 新对话(currentId → null)清空输入与引用(demo aiNewChat;切会话不清)
  useEffect(() => {
    if (currentId === null) {
      setText('')
      setMentions([])
      setPopOpen(false)
    }
  }, [currentId])

  // @ 查询词:最后一个 @ 之后、不含空白;含空白即视为普通文本(弹层关)
  const atIdx = text.lastIndexOf('@')
  const rawQuery = atIdx === -1 ? '' : text.slice(atIdx + 1)
  const queryOk = atIdx !== -1 && !rawQuery.includes(' ') && !rawQuery.includes('\n')

  const onInput = (v: string): void => {
    setText(v)
    // 输入中弹层开着:同步查询词(demo aiOnInput;按钮模式下同样切回查询模式)
    if (popOpen) setBtnMode(false)
  }

  const doSend = (): void => {
    if (running) {
      void stop()
      return
    }
    if (!guard()) return
    const v = text.trim()
    if (!v) return
    const ms = mentions.slice()
    setText('')
    setMentions([])
    setPopOpen(false)
    requestAnimationFrame(grow)
    void send(v, ms.length ? { mentions: ms } : undefined)
    scrollBottom(true)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      doSend()
      return
    }
    if (e.key === 'Escape') {
      setPopOpen(false)
      return
    }
    if (e.key === '@') {
      // 延后一拍:@ 字符先落入输入框,查询词才完整(demo setTimeout 0 同源)
      setTimeout(() => {
        setBtnMode(false)
        setPopOpen(true)
      }, 0)
    }
  }

  const pickMention = (m: AiMention): void => {
    // 从输入里剪掉「@查询词」(demo aiPickMention)
    if (atIdx !== -1 && queryOk) setText(text.slice(0, atIdx))
    setMentions((ms) => (ms.some((x) => x.key === m.key) ? ms : [...ms, m]))
    setPopOpen(false)
    requestAnimationFrame(() => {
      grow()
      taRef.current?.focus()
    })
  }

  const goSettings = (): void => {
    // 引擎 chip 是配置的唯一可见面:跳设置页那份配置(独立导航 store;SettingsView 读 tab)
    useSettingsNav.getState().setTab('ai')
    switchModule('settings')
  }

  const sendTitle = running
    ? t('ai.input.stop')
    : configured
      ? t('ai.input.send')
      : t('ai.connect.title')

  return (
    <div className="ai-composer">
      <button
        className={`ai-scroll-bot${showBot ? ' show' : ''}`}
        type="button"
        title={t('ai.scroll.bottom')}
        onClick={() => scrollBottom(true)}
      >
        <i className="fa-solid fa-arrow-down" />
      </button>
      <div className="ai-composer-inner">
        <button
          className={`ai-engine-chip${configured ? '' : ' off'}`}
          type="button"
          title={t(configured ? 'ai.engine.info' : 'ai.engine.pickProvider')}
          onClick={goSettings}
        >
          <span className="ai-engine-dot" />
          <span>
            {configured && engine ? `${engine.providerName} · ${engine.modelLabel}` : t('ai.engine.unconfigured')}
          </span>
          <i className="fa-solid fa-sliders ai-engine-cog" />
        </button>
        {/* key=脉冲计数:拦截一次重挂一次,CSS 动画(ai-connect-pulse)随之重放(demo 强制重排同效) */}
        <div className="ai-connect-card" key={connectPulse} style={{ display: configured ? 'none' : 'flex' }}>
          <span className="ai-connect-icon">
            <i className="fa-solid fa-key" />
          </span>
          <div className="ai-connect-body">
            <div className="ai-connect-title">{t('ai.connect.title')}</div>
            <div className="ai-connect-desc">{t('ai.connect.desc')}</div>
          </div>
          <button className="d-btn accent" type="button" onClick={goSettings}>
            <span>{t('ai.connect.btn')}</span>
            <i className="fa-solid fa-arrow-right" />
          </button>
        </div>
        <div className={`ai-composer-chips${mentions.length ? ' show' : ''}`}>
          {mentions.map((m, i) => (
            <span className="ai-composer-chip" key={m.key}>
              <i className="fa-solid fa-at" />
              {m.label}
              <i
                className="fa-solid fa-xmark"
                onClick={() => setMentions((ms) => ms.filter((_, n) => n !== i))}
              />
            </span>
          ))}
        </div>
        <div className="ai-composer-box">
          <button
            ref={mentionBtnRef}
            className={`ai-comp-btn${popOpen ? ' active' : ''}`}
            id="aiMentionBtn"
            type="button"
            title={t('ai.input.mention')}
            onClick={() => {
              if (popOpen) {
                setPopOpen(false)
                return
              }
              // 按钮模式:不过滤,列全部(demo aiMentionToggle)
              setBtnMode(true)
              setPopOpen(true)
            }}
          >
            <i className="fa-solid fa-at" />
          </button>
          <textarea
            ref={taRef}
            className="ai-input"
            id="aiInput"
            rows={1}
            placeholder={t(configured ? 'ai.input.ph' : 'ai.input.phLocked')}
            value={text}
            onChange={(e) => {
              onInput(e.target.value)
              grow()
            }}
            onKeyDown={onKeyDown}
          />
          <button
            className={`ai-send${running ? ' stop' : ''}${!configured && !running ? ' disabled' : ''}`}
            id="aiSendBtn"
            type="button"
            title={sendTitle}
            onClick={doSend}
          >
            <i className={`fa-solid ${running ? 'fa-stop' : 'fa-arrow-up'}`} />
          </button>
        </div>
        <div className="ai-composer-hint">{t('ai.welcome.hint')}</div>
      </div>
      <AiMentionPopover
        open={popOpen && (btnMode || queryOk)}
        btnMode={btnMode}
        query={rawQuery}
        anchorRef={mentionBtnRef}
        onPick={pickMention}
        onClose={() => setPopOpen(false)}
      />
    </div>
  )
}
