// draw.io iframe:官方 embed 协议(configure → init → load → autosave/save/export)。
// 编辑器页与白板卡片共用;卡片传 lightbox=true,只读、可平移缩放。
//
// 配色:靠 configure 握手把应用主题变量以 customCss 交给 draw.io(见 lib/drawio-theme)。
// 主题只在打开时取一次 —— 编辑器页的 dark 在 DrawioView 里就冻结了,白板卡片实时跟随。
//
// 安全:只处理 event.source 等于自己 iframe.contentWindow 的消息。
// 离线页的 origin 是自定义 scheme(可能报成 null),但 source 已能唯一确定来源。

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  DRAWIO_ONLINE_ORIGIN,
  drawioFrameUrl,
  drawioLoadMessage,
  parseDrawioMessage,
  type DrawioMode
} from '@shared/drawio'
import { drawioThemeConfig } from '../../../lib/drawio-theme'
import { useT } from '../../../hooks/useT'

/**
 * 等握手的上限。在线编辑器首屏要从 embed.diagrams.net 拉 js/app.min.js(约 11MB):
 * 国内实测十几秒,慢网几十秒。原来统一 15s,慢网下必然超时;而且一旦判失败就把 iframe
 * 卸掉,已下载的部分白费、下次还得从零开始 —— 表现出来就是「一直连不上」。
 * 离线包在本地磁盘,15s 只用来兜住坏包。
 */
const HANDSHAKE_TIMEOUT_ONLINE = 60_000
const HANDSHAKE_TIMEOUT_OFFLINE = 15_000
/**
 * iframe 的 load 事件之后 init 还没来:本地页加载完却不握手,多半是包坏了,早点报错。
 * ⚠ 只对离线页成立:在线页的 load 事件在 html/bootstrap.js 之后就会触发,
 * draw.io 的主程序(app.min.js,约 11MB)是 load 之后才动态注入的 —— 用这个信号判死
 * 会在慢网下把本来能成功的加载提前掐掉。
 */
const HANDSHAKE_AFTER_LOAD = 8_000
/** 切模式/卸载前要一份最新 XML,最多等这么久 */
const EXPORT_TIMEOUT = 1_500

export interface DrawioFrameHandle {
  /** 让 iframe 导出当前 XML。未握手/超时返回 null(调用方保留最后一次 autosave)。 */
  exportXml: () => Promise<string | null>
}

interface DrawioFrameProps {
  xml: string
  mode: DrawioMode
  /** 白板卡片:lightbox 只读 */
  lightbox?: boolean
  dark?: boolean
  lang?: 'zh' | 'en'
  title?: string
  onAutosave?: (xml: string) => void
  onSave?: (xml: string) => void
  onOpenLink?: (href: string) => void
  onReady?: () => void
  onError?: (reason: 'timeout' | 'load') => void
}

