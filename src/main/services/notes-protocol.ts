// 笔记附件协议:让预览能加载笔记目录内的图片、视频、音频、PDF 与本地网页。
//
// 为什么不用 `file://`:渲染层经 loadFile 加载,`file://` 子资源与页面同源 —— 等于把整个文件系统
// 暴露给预览里任意一个 `<img src>`。也不走 base64 IPC:那会把 MB 级字符串常驻渲染层内存,
// 还失去 URL 级缓存(同一张图每次重渲染都要重传)。
//
// 这个处理器是「读到笔记目录之外」的入口之一(AI 的 read_note_image 是另一个),
// 所以三道闸收在一个纯函数里(domains/note-asset.ts 的 resolveAssetRel),**两条路共用同一份**:
//   ① 只服务 assets/ 下的文件;
//   ② 扩展名走白名单(shared/notes.ts 的 ASSET_KINDS,**不含 svg** —— 作为文档打开时是 XSS 向量);
//   ③ 解析后断言仍在笔记目录内(路径穿越)。
//
// 视频/音频还多一件事:**Range 请求**。没有它进度条拖不动、只能从头播 ——
// Chromium 对 `<video>` 总是发 Range,回 200 整份会让它以为不支持 seek。

import { protocol } from 'electron'
import { open, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import {
  MAX_FILE_BYTES_READ,
  NOTES_ASSET_SCHEME,
  NOTES_FILE_HOST,
  noteAssetMime,
  noteFileMime,
  type NoteAssetKind
} from '../../shared/notes'
import { resolveAssetRel, type ResolvedAsset } from '../domains/note-asset'
import { resolveReadableFile } from '../domains/note-file'

export type { ResolvedAsset }

/**
 * 每类附件各自的 CSP。
 *
 * 图片给最严的一档:即便被直接当文档打开,也没有脚本与外链能力。
 * 本地网页(iframe 嵌入用)必须放开脚本与样式,否则静态站点全废 —— 但它跑在
 * 一个**跨源**的 sandbox iframe 里(见 markdown.tsx 的 renderEmbedExt),碰不到渲染层。
 * `connect-src 'self'` 允许它 fetch 同目录的数据文件,但不许对外发请求。
 * 视频/音频/PDF 不发 CSP:它们是媒体/插件文档,加了只会把播放器本身拦掉。
 */
const CSP: Partial<Record<NoteAssetKind, string>> = {
  image: "default-src 'none'; sandbox",
  page:
    "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' data:; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; " +
    "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'"
}

/**
 * `launcher-note://file/` 上的 HTML 页面 CSP。
 *
 * 页面跑在**没有 allow-same-origin** 的 sandbox iframe 里,origin 是 opaque,
 * 所以 `'self'` 匹配不到任何东西 —— 必须用 scheme 源 `launcher-note:`。
 * 只放开同目录资源与内联脚本/样式;外网一律不放行(CDN 页面会缺资源,这是刻意的)。
 */
const FILE_PAGE_CSP =
  'default-src launcher-note: data: blob:; ' +
  "script-src launcher-note: 'unsafe-inline' data:; " +
  "style-src launcher-note: 'unsafe-inline' data:; " +
  'img-src launcher-note: data: blob:; ' +
  'media-src launcher-note: data: blob:; ' +
  'font-src launcher-note: data:; ' +
  'connect-src launcher-note: data: blob:; ' +
  "object-src 'none'; base-uri 'none'; form-action 'none'"

/** SVG 作为图片查看(不进文档上下文执行脚本) */
const FILE_SVG_CSP = "default-src 'none'; sandbox"

function isHtmlExt(ext: string): boolean {
  return ext === 'html' || ext === 'htm' || ext === 'xhtml'
}

/** 不带 Range 时允许整份读进内存的上限。超过就让它走 Range —— 浏览器播放器本来就会发 */
const MAX_FULL_READ = 64 * 1024 * 1024

/**
 * `launcher-note://asset/<relPath>` → 笔记目录内的绝对路径 + 附件类型。
 * 任何越界、非白名单、形态不对的输入都返回 null(调用方回 403),不做任何「猜一个近似的路径」。
 *
 * 纯函数、不碰 fs —— 三道闸里最容易写错的那道在 domains/note-asset.ts 的 resolveAssetRel 里
 * (AI 的按需读图共用同一份),已被单测钉住。
 */
export function resolveAssetPath(dir: string, rawUrl: string): ResolvedAsset | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.hostname !== 'asset') return null

  let rel: string
  try {
    rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  } catch {
    return null // 非法百分号编码
  }
  return resolveAssetRel(dir, rel)
}

/**
 * `launcher-note://file/<relPath>` → 笔记目录内的绝对路径。
 * 与文件行共用 `resolveReadableFile`:额外允许根层 `assets/`(页面引用附件很常见),
 * 其余越界 / 符号链接 / 目录一律拒绝。只读,不开写入口。
 *
 * 查询串只用于缓存版本(`?v=nonce`),不参与路径解析。
 */
