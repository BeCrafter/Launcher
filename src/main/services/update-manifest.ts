// 应用内更新的版本清单:每个版本一份**不可变**的 `Launcher-<版本>.json`。
//
// 为什么不用一个可变的 latest.json:版本清单(versions.txt)与产物都是按版本号不可变的,
// 只有「当前最新」会变。把「有哪些版本」与「某个版本由哪些文件组成」拆开后,
// 任何一份清单一旦上传就永远指向同一批字节 —— 重跑发版、cdn 缓存、回滚都不会出现
// 「昨天下的清单今天指向另一个 zip」。最新版由 versions.txt 决定(见 update-check.ts)。
//
// 清单结构:
//   {
//     "version": "0.3.0",
//     "minSystemVersion": "12.0",
//     "files": {
//       "arm64": { "path": "Launcher-0.3.0-arm64.zip", "sha256": "<64 hex>", "size": 123456 },
//       "x64":   { ... }
//     }
//   }
//
// 安全约束:path 必须是**纯文件名**(不允许 `/`、`..`),下载 URL 由 cdn 根 + path 拼出。
// 清单本身走 HTTPS;sha256 在下载后逐个校验。清单签名(Ed25519)留给下一阶段 ——
// 当前信任根与三条安装通道相同(https://repo.iskill.site)。

import { CDN_BASE } from './update-check'

export type UpdateArch = 'arm64' | 'x64'

export const UPDATE_ARCHES: readonly UpdateArch[] = ['arm64', 'x64']

/** 清单很小;超过这个大小一定是拿错了东西(比如 404 页面) */
export const MANIFEST_MAX_BYTES = 64 * 1024

/** 单包上限(防御清单被篡改成天文数字导致磁盘被写满) */
export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024

export interface UpdateManifestFile {
  /** 相对 cdn 根的文件名,如 Launcher-0.3.0-arm64.zip */
  path: string
  /** 小写 hex */
  sha256: string
  size: number
}

export interface UpdateManifest {
  version: string
  /** 产物要求的最低 macOS 版本;缺省时以包内 Info.plist 为准 */
  minSystemVersion: string | null
  files: Record<UpdateArch, UpdateManifestFile>
}

export function cdnBase(env: NodeJS.ProcessEnv = process.env): string {
  return (env['LAUNCHER_R2_BASE'] || CDN_BASE).replace(/\/+$/, '')
}

export function manifestUrl(version: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${cdnBase(env)}/Launcher-${encodeURIComponent(version)}.json`
}

export function artifactUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${cdnBase(env)}/${path}`
}

/** 纯文件名 + .zip 后缀:挡住 `../`、绝对路径、查询串等清单注入 */
export function isSafeArtifactPath(path: unknown): path is string {
  return typeof path === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/.test(path) && !path.includes('..')
}

export type ParseManifestResult =
  | { ok: true; manifest: UpdateManifest }
  | { ok: false; error: string }

/**
 * 解析并校验清单。expectedVersion 来自 versions.txt(权威的「最新稳定版」),
 * 清单里的版本必须与它完全一致 —— 否则宁可不升级,也不能把别的版本装进来。
 */
export function parseUpdateManifest(text: string, expectedVersion: string): ParseManifestResult {
  let raw: unknown
  try {
    raw = JSON.parse(String(text ?? ''))
  } catch {
    return { ok: false, error: '清单不是合法 JSON' }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '清单结构不正确' }
  }
  const obj = raw as Record<string, unknown>
  if (obj['version'] !== expectedVersion) {
    return { ok: false, error: `清单版本 ${String(obj['version'])} 与目标 ${expectedVersion} 不一致` }
  }

  const rawFiles = obj['files']
  if (rawFiles === null || typeof rawFiles !== 'object' || Array.isArray(rawFiles)) {
    return { ok: false, error: '清单缺少 files' }
  }
  const filesObj = rawFiles as Record<string, unknown>
  const files: Partial<Record<UpdateArch, UpdateManifestFile>> = {}
  for (const arch of UPDATE_ARCHES) {
    const entry = filesObj[arch]
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: `清单缺少 ${arch} 产物` }
    }
    const f = entry as Record<string, unknown>
    if (!isSafeArtifactPath(f['path'])) {
      return { ok: false, error: `${arch} 产物路径不合法` }
    }
    if (typeof f['sha256'] !== 'string' || !/^[0-9a-fA-F]{64}$/.test(f['sha256'])) {
      return { ok: false, error: `${arch} 产物的 sha256 不合法` }
    }
    if (
      typeof f['size'] !== 'number' ||
      !Number.isSafeInteger(f['size']) ||
      f['size'] <= 0 ||
      f['size'] > MAX_ARTIFACT_BYTES
    ) {
      return { ok: false, error: `${arch} 产物的 size 不合法` }
    }
    files[arch] = { path: f['path'], sha256: f['sha256'].toLowerCase(), size: f['size'] }
  }

  const min = obj['minSystemVersion']
  return {
    ok: true,
    manifest: {
      version: expectedVersion,
      minSystemVersion: typeof min === 'string' && min.trim() !== '' ? min.trim() : null,
      files: files as Record<UpdateArch, UpdateManifestFile>
    }
  }
}

/** 读清单(带超时与大小上限)。网络错误与「清单不存在」都归为 manifest 错误 */
export async function fetchUpdateManifest(
  version: string,
  deps: {
    fetchImpl?: typeof fetch
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
    url?: string
  } = {}
): Promise<ParseManifestResult> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const url = deps.url ?? manifestUrl(version, deps.env ?? process.env)
  const timeoutMs = deps.timeoutMs ?? 15_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { signal: controller.signal })
    if (res.status === 404) return { ok: false, error: `版本清单不存在(${version})` }
    if (!res.ok) return { ok: false, error: `清单请求失败:HTTP ${res.status}` }
    const len = Number(res.headers.get('content-length'))
    if (Number.isFinite(len) && len > MANIFEST_MAX_BYTES) {
      return { ok: false, error: '清单文件异常偏大' }
    }
    const text = await res.text()
    if (text.length > MANIFEST_MAX_BYTES) return { ok: false, error: '清单文件异常偏大' }
    return parseUpdateManifest(text, version)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: controller.signal.aborted ? '清单请求超时' : msg }
  } finally {
    clearTimeout(timer)
  }
}