export const DrawioFrame = forwardRef<DrawioFrameHandle, DrawioFrameProps>(function DrawioFrame(
  { xml, mode, lightbox = false, dark = false, lang = 'zh', title, onAutosave, onSave, onOpenLink, onReady, onError },
  ref
) {
  const t = useT()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  const xmlRef = useRef(xml)
  xmlRef.current = xml
  const lastXmlRef = useRef(xml)
  const pendingExport = useRef<{ resolve: (xml: string | null) => void; timer: number } | null>(null)

  const onAutosaveRef = useRef(onAutosave)
  const onSaveRef = useRef(onSave)
  const onOpenLinkRef = useRef(onOpenLink)
  const onReadyRef = useRef(onReady)
  const onErrorRef = useRef(onError)
  onAutosaveRef.current = onAutosave
  onSaveRef.current = onSave
  onOpenLinkRef.current = onOpenLink
  onReadyRef.current = onReady
  onErrorRef.current = onError

  const src = drawioFrameUrl({ mode, lightbox, dark, lang })
  // 打开时定一次:编辑器页的 dark 由 DrawioView 冻结,卡片则随主题重载。
  // 取色失败也回空配置 —— 不能让 drawio 一直等 configure。
  const themeConfig = useMemo(() => {
    try {
      return drawioThemeConfig(dark)
    } catch {
      return { customCss: '' }
    }
  }, [dark])

  const post = (message: unknown): void => {
    const win = iframeRef.current?.contentWindow
    if (win === null || win === undefined) return
    // draw.io 的 json proto 只认 JSON 字符串(它内部 JSON.parse(event.data));
    // 直接发对象会被解析失败吞掉,表现为「编辑器一直没反应」。
    win.postMessage(JSON.stringify(message), mode === 'online' ? DRAWIO_ONLINE_ORIGIN : '*')
  }

  useImperativeHandle(
    ref,
    () => ({
      exportXml: () =>
        new Promise<string | null>((resolve) => {
          if (!readyRef.current) {
            resolve(null)
            return
          }
          if (pendingExport.current !== null) {
            window.clearTimeout(pendingExport.current.timer)
            pendingExport.current.resolve(null)
          }
          const timer = window.setTimeout(() => {
            pendingExport.current = null
            resolve(null)
          }, EXPORT_TIMEOUT)
          pendingExport.current = { resolve, timer }
          post({ action: 'export', format: 'xml' })
        })
    }),
    // post 只读 ref,不需要依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // 握手计时:超时只在「还没 ready」时生效;iframe load 之后改由更短的计时器接管。
  const timerRef = useRef<number | null>(null)
  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }
  useEffect(() => {
    clearTimer()
    timerRef.current = window.setTimeout(
      () => {
        if (!readyRef.current) onErrorRef.current?.('timeout')
      },
      mode === 'online' ? HANDSHAKE_TIMEOUT_ONLINE : HANDSHAKE_TIMEOUT_OFFLINE
    )
    return clearTimer
  }, [mode])

  // ⚠ 用 useLayoutEffect:draw.io 会先问 configure 再建 UI,监听必须赶在 iframe 脚本之前就位。
  useLayoutEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const frame = iframeRef.current
      if (frame === null || event.source !== frame.contentWindow) return
      if (!originAllowed(event.origin, mode)) return
      const message = parseDrawioMessage(event.data)
      if (message === null) return
      switch (message.event) {
        case 'configure':
          // 借这条通道注入主题变量;不置 ready,等 init 再算握手完成
          post({ action: 'configure', config: themeConfig })
          break
        case 'init':
          readyRef.current = true
          clearTimer()
          setReady(true)
          post(
            drawioLoadMessage(xmlRef.current, {
              autosave: !lightbox,
              dark,
              title
            })
          )
          onReadyRef.current?.()
          break
        case 'autosave':
          lastXmlRef.current = message.xml
          onAutosaveRef.current?.(message.xml)
          break
        case 'save':
          lastXmlRef.current = message.xml
          onSaveRef.current?.(message.xml)
          break
        case 'export': {
          const pending = pendingExport.current
          if (pending !== null) {
            window.clearTimeout(pending.timer)
            pendingExport.current = null
            pending.resolve(message.xml)
          }
          break
        }
        case 'openLink':
          onOpenLinkRef.current?.(message.href)
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // post 只读 ref;mode 变了要重新核对 origin,themeConfig 随 dark 变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, lightbox, dark, title, themeConfig])

  useEffect(
    () => () => {
      const pending = pendingExport.current
      if (pending !== null) {
        window.clearTimeout(pending.timer)
        pendingExport.current = null
        pending.resolve(null)
      }
    },
    []
  )

  return (
    <div className="drawio-frame-wrap" data-drawio-ready={ready ? 'true' : undefined}>
      {!ready && (
        <div className="drawio-loading">
          <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true" />
          <span className="drawio-loading-text">
            <span>{t('notes.drawio.loading')}</span>
            {mode === 'online' && (
              <span className="drawio-loading-hint">{t('notes.drawio.loadingOnlineHint')}</span>
            )}
          </span>
        </div>
      )}
      <iframe
        ref={iframeRef}
        className="drawio-frame"
        src={src}
        title={title ?? 'draw.io'}
        // 让嵌入文档在 drawio 样式生效前也按当前主题取默认底色,深色下不闪白
        style={{ colorScheme: dark ? 'dark' : 'light' }}
        onLoad={() => {
          // 只有本地离线页适用:load 完还不握手就是坏了。在线页此时才开始拉主程序,不能判死。
          if (mode !== 'offline' || readyRef.current) return
          clearTimer()
          timerRef.current = window.setTimeout(() => {
            if (!readyRef.current) onErrorRef.current?.('load')
          }, HANDSHAKE_AFTER_LOAD)
        }}
        // 离线页是自定义 scheme 的独立 origin;allow-same-origin 只放开它自己的存储。
        // 不要写 allow-clipboard-read / allow-clipboard-write:Chromium 没有这两个 sandbox 标记,
        // 会整条属性解析失败并在控制台报错。剪贴板走 Permissions Policy,不需要 sandbox 放开。
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
      />
    </div>
  )
})

function originAllowed(origin: string, mode: DrawioMode): boolean {
  if (mode === 'online') return origin === DRAWIO_ONLINE_ORIGIN
  // 自定义 scheme 在 Chromium 里可能报 null/空串;source 校验已经确定是这枚 iframe
  return origin === 'null' || origin === '' || origin.startsWith('launcher-drawio://')
}
