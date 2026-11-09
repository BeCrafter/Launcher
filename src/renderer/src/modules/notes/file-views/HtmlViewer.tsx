// HTML 预览:沙箱 iframe,执行脚本但**不给 allow-same-origin**。
// 不透明 origin 下它读不到应用 DOM / localStorage;CSP 由主进程按 scheme 源下发。
// 用协议 URL 而不是 srcdoc:相对资源(style.css / img.png / data.json)才能自然解析。

export function HtmlViewer({ src }: { src: string }): React.JSX.Element {
  return (
    <iframe
      className="file-preview-frame"
      data-file-frame="html"
      title="HTML preview"
      // 无 allow-same-origin / allow-top-navigation:脚本也跨不过沙箱
      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
      src={src}
    />
  )
}
