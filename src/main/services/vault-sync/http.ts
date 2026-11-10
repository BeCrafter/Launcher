// 同步用的 HTTP。fetch 由调用方注入:应用传 Electron 的 net.fetch,测试传假的。
// 429 按 Retry-After 重试一次。403 只在 GitHub 主机上重试:S3 用 403 表示签名或权限被拒绝。
// 仍失败就抛错,整轮停止。

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
  // 403 只有 GitHub 的次级限流才重试。S3 用 403 表示签名或权限被拒绝，重试没有意义。
  // 条件写失败是 412，也不进这里。
  const retryable = res.status === 429 || (res.status === 403 && isGitHubHost(hostOf(url)))
  if (retryable && attempt === 0) {
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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function isGitHubHost(host: string): boolean {
  const name = host.toLowerCase()
  return name === 'github.com' || name.endsWith('.github.com')
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
