// S3 兼容端点。自己签 SigV4,不引 SDK。
// ListObjectsV2 必须翻完所有页,没翻完就报错,不当成远端没有这些文件。
// ETag 当不透明指纹,不假设它等于内容 MD5。

import { createHash, createHmac } from 'node:crypto'
import { ConflictError, IncompleteListError, type RemoteStore } from './store'
import type { RemoteEntry } from './plan'
import { request, type HttpOptions } from './http'

export interface S3Config {
  endpoint: string
  region: string
  bucket: string
  /** 只同步这个前缀下面,空 = 整个桶 */
  prefix: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

export function createS3Store(config: S3Config, http: HttpOptions): RemoteStore {
  const endpoint = config.endpoint.replace(/\/$/, '')
  const region = config.region || 'us-east-1'
  const prefix = config.prefix.replace(/^\/+|\/+$/g, '')
  const keyPrefix = prefix === '' ? '' : `${prefix}/`

  function objectUrl(key: string): string {
    const path = config.forcePathStyle
      ? `/${config.bucket}/${encodePath(key)}`
      : `/${encodePath(key)}`
    const host =
      config.forcePathStyle || endpoint.includes(`://${config.bucket}.`)
        ? endpoint
        : endpoint.replace('://', `://${config.bucket}.`)
    return `${host}${path}`
  }

  function listUrl(query: string): string {
    const path = config.forcePathStyle ? `/${config.bucket}` : '/'
    const host =
      config.forcePathStyle || endpoint.includes(`://${config.bucket}.`)
        ? endpoint
        : endpoint.replace('://', `://${config.bucket}.`)
    return `${host}${path}?${query}`
  }

  function sign(method: string, url: string, headers: Record<string, string>, payloadHash: string): Record<string, string> {
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const date = amzDate.slice(0, 8)
    const u = new URL(url)
    headers['x-amz-date'] = amzDate
    headers['x-amz-content-sha256'] = payloadHash
    headers.host = u.host
    // 签名只覆盖真正参与请求的头。传输层自己加的 User-Agent、Accept 不在这里，
    // 否则按小写名取值会取到空，签名和发出去的请求对不上。
    const lower = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value.trim()]))
    const signed = [...lower.keys()].sort()
    const canonical = [
      method,
      u.pathname,
      [...u.searchParams.entries()].sort().map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'),
      signed.map((k) => `${k}:${lower.get(k)}\n`).join(''),
      signed.join(';'),
      payloadHash
    ].join('\n')
    const scope = `${date}/${region}/s3/aws4_request`
    const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, date), region), 's3'), 'aws4_request')
    const signature = createHmac('sha256', signingKey).update(toSign).digest('hex')
    headers.Authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`
    return headers
  }

  async function call(method: string, url: string, body?: Buffer, extra: Record<string, string> = {}): Promise<Response> {
    const payloadHash = sha256(body ?? Buffer.alloc(0))
    const headers = sign(method, url, { ...extra }, payloadHash)
    return request(http, url, { method, headers, body: body ? new Uint8Array(body) : undefined })
  }

  return {
    targetId: `s3|${endpoint}|${config.bucket}|${prefix}`,
    async list() {
      const out = new Map<string, RemoteEntry>()
      let token = ''
      let pages = 0
      for (;;) {
        const query = `list-type=2&prefix=${encodeURIComponent(keyPrefix)}${token ? `&continuation-token=${encodeURIComponent(token)}` : ''}`
        const res = await call('GET', listUrl(query))
        if (!res.ok) throw new Error(`${res.status} 列出对象`)
        const xml = await res.text()
        if (xml.includes('<IsTruncated>true</IsTruncated>') && !xml.includes('<NextContinuationToken>')) {
          throw new IncompleteListError('S3 列表被截断但没有下一页标记')
        }
        for (const block of xml.split('<Contents>').slice(1)) {
          const key = textOf(block, 'Key')
          if (!key.startsWith(keyPrefix) || key.endsWith('/')) continue
          const path = key.slice(keyPrefix.length)
          const etag = textOf(block, 'ETag').replace(/^"|"$/g, '')
          const size = Number(textOf(block, 'Size')) || 0
          out.set(path, { path, etag, size })
        }
        const next = textOf(xml, 'NextContinuationToken')
        if (next === '') break
        token = next
        pages += 1
        if (pages > 1000) throw new IncompleteListError('S3 列表分页没有结束')
      }
      return out
    },
    async read(path) {
      const res = await call('GET', objectUrl(`${keyPrefix}${path}`))
      if (!res.ok) throw new Error(`${res.status} 读取 ${path}`)
      return Buffer.from(await res.arrayBuffer())
    },
    async write(path, body, expected) {
      const extra: Record<string, string> = {}
      // S3 的 ETag 是带引号的不透明值。If-Match 要原样带上引号,否则对不上
      if (expected) extra['If-Match'] = quoteEtag(expected)
      const res = await call('PUT', objectUrl(`${keyPrefix}${path}`), body, extra)
      if (res.status === 412) throw new ConflictError(path)
      if (!res.ok) throw new Error(`${res.status} 写入 ${path}`)
      return { etag: (res.headers.get('etag') ?? '').replace(/^"|"$/g, '') }
    },
    async remove(path, expected) {
      const extra: Record<string, string> = {}
      if (expected) extra['If-Match'] = quoteEtag(expected)
      const res = await call('DELETE', objectUrl(`${keyPrefix}${path}`), undefined, extra)
      if (res.status === 412) throw new ConflictError(path)
      if (!res.ok && res.status !== 404) throw new Error(`${res.status} 删除 ${path}`)
    }
  }
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

function textOf(block: string, tag: string): string {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(block)
  if (!match) return ''
  return match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function quoteEtag(etag: string): string {
  return etag.startsWith('"') ? etag : `"${etag}"`
}
