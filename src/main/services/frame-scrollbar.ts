// 预览里嵌进来的 PDF / 本地网页是**跨源帧**:父页面的 CSS 进不去。
// Chromium 自带的 PDF 阅读器还会在插件包装页上画一条系统风的白底粗滚动条 ——
// 和应用的细滚动条完全不是一套,在浅色主题里尤其扎眼。
//
// 主进程能拿到这些帧(WebFrameMain),所以直接把同款滚动条样式 + 滚动监听注入它们自己的文档:
//   · 轨道透明、滑块平时也透明(但元素仍在,鼠标移上去能拖);
//   · 滚动中才显形,停下 900ms 后重新隐去 —— 与 .notes-preview 的 [data-scrolling] 同一套节奏。
// 注入失败只可能是未来 Chromium 改了包装页结构,静默跳过即可,不影响正文。

import type { WebFrameMain } from 'electron'

/** 附件协议前缀(见 services/notes-protocol.ts) */
const NOTES_ASSET_PREFIX = 'launcher-note://asset/'

/**
 * 只处理会在预览里以 iframe 出现、滚动条由**第三方文档自己画**的两类:
 * PDF(Chromium 阅读器包装页)与本地网页。图片/音视频不产生文档滚动;外部 https 页面是别人的页面,不动。
 */
export function isEmbeddedDocUrl(url: string): boolean {
  if (!url.startsWith(NOTES_ASSET_PREFIX)) return false
  const rest = url.slice(NOTES_ASSET_PREFIX.length)
  const path = rest.split(/[?#]/, 1)[0] ?? ''
  return /\.(?:pdf|html?)$/i.test(path)
}

/**
 * 与 .notes-preview 同一套观感:槽 10px,滑块四周 4px 透明边 → 实际 2px;
 * 默认颜色 transparent,滚动时由脚本把 `--launcher-frame-thumb` 设成可见色。
 */
export const FRAME_SCROLLBAR_CSS = [
  ':root{--launcher-frame-thumb:transparent}',
  '::-webkit-scrollbar{width:10px;height:10px}',
  '::-webkit-scrollbar-track{background:transparent}',
  '::-webkit-scrollbar-thumb{background:var(--launcher-frame-thumb);border:4px solid transparent;border-radius:999px;background-clip:padding-box}',
  '::-webkit-scrollbar-thumb:hover{background:rgba(124,129,148,.5);background-clip:padding-box}',
  '::-webkit-scrollbar-corner{background:transparent}'
].join('\n')

/**
 * 注入脚本。`window.__launcherFrameScrollbar` 做幂等标记 —— did-frame-finish-load 可能重复触发。
 * 滚动监听用 capture:`scroll` 不冒泡,但捕获阶段能收到文档与内部滚动容器的滚动。
 */
export const FRAME_SCROLLBAR_SCRIPT = `(() => {
  if (window.__launcherFrameScrollbar === true) return 'already'
  window.__launcherFrameScrollbar = true
  const style = document.createElement('style')
  style.id = 'launcher-frame-scrollbar'
  style.textContent = ${JSON.stringify(FRAME_SCROLLBAR_CSS)}
  ;(document.head || document.documentElement).appendChild(style)
  const root = document.documentElement
  let idle = 0
  window.addEventListener(
    'scroll',
    () => {
      root.style.setProperty('--launcher-frame-thumb', 'rgba(124,129,148,.55)')
      clearTimeout(idle)
      idle = setTimeout(() => root.style.removeProperty('--launcher-frame-thumb'), 900)
    },
    { capture: true, passive: true }
  )
  return 'installed'
})()`

/** 给一个已载入的内嵌文档装上细滚动条;非目标 URL 直接跳过。 */
export async function installFrameScrollbar(frame: WebFrameMain): Promise<boolean> {
  if (!isEmbeddedDocUrl(frame.url)) return false
  try {
    await frame.executeJavaScript(FRAME_SCROLLBAR_SCRIPT)
    return true
  } catch {
    // 帧在注入前被销毁 / 未来 Chromium 改了包装页:算了,正文不受影响
    return false
  }
}
