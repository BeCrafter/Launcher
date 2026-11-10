// 同步用的 HTTP。fetch 由调用方注入:应用传 Electron 的 net.fetch,测试传假的。
// 429 / 403 按 Retry-After 或短暂退避重试一次,仍失败就抛错,整轮停止。

export interface HttpOptions {
  fetch: typeof fetch
  /** 每个请求都带上,部分托管要求 */
  userAgent?: string
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

const DEFAULT_UA = 'becrafter-launcher'

export async function request(
  opts: HttpOptions,
  url: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
  attempt = 0
): Promise<Response> {
  const extra = init.headers
  const headers: Record<string, string> = {
    'User-Agent': opts.userAgent ?? DEFAULT_UA,
    Accept: 'application/json',
    ...(extra !== undefined && !Array.isArray(extra) ? extra : {})
  }
  const res = await opts.fetch(url, { ...init, headers })
  if ((res.status === 429 || res.status === 403) && attempt === 0) {
    const wait = retryAfterMs(res)
    if (wait > 0 && wait <= 10_000) {
      await new Promise((r) => setTimeout(r, wait))
      return request(opts, url, init, attempt + 1)
    }
  }
  return res
}

export async function requestJson<T>(
  opts: HttpOptions,
  url: string,
  init: RequestInit & { headers?: Record<string, string> } = {}
): Promise<T> {
  const res = await request(opts, url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new HttpError(res.status, `${res.status} ${url}: ${text.slice(0, 300)}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

function retryAfterMs(res: Response): number {
  const raw = res.headers.get('retry-after')
  if (raw === null) return 1000
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const when = Date.parse(raw)
  if (Number.isNaN(when)) return 1000
  return Math.max(0, when - Date.now())
}
