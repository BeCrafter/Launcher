// WebDAV (RFC 4918)。逐层 PROPFIND Depth 1:规范不要求服务器支持 infinity。
// 有 ETag 时用 If-Match。ETag 是带引号的不透明值,比较和回写都保留引号。
// 列目录时没有 ETag 的文件,etag 用 mtime+size,这种指纹不能拿去 If-Match,
// 写入前改成再读一次比对。PUT 不创建缺失的父集合,先按层 MKCOL。

import { ConflictError, type RemoteStore } from './store'
import type { RemoteEntry } from './plan'
import { request, type HttpOptions } from './http'

export interface WebDavConfig {
  /** 目录 URL,末尾有没有斜杠都行 */
  url: string
  username: string
  password: string
}

export function createWebDavStore(config: WebDavConfig, http: HttpOptions): RemoteStore {
  const root = config.url.replace(/\/$/, '')
  const auth = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`
  const headers = { Authorization: auth }

  async function propfind(url: string): Promise<string> {
    const res = await request(http, url, {
      method: 'PROPFIND',
      headers: {
        ...headers,
        Depth: '1',
        Accept: 'application/xml, text/xml'
      }
    })
    if (!res.ok && res.status !== 207) throw new Error(`${res.status} 列出 ${url}`)
    return res.text()
  }

  /** RFC 4918: PUT 只对已有父集合创建资源。缺的每一层单独 MKCOL,已存在的跳过 */
  async function ensureParents(path: string): Promise<void> {
    const parts = path.split('/').slice(0, -1).filter((part) => part !== '')
    let dir = ''
    for (const part of parts) {
      dir = dir === '' ? part : `${dir}/${part}`
      const res = await request(http, `${root}/${encodePath(dir)}`, { method: 'MKCOL', headers })
      if (res.ok || res.status === 405 || res.status === 409 || res.status === 301) continue
      throw new Error(`${res.status} 创建目录 ${dir}`)
    }
  }

  return {
    targetId: `webdav|${root}|${config.username}`,
    async list() {
      const out = new Map<string, RemoteEntry>()
      const queue = ['']
      const seen = new Set<string>()
      while (queue.length > 0) {
        const dir = queue.shift()!
        if (seen.has(dir)) continue
        seen.add(dir)
        const xml = await propfind(dir === '' ? `${root}/` : `${root}/${encodePath(dir)}`)
        for (const item of parsePropfind(xml, root)) {
          if (item.path === dir) continue
          if (item.isDir) queue.push(item.path)
          else {
            const etag = item.etag !== '' ? item.etag : `mtime:${item.mtime}:${item.size}`
            out.set(item.path, { path: item.path, etag, size: item.size })
          }
        }
      }
      return out
    },
    async read(path) {
      const res = await request(http, `${root}/${encodePath(path)}`, { headers })
      if (!res.ok) throw new Error(`${res.status} 读取 ${path}`)
      return Buffer.from(await res.arrayBuffer())
    },
    async write(path, body, expected) {
      await ensureParents(path)
      const extra: Record<string, string> = { ...headers, 'Content-Type': 'application/octet-stream' }
      if (expected !== undefined && !expected.startsWith('mtime:')) extra['If-Match'] = quoteEtag(expected)
      else if (expected !== undefined) await assertUnchanged(path, expected)
      const res = await request(http, `${root}/${encodePath(path)}`, {
        method: 'PUT',
        headers: extra,
        body: new Uint8Array(body)
      })
      if (res.status === 412) throw new ConflictError(path)
      if (!res.ok) throw new Error(`${res.status} 写入 ${path}`)
      const returned = normalizeEtag(res.headers.get('etag') ?? '')
      return { etag: returned !== '' ? returned : (expected ?? '') }
    },
    async remove(path, expected) {
      const extra: Record<string, string> = { ...headers }
      if (expected !== undefined && !expected.startsWith('mtime:')) extra['If-Match'] = quoteEtag(expected)
      else if (expected !== undefined) await assertUnchanged(path, expected)
      const res = await request(http, `${root}/${encodePath(path)}`, { method: 'DELETE', headers: extra })
      if (res.status === 412) throw new ConflictError(path)
      if (!res.ok && res.status !== 404) throw new Error(`${res.status} 删除 ${path}`)
    }
  }

  /** 服务不给 ETag 时,写之前再读一次目录项,指纹变了就当冲突 */
  async function assertUnchanged(path: string, expected: string): Promise<void> {
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const xml = await propfind(parent === '' ? `${root}/` : `${root}/${encodePath(parent)}`)
    const item = parsePropfind(xml, root).find((it) => it.path === path && !it.isDir)
    const etag = item === undefined ? '' : item.etag !== '' ? item.etag : `mtime:${item.mtime}:${item.size}`
    if (etag !== expected) throw new ConflictError(path)
  }
}

interface PropItem {
  path: string
  isDir: boolean
  etag: string
  size: number
  mtime: string
}

/** 只取 response 里的 href、collection、getetag、getcontentlength。不引 XML 库 */
export function parsePropfind(xml: string, root: string): PropItem[] {
  const rootPath = new URL(root).pathname.replace(/\/$/, '')
  const out: PropItem[] = []
  // 只按开始标签切开。`</D:response>` 也含 response，切进去会多出一条空路径
  const blocks = xml.split(/<(?!\/)[^>]*\bresponse\b[^>]*>/i).slice(1)
  for (const block of blocks) {
    const href = decodeURIComponent(textOf(block, 'href')).replace(/\/$/, '')
    const rel = href.startsWith(rootPath) ? href.slice(rootPath.length).replace(/^\//, '') : ''
    const isDir = isCollection(block)
    const etag = normalizeEtag(textOf(block, 'getetag'))
    const size = Number(textOf(block, 'getcontentlength')) || 0
    const mtime = textOf(block, 'getlastmodified')
    out.push({ path: rel, isDir, etag, size, mtime })
  }
  return out
}

/**
 * 目录标记可能带命名空间属性，例如 `<D:collection xmlns:D="DAV:"/>`。
 * 只看 resourcetype，避免锁说明里的其他标签碰巧。
 */
function isCollection(block: string): boolean {
  const type = /<[^>]*resourcetype[^>]*>([\s\S]*?)<\/[^>]*resourcetype>/i.exec(block)
  return type !== null && /<[^>]*collection\b/i.test(type[1])
}

function textOf(block: string, tag: string): string {
  const match = new RegExp(`<[^>]*${tag}[^>]*>([^<]*)<`, 'i').exec(block)
  return match ? unescapeXml(match[1].trim()) : ''
}

function unescapeXml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** RFC 9110: ETag 是带引号的不透明值。弱校验器不能拿来做 If-Match */
function normalizeEtag(raw: string): string {
  const value = raw.trim()
  if (value === '' || value.startsWith('W/')) return ''
  return value.replace(/^"|"$/g, '')
}

function quoteEtag(etag: string): string {
  return etag.startsWith('"') ? etag : `"${etag}"`
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}
