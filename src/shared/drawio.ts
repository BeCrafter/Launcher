// draw.io 的共享契约:固定版本、地址、embed 协议消息。
// 编辑器页与白板卡片共用同一套 URL 与握手类型,避免两边各自拼参数。

/** 离线资源包的固定版本。升级时同步改 SHA-256 与字节数。 */
export const DRAWIO_PACK_VERSION = '32.6.10'
export const DRAWIO_PACK_URL = `https://github.com/jgraph/drawio/releases/download/v${DRAWIO_PACK_VERSION}/draw.war`
/** GitHub release 给 draw.war 的 sha256 */
export const DRAWIO_PACK_SHA256 = 'a57b06b3b6a876a351dacfe65d027d9509319cd030e9bacf6ae04a034d66a38f'
export const DRAWIO_PACK_BYTES = 49_729_549

/**
 * GitHub 直连的加速镜像,按实测速度排序(国内 21KB/s → 20MB/s 量级)。
 * **只换下载通道,不换信任根**:镜像拿到的字节照样要过下面那个固定 sha256,
 * 所以镜像既不能替换内容,也不能在文件里夹带东西;全部失败时仍会回落到 GitHub 原文。
 */
export const DRAWIO_PACK_MIRRORS = [
  `https://gh-proxy.com/${DRAWIO_PACK_URL}`,
  `https://ghfast.top/${DRAWIO_PACK_URL}`
] as const

/** 依次尝试的下载源:镜像优先,GitHub 原文兜底。 */
export function drawioPackSources(primary: string = DRAWIO_PACK_URL): string[] {
  return [DRAWIO_PACK_MIRRORS[0], DRAWIO_PACK_MIRRORS[1], primary]
}

export const DRAWIO_SCHEME = 'launcher-drawio'
export const DRAWIO_ONLINE_ORIGIN = 'https://embed.diagrams.net'
export const DRAWIO_PACK_DIR = `v${DRAWIO_PACK_VERSION}`

/**
 * E2E 用的 draw.io 替身页:实现同一套 embed 协议(configure/init/load/autosave/save/export),
 * 但不含有真实 draw.io 的编辑器。只在 LAUNCHER_E2E_DRAWIO_STUB=1 时由主进程提供。
 * 自包含、不请求外部资源,用例可以直接在 iframe 里点「修改图表」验证整条保存链。
 */
