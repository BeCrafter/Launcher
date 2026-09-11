// 更新检查:GitHub Releases API(main 侧请求,免 renderer CORS 与文档 CSP 顾虑)
// 四态:upToDate / available / noRelease(仓库未发布,404 与故障分态)/ error(网络/超时/异常)

import type { LatestRelease, UpdateCheckResult } from '../../shared/ipc'

export const UPDATE_CHECK_URL = 'https://api.github.com/repos/BeCrafter/Launcher/releases/latest'
export const UPDATE_CHECK_TIMEOUT_MS = 8000

export function parseTagVersion(tag: string): string {
  return tag.trim().replace(/^v/i, '')
}

// 主.次.修订数字段比较;预发布(含 -)小于同版本正式版;缺段补 0;非数字段回退 0
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string): { nums: number[]; pre: string | null } => {
    const clean = v.trim().replace(/^v/i, '')
    const [core, ...preParts] = clean.split('-')
    const nums = core.split('.').map((s) => {
      const n = Number.parseInt(s, 10)
      return Number.isFinite(n) ? n : 0
    })
    while (nums.length < 3) nums.push(0)
    return { nums, pre: preParts.length > 0 ? preParts.join('-') : null }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i] ? 1 : -1
  }
  if (x.pre === y.pre) return 0
  if (x.pre === null) return 1
  if (y.pre === null) return -1
  return x.pre > y.pre ? 1 : -1
}

export interface UpdateCheckDeps {
  url?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export async function fetchLatestRelease(
  deps?: UpdateCheckDeps
): Promise<{ ok: true; release: LatestRelease | null } | { ok: false; error: string }> {
  const url = deps?.url ?? UPDATE_CHECK_URL
  const fetchImpl = deps?.fetchImpl ?? fetch
  const timeoutMs = deps?.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        // GitHub API 硬性要求 User-Agent
        'User-Agent': 'BeCrafter-Launcher',
        Accept: 'application/vnd.github+json'
      }
    })
    if (res.status === 404) return { ok: true, release: null } // 仓库存在但未发布任何 Release
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const data = (await res.json()) as { tag_name?: unknown; html_url?: unknown; name?: unknown }
    if (typeof data.tag_name !== 'string' || typeof data.html_url !== 'string') {
      return { ok: false, error: 'unexpected response shape' }
    }
    return {
      ok: true,
      release: {
        tagName: data.tag_name,
        version: parseTagVersion(data.tag_name),
        htmlUrl: data.html_url,
        name: typeof data.name === 'string' ? data.name : null
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

export async function checkForUpdate(
  currentVersion: string,
  deps?: UpdateCheckDeps
): Promise<UpdateCheckResult> {
  const r = await fetchLatestRelease(deps)
  if (!r.ok) {
    return { status: 'error', currentVersion, latest: null, errorMessage: r.error }
  }
  if (!r.release) {
    return { status: 'noRelease', currentVersion, latest: null, errorMessage: null }
  }
  return {
    status: compareVersions(currentVersion, r.release.version) < 0 ? 'available' : 'upToDate',
    currentVersion,
    latest: r.release,
    errorMessage: null
  }
}
