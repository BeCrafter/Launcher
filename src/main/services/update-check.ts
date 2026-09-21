// 更新检查:读 **官方 cdn 上的版本清单**(`<cdn 根>/versions.txt`),与三条安装通道同源。
//
// 为什么不再打 GitHub Releases api(2026-09-21 改):
//   · 两处会分叉 —— 产物上传成功但 Release 步骤失败时,GitHub 会漏掉那个版本,于是一条
//     通道能装到的版本,应用却说「已是最新」
//   · 内网镜像 / 限流 / 不可达时,应用内检查直接报错,而 cdn 侧完好
//   · api 的 /latest 天然忽略 pre-release,rc 用户不会被提示「正式版已经发了」
//
// 清单版式与解析口径见 packaging/npm/lib.mjs 的 parseVersionsFile(那边是给 CLI 用的同一份清单)。
// 本文件保留自己的轻量解析:主进程不需要 CLI 那套「预发布数值段比较」之外的任何能力。

import { UPGRADE_COMMAND, type InstallChannel, type UpdateCheckResult } from '../../shared/ipc'

/** cdn 根地址 + 清单文件名(与 scripts/install.sh 的 R2_BASE、cli.mjs 的 DEFAULT_R2_BASE 同值) */
export const CDN_BASE = 'https://repo.iskill.site/launcher'
export const UPDATE_CHECK_TIMEOUT_MS = 8000

/** 生效的清单地址;`LAUNCHER_R2_BASE` 与三条通道同名同义(镜像/自建 cdn),也用于本地端到端验证 */
export function versionsUrl(env: NodeJS.ProcessEnv = process.env): string {
  const base = (env['LAUNCHER_R2_BASE'] || CDN_BASE).replace(/\/+$/, '')
  return `${base}/versions.txt`
}

/** 版本倒序比较;预发布按数值段比(rc.10 > rc.9 —— 纯字典序会判反) */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string): { nums: number[]; pre: string[] | null } => {
    const clean = String(v).trim().replace(/^v/i, '')
    const [core, ...preParts] = clean.split('-')
    const nums = core.split('.').map((s) => {
      const n = Number.parseInt(s, 10)
      return Number.isFinite(n) ? n : 0
    })
    while (nums.length < 3) nums.push(0)
    return { nums, pre: preParts.length > 0 ? preParts.join('-').split('.') : null }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i] ? 1 : -1
  }
  if (x.pre === null && y.pre === null) return 0
  if (x.pre === null) return 1 // 正式版 > 同号预发布
  if (y.pre === null) return -1
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const pa = x.pre[i]
    const pb = y.pre[i]
    if (pa === undefined) return -1 // 段数少的更小(rc < rc.1)
    if (pb === undefined) return 1
    const na = /^\d+$/.test(pa)
    const nb = /^\d+$/.test(pb)
    if (na && nb) {
      if (Number(pa) !== Number(pb)) return Number(pa) < Number(pb) ? -1 : 1
    } else if (pa !== pb) {
      return pa < pb ? -1 : 1
    }
  }
  return 0
}

/**
 * 清单文本 → 版本列表。坏行(空行、混进来的 404 页面)直接跳过:宁可少列一个版本,
 * 也不能让检查更新崩在畸形行上。与 `packaging/npm/lib.mjs` 的解析口径一致。
 */
export function parseManifest(text: string): { all: string[]; stable: string[]; latestStable: string | null } {
  const all: string[] = []
  const stable: string[] = []
  const seen = new Set<string>()
  for (const line of String(text ?? '').split('\n')) {
    const [version, flag] = line.trim().split(/\s+/)
    if (!version || !/^[0-9]/.test(version) || seen.has(version)) continue
    seen.add(version)
    all.push(version)
    // 清单显式标了 pre,或版本号自带后缀(例如手工维护时漏标),都算预发布
    if (flag !== 'pre' && !version.includes('-')) stable.push(version)
  }
  const desc = (xs: string[]): string[] =>
    [...xs].sort((a, b) => {
      const c = compareVersions(a, b)
      return c === 0 ? 0 : c > 0 ? -1 : 1
    })
  const stableDesc = desc(stable)
  return { all: desc(all), stable: stableDesc, latestStable: stableDesc[0] ?? null }
}

export interface UpdateCheckDeps {
  url?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  channel?: InstallChannel
}

/** 拉清单。「取不到」与「清单在但没有版本」分态:前者是错误,后者是尚未发版 */
async function fetchManifest(
  deps?: UpdateCheckDeps
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const url = deps?.url ?? versionsUrl()
  const fetchImpl = deps?.fetchImpl ?? fetch
  const timeoutMs = deps?.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { signal: controller.signal })
    if (res.status === 404) return { ok: false, error: '清单不存在(尚未发版?)' }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true, text: await res.text() }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: controller.signal.aborted ? '请求超时' : msg }
  } finally {
    clearTimeout(timer)
  }
}

export async function checkForUpdate(currentVersion: string, deps?: UpdateCheckDeps): Promise<UpdateCheckResult> {
  const installChannel: InstallChannel = deps?.channel ?? 'manual'
  const upgradeCommand = UPGRADE_COMMAND[installChannel]
  const r = await fetchManifest(deps)
  if (!r.ok) {
    return { status: 'error', currentVersion, latest: null, installChannel, upgradeCommand, errorMessage: r.error }
  }

  const { all, latestStable } = parseManifest(r.text)
  if (all.length === 0) {
    return { status: 'noRelease', currentVersion, latest: null, installChannel, upgradeCommand, errorMessage: null }
  }

  // 「有没有新版」看清单里的**最新稳定版**,而不是 latest 别名:两者在正常发版时相同,
  // 但别名是「重装一次会拿到哪个」,而这里回答的是「最新的是什么」。副作用正合需要 ——
  // 装了 rc 的用户也会被提示「正式版 0.3.0 已经发了」。
  const latest = { version: latestStable ?? all[0], stable: latestStable }
  const cmp = compareVersions(currentVersion, latest.version)
  return {
    status: cmp < 0 ? 'available' : 'upToDate',
    currentVersion,
    latest,
    installChannel,
    upgradeCommand,
    errorMessage: null
  }
}
