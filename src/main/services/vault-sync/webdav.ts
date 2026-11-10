// WebDAV。逐层 PROPFIND:坚果云这类服务不支持无限深度。
// 有 ETag 时用 If-Match 做条件写。列目录时没有 ETag 的文件,etag 用 mtime+size,
// 这种指纹不能拿去 If-Match,写入前改成再读一次比对。

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
      headers: { ...headers, Depth: '1' }
    })
    if (!res.ok && res.status !== 207) throw new Error(`${res.status} 列出 ${url}`)
    return res.text()
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
      const extra: Record<string, string> = { ...headers, 'Content-Type': 'application/octet-stream' }
      if (expected !== undefined && !expected.startsWith('mtime:')) extra['If-Match'] = expected
      else if (expected !== undefined) await assertUnchanged(path, expected)
      const res = await request(http, `${root}/${encodePath(path)}`, {
        method: 'PUT',
        headers: extra,
        body: new Uint8Array(body)
      })
      if (res.status === 412) throw new ConflictError(path)
      if (!res.ok) throw new Error(`${res.status} 写入 ${path}`)
      return { etag: res.headers.get('etag') ?? expected ?? '' }
    },
    async remove(path, expected) {
      const extra: Record<string, string> = { ...headers }
      if (expected !== undefined && !expected.startsWith('mtime:')) extra['If-Match'] = expected
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
  const blocks = xml.split(/<[^>]*response[^>]*>/i).slice(1)
  for (const block of blocks) {
    const href = decodeURIComponent(textOf(block, 'href')).replace(/\/$/, '')
    const rel = href.startsWith(rootPath) ? href.slice(rootPath.length).replace(/^\//, '') : ''
    const isDir = /<[^>]*collection\s*\/>/i.test(block)
    const etag = textOf(block, 'getetag').replace(/^"|"$/g, '')
    const size = Number(textOf(block, 'getcontentlength')) || 0
    const mtime = textOf(block, 'getlastmodified')
    out.push({ path: rel, isDir, etag, size, mtime })
  }
  return out
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

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}