export const DRAWIO_STUB_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>draw.io (stub)</title>
<style>
html,body{height:100%;margin:0;background:#fff;color:#333;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{display:flex;align-items:center;justify-content:center}
.app{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}
.dark{background:#1f1f1f;color:#ddd}
.badge{font-size:11px;color:#888}
.cell{padding:8px 14px;border:1px solid #d0d0d0;border-radius:6px;background:#fafafa;max-width:80%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dark .cell{background:#2a2a2a;border-color:#444}
button{font:inherit;padding:6px 12px;border:1px solid #bbb;border-radius:6px;background:#fff;color:#333;cursor:pointer}
button:hover{border-color:#e87722;color:#e87722}
.dark button{background:#333;color:#ddd;border-color:#555}
</style>
</head>
<body><div class="app" id="app"></div>
<script>
(function(){
  var params = new URLSearchParams(location.search)
  var lightbox = params.get('lightbox') === '1'
  var configure = params.get('configure') === '1'
  var xml = ''
  var app = document.getElementById('app')
  var stub = window.__drawioStub = {
    xml: '',
    loaded: false,
    configured: !configure,
    config: null,
    mode: lightbox ? 'lightbox' : 'editor'
  }
  // 与真实 draw.io 一致:两个方向都用 JSON 字符串(json proto)
  function post(m){ parent.postMessage(JSON.stringify(m), '*') }
  // configure=1 时,真实 draw.io 会等父页这份配置再继续建 UI;这里也照做,
  // 父页漏回 configure 就会一直等到用例超时,不会悄悄绿。
  function applyConfig(config){
    stub.config = config && typeof config === 'object' ? config : null
    var css = stub.config && typeof stub.config.customCss === 'string' ? stub.config.customCss : ''
    if (css === '') return
    var style = document.createElement('style')
    style.id = 'drawio-custom-css'
    style.textContent = css
    document.head.appendChild(style)
  }
  function values(){
    var out = []
    var re = /<mxCell[^>]*\\bvalue="([^"]*)"/g
    var m
    while ((m = re.exec(xml)) !== null) out.push(m[1])
    return out
  }
  function render(){
    app.textContent = ''
    app.classList.toggle('dark', params.get('dark') === '1')
    var box = document.createElement('div')
    box.className = 'app'
    var badge = document.createElement('div')
    badge.className = 'badge'
    badge.textContent = lightbox ? 'draw.io 预览 (stub)' : 'draw.io 编辑器 (stub)'
    box.appendChild(badge)
    var vals = values()
    var cell = document.createElement('div')
    cell.className = 'cell'
    cell.textContent = vals.length > 0 ? vals.join(' · ') : '空图表'
    box.appendChild(cell)
    if (lightbox) {
      var zoom = document.createElement('button')
      zoom.dataset.stubAction = 'zoom'
      zoom.textContent = '放大'
      zoom.onclick = function(){ zoom.textContent = '已放大' }
      box.appendChild(zoom)
    } else {
      var edit = document.createElement('button')
      edit.dataset.stubAction = 'edit'
      edit.textContent = '修改图表'
      edit.onclick = function(){
        xml = '<mxfile host="stub"><diagram id="stub" name="Page-1"><mxGraphModel><root>' +
          '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
          '<mxCell id="2" value="stub-edit" vertex="1" parent="1"/>' +
          '</root></mxGraphModel></diagram></mxfile>'
        stub.xml = xml
        render()
        post({ event: 'autosave', xml: xml })
      }
      box.appendChild(edit)
    }
    app.appendChild(box)
  }
  window.addEventListener('message', function(e){
    var d = e.data
    if (typeof d === 'string') {
      try { d = JSON.parse(d) } catch (err) { return }
    }
    if (!d || typeof d !== 'object') return
    if (d.action === 'configure' && !stub.configured) {
      applyConfig(d.config)
      stub.configured = true
      post({ event: 'init' })
    } else if (d.action === 'load') {
      xml = typeof d.xml === 'string' ? d.xml : ''
      stub.xml = xml
      stub.loaded = true
      stub.dark = !!d.dark
      render()
    } else if (d.action === 'export') {
      post({ event: 'export', format: d.format || 'xml', xml: xml })
    }
  })
  render()
  if (configure) {
    post({ event: 'configure' })
  } else {
    post({ event: 'init' })
  }
})()
</script>
</body>
</html>`


/** 左栏类型与白板嵌入共用的扩展名。 */
export const DRAWIO_EXTENSIONS = ['drawio', 'dio'] as const
export type DrawioExtension = (typeof DRAWIO_EXTENSIONS)[number]

export function isDrawioExtension(ext: string): boolean {
  const e = ext.replace(/^\./, '').toLowerCase()
  return e === 'drawio' || e === 'dio'
}

/**
 * 磁盘上的内容是不是可交给 draw.io 的图。
 * 空文件视为合法(新建后还没画,draw.io 自己会填空白图);
 * 非空时必须含 mxfile 或 mxGraphModel,否则阻止编辑器把它当成图打开。
 */
export function isDrawioText(text: string): boolean {
  const value = text.trim()
  if (value === '') return true
  return /<(?:mxfile|mxGraphModel)[\s>]/i.test(value)
}

/** 给「用空白图表替换」和第一次空白保存用的最小合法图。 */
export function blankDrawioXml(): string {
  const id = Math.random().toString(36).slice(2, 10)
  return (
    `<mxfile host="launcher" agent="Launcher" version="${DRAWIO_PACK_VERSION}">` +
    `<diagram id="${id}" name="Page-1">` +
    '<mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" ' +
    'connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" ' +
    'math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>' +
    '</diagram></mxfile>'
  )
}

export type DrawioMode = 'online' | 'offline'

export interface DrawioFrameUrlOptions {
  mode: DrawioMode
  /** 只读卡片:lightbox 模式,可平移缩放,不出工具栏。 */
  lightbox?: boolean
  dark?: boolean
  lang?: 'zh' | 'en'
  /** 离线包版本;默认当前固定版本。 */
  packVersion?: string
}

/** draw.io embed URL。online 走官方 embed 主机,offline 走本地特权 scheme。 */
export function drawioFrameUrl({
  mode,
  lightbox = false,
  dark = false,
  lang = 'zh',
  packVersion = DRAWIO_PACK_VERSION
}: DrawioFrameUrlOptions): string {
  const base =
    mode === 'offline'
      ? `${DRAWIO_SCHEME}://app/v${packVersion}/index.html`
      : `${DRAWIO_ONLINE_ORIGIN}/`
  const params = new URLSearchParams()
  params.set('embed', '1')
  params.set('proto', 'json')
  params.set('spin', '1')
  params.set('noSaveBtn', '1')
  params.set('noExitBtn', '1')
  params.set('saveAndExit', '0')
  // 让 draw.io 先问父页要配置:我们借这条通道注入主题变量(customCss)。
  params.set('configure', '1')
  params.set('lang', lang)
  params.set('dark', dark ? '1' : '0')
  if (mode === 'offline') params.set('offline', '1')
  if (lightbox) {
    params.set('lightbox', '1')
    params.set('nav', '1')
  }
  return `${base}?${params.toString()}`
}

/** 父页发给 iframe 的消息。 */
export interface DrawioLoadMessage {
  action: 'load'
  xml: string
  autosave: 0 | 1
  dark: boolean
  title?: string
}

export function drawioLoadMessage(
  xml: string,
  options: { autosave: boolean; dark: boolean; title?: string }
): DrawioLoadMessage {
  return {
    action: 'load',
    xml,
    autosave: options.autosave ? 1 : 0,
    dark: options.dark,
    ...(options.title === undefined ? {} : { title: options.title })
  }
}

/** 父页回给 draw.io 的 configure 配置。customCss 由 shared/drawio-theme 生成。 */
export interface DrawioConfigureConfig {
  customCss: string
}

export interface DrawioConfigureMessage {
  action: 'configure'
  config: DrawioConfigureConfig
}

/** iframe 发回父页、我们关心的消息。 */
export type DrawioMessage =
  | { event: 'configure' }
  | { event: 'init' }
  | { event: 'autosave'; xml: string }
  | { event: 'save'; xml: string }
  | { event: 'export'; format: string; xml: string }
  | { event: 'openLink'; href: string }

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * 收窄 iframe 消息。draw.io 会发很多事件;只认协议里需要的几种,
 * 且字段类型不对就丢掉,不让外来消息把保存逻辑带偏。
 */
export function parseDrawioMessage(data: unknown): DrawioMessage | null {
  // 真实 draw.io(json proto)两个方向都走 JSON **字符串**:
  //   子页 postMessage(JSON.stringify({event:'init'});父页也要 JSON.stringify 再发 load。
  // E2E 的 stub 一开始发的是对象,把这个差异盖住了 —— 在线编辑器因此永远握不上手。
  // 这里同时接受字符串和对象:stub / 旧版本都不至于失效。
  let value: unknown = data
  if (typeof data === 'string') {
    try {
      value = JSON.parse(data)
    } catch {
      return null
    }
  }
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const event = raw.event
  switch (event) {
    case 'configure':
      return { event: 'configure' }
    case 'init':
      return { event: 'init' }
    case 'autosave':
    case 'save':
      return nonEmptyString(raw.xml) ? { event, xml: raw.xml } : null
    case 'export':
      return nonEmptyString(raw.xml)
        ? { event: 'export', format: typeof raw.format === 'string' ? raw.format : 'xml', xml: raw.xml }
        : null
    case 'openLink':
      return nonEmptyString(raw.href) ? { event: 'openLink', href: raw.href } : null
    default:
      return null
  }
}

/** 离线包状态。stub 只在 E2E 下为 true:本地没有包,由协议层直接提供测试页。 */
export interface DrawioStatus {
  installed: boolean
  version: string
  stub: boolean
  downloading: boolean
}

export type DrawioDownloadPhase = 'download' | 'verify' | 'extract'

export interface DrawioProgress {
  phase: DrawioDownloadPhase
  received: number
  total: number
}

export interface DrawioStatusEvent {
  status: DrawioStatus
  progress?: DrawioProgress
}