export function resolveFilePath(dir: string, rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.hostname !== NOTES_FILE_HOST) return null
  let rel: string
  try {
    rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  } catch {
    return null // 非法百分号编码
  }
  return resolveReadableFile(dir, rel)
}

export interface ByteRange {
  start: number
  end: number
}

/**
 * 解析 `Range: bytes=start-end`(只认单区间 —— 播放器不会发多区间)。
 * 不合法的区间返回 null,调用方回 200 整份(比回 416 宽容,也更少出错)。
 */
export function parseRange(header: string | null, size: number): ByteRange | null {
  if (header === null) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, rawStart, rawEnd] = m
  if (rawStart === '' && rawEnd === '') return null

  let start: number
  let end: number
  if (rawStart === '') {
    // `bytes=-N` = 最后 N 字节
    const n = Number(rawEnd)
    if (!Number.isFinite(n) || n <= 0) return null
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || start >= size) return null
  end = Math.min(end, size - 1)
  if (end < start) return null
  return { start, end }
}

/** 必须在 app ready **之前**调用:scheme 的特权只能在那时登记 */
export function registerNotesScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: NOTES_ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        // stream 是 `<video>` 能边下边播的前提
        stream: true,
        // 沙箱 iframe 是不透明 origin:字体 / ES module / fetch 兄弟资源需要 CORS
        corsEnabled: true,
        bypassCSP: false
      }
    }
  ])
}

function headersFor(kind: NoteAssetKind, full: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': noteAssetMime(extname(full).slice(1)),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache'
  }
  const csp = CSP[kind]
  if (csp !== undefined) h['Content-Security-Policy'] = csp
  return h
}

export function fileHeadersFor(full: string): Record<string, string> {
  const ext = extname(full).slice(1).toLowerCase()
  const h: Record<string, string> = {
    'Content-Type': noteFileMime(ext),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    // 扩展名即事实:不许浏览器再嗅探成别的类型
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(full.split('/').pop() ?? '')}`,
    // iframe 无同源(opaque origin):字体、module、fetch 兄弟资源都要 CORS
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin'
  }
  if (isHtmlExt(ext)) h['Content-Security-Policy'] = FILE_PAGE_CSP
  else if (ext === 'svg') h['Content-Security-Policy'] = FILE_SVG_CSP
  return h
}

/** 单文件的 Range / 整份读取与响应组装(asset 与 file 两个 host 共用) */
async function serveFile(
  path: string,
  req: Request,
  headersForPath: (full: string) => Record<string, string>,
  fullReadCap: number
): Promise<Response> {
  try {
    const st = await stat(path)
    if (!st.isFile()) return new Response('not found', { status: 404 })
    const headers = headersForPath(path)

    // 只读请求的那一段,不把整个文件读进内存 —— 视频动辄几百 MB
    const range = parseRange(req.headers.get('range'), st.size)
    if (range !== null) {
      const length = range.end - range.start + 1
      const fh = await open(path, 'r')
      try {
        const buf = Buffer.alloc(length)
        await fh.read(buf, 0, length, range.start)
        return new Response(buf, {
          status: 206,
          headers: { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${st.size}` }
        })
      } finally {
        await fh.close()
      }
    }

    if (st.size > fullReadCap) return new Response('too large', { status: 413 })
    const fh = await open(path, 'r')
    try {
      const buf = Buffer.alloc(st.size)
      await fh.read(buf, 0, st.size, 0)
      return new Response(buf, { status: 200, headers })
    } finally {
      await fh.close()
    }
  } catch {
    return new Response('not found', { status: 404 })
  }
}

/** ready 之后调用。getDir 每次现取 —— 用户改了笔记目录设置要立刻生效 */
export function handleNotesProtocol(getDir: () => string, log?: (msg: string) => void): void {
  protocol.handle(NOTES_ASSET_SCHEME, async (req) => {
    let host = ''
    try {
      host = new URL(req.url).hostname
    } catch {
      return new Response('forbidden', { status: 403 })
    }

    if (host === NOTES_FILE_HOST) {
      const path = resolveFilePath(getDir(), req.url)
      if (path === null) {
        log?.(`拒绝:${req.url}`)
        return new Response('forbidden', { status: 403 })
      }
      return serveFile(path, req, fileHeadersFor, MAX_FILE_BYTES_READ)
    }

    const hit = resolveAssetPath(getDir(), req.url)
    if (hit === null) {
      log?.(`拒绝:${req.url}`)
      return new Response('forbidden', { status: 403 })
    }
    return serveFile(hit.path, req, (full) => headersFor(hit.kind, full), MAX_FULL_READ)
  })
}
