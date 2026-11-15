// draw.io 离线资源的本地协议:launcher-drawio://app/v<版本>/<相对路径>
//
// 为什么不用 file://:资源包里有上万个小文件(字体/模具/图片),file:// 会把整个安装目录
// 暴露给 draw.io 页面;而且 drawio 需要稳定的 origin 来存自己的设置。
// 这个 scheme 在 app ready 之前登记特权,ready 之后只服务 userData/drawio/v<版本>/ 内的文件。
//
// E2E 不下载 50MB 资源包:LAUNCHER_E2E_DRAWIO_STUB=1 时由这里直接提供实现同一套
// embed 协议的 stub 页面。生产方式不受影响。

import { protocol, type CustomScheme } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import {
  DRAWIO_PACK_DIR,
  DRAWIO_SCHEME,
  DRAWIO_STUB_HTML
} from '../../shared/drawio'
import { noteFileMime } from '../../shared/notes'
import { drawioVersionDir } from './drawio-pack'

/**
 * 资源页的 CSP。draw.io 自己用 eval + inline script + blob worker,
 * 这部分能力必须放开;connect-src 只留自身,离线模式不对外发请求。
 * 不写 frame-ancestors:它本来就要被应用的 iframe 嵌。
 */
const DRAWIO_CSP =
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; " +
  "font-src 'self' data:; " +
  "media-src 'self' data: blob:; " +
  "connect-src 'self'; " +
  "worker-src 'self' blob:; " +
  "frame-src 'self' data: blob:"

/** draw.io 资源 scheme 的特权描述。由 schemes.ts 与笔记附件 scheme 一起登记。 */
export function drawioSchemePrivileges(): CustomScheme {
  return {
    scheme: DRAWIO_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: false
    }
  }
}

export interface DrawioProtocolDeps {
  userDataDir: string
  /** E2E stub:不要求真实资源包 */
  stub: boolean
  log?: (message: string) => void
}

/** ready 之后调用 */
export function handleDrawioProtocol(deps: DrawioProtocolDeps): void {
  const handler = createDrawioHandler(deps)
  protocol.handle(DRAWIO_SCHEME, (req) => handler(req.url))
}

/**
 * 把请求 URL 映射成响应。单独导出让单测不依赖 Electron 的 protocol 注册。
 */
export function createDrawioHandler(deps: DrawioProtocolDeps): (requestUrl: string) => Promise<Response> {
  const versionRoot = drawioVersionDir(deps.userDataDir)
  return async (requestUrl: string): Promise<Response> => {
    let url: URL
    try {
      url = new URL(requestUrl)
    } catch {
      return new Response('forbidden', { status: 403 })
    }

    if (url.hostname === 'stub') {
      if (!deps.stub) return new Response('not found', { status: 404 })
      return htmlResponse(DRAWIO_STUB_HTML)
    }
    if (url.hostname !== 'app') return new Response('not found', { status: 404 })

    let segments: string[]
    try {
      segments = url.pathname
        .split('/')
        .filter((s) => s !== '')
        .map((s) => decodeURIComponent(s))
    } catch {
      return new Response('forbidden', { status: 403 })
    }
    if (segments[0] !== DRAWIO_PACK_DIR) return new Response('not found', { status: 404 })

    const rel = segments.slice(1)
    const target = resolve(versionRoot, ...rel)
    if (target !== versionRoot && !target.startsWith(versionRoot + sep)) {
      deps.log?.(`拒绝越界资源:${requestUrl}`)
      return new Response('forbidden', { status: 403 })
    }

    // E2E:没有真实包时,index.html 用 stub 顶上;其余资源照常 404(测试页是自包含的)
    if (deps.stub && rel[rel.length - 1] === 'index.html') {
      const ready = await fileStatus(target)
      if (!ready) return htmlResponse(DRAWIO_STUB_HTML)
    }

    try {
      const info = await stat(target)
      if (!info.isFile()) return new Response('not found', { status: 404 })
      const body = await readFile(target)
      const ext = extname(target).slice(1).toLowerCase()
      const headers: Record<string, string> = {
        'Content-Type': noteFileMime(ext),
        'X-Content-Type-Options': 'nosniff',
        // 版本化路径:同一个版本内资源不会变
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin'
      }
      if (ext === 'html' || ext === 'htm') headers['Content-Security-Policy'] = DRAWIO_CSP
      return new Response(body, { status: 200, headers })
    } catch {
      return new Response('not found', { status: 404 })
    }
  }
}

async function fileStatus(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': DRAWIO_CSP
    }
  })
}
