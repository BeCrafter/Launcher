// 纯函数层（无副作用，单测直接 import；不随 CLI 一起执行）
//
// 单独成文件的原因：cli.mjs 顶层有入口 switch，测试 import 它会真的跑起来；
// 而「是否主模块」的判定在 npm bin 的符号链接下并不可靠（argv[1] 是链接路径、
// import.meta.url 是真实路径），所以不靠 guard，直接分层。

/**
 * `uname -m` 输出 → 产物架构。**必须与 scripts/install.sh 同源**：
 * install.sh 走 `uname -m`，若这里改用 `process.arch`（Node 二进制自身的架构），
 * 一个用 x64 Node 的 Apple Silicon 用户会被装上 x64 产物 —— 同为一条契约却给出不同结果。
 */
export function archOfUname(unameOut) {
  const m = String(unameOut ?? '').trim()
  if (m === 'arm64') return 'arm64'
  if (m === 'x86_64') return 'x64'
  return null
}

/** 兜底：uname 取不到时用 Node 自身架构（process.arch → 产物架构） */
export function archOf(arch) {
  return arch === 'arm64' || arch === 'x64' ? arch : null
}

/**
 * 拼下载地址。version 为 null/空 → 走 latest 别名（文件名恒定，CI 上传时带 no-store）。
 * 版本号去 `v` 前缀：tag 是 v0.2.0，产物名是 Launcher-0.2.0-<arch>.zip。
 */
export function zipUrl(r2Base, version, arch) {
  const base = String(r2Base).replace(/\/+$/, '')
  const v = version ? String(version).replace(/^v/, '') : ''
  return v ? `${base}/Launcher-${v}-${arch}.zip` : `${base}/Launcher-latest-${arch}.zip`
}

/**
 * 从下载地址反解版本号 —— 「latest 别名当前指向哪个版本」只能这样问出来。
 * R2 的公开域不支持列对象，别名本身也不含版本信息，故由下载方跟随重定向后看最终 URL：
 * `…/Launcher-latest-arm64.zip` → `…/Launcher-0.2.0-arm64.zip` → `0.2.0`。
 * 与 scripts/install.sh 的 r2_latest（curl 的 `%{url_effective}`）是同一条契约的两份实现。
 * 别名原样返回（未重定向）时判不出，回 null。
 */
export function versionFromDownloadUrl(url) {
  const m = /\/Launcher-(.+)-[^/]*\.zip$/.exec(String(url ?? '').split(/[?#]/)[0])
  if (!m) return null
  const v = m[1]
  return v === 'latest' || !/^[0-9]/.test(v) ? null : v
}

/** 拆 X.Y.Z[-后缀]；无法解析返回 null（调用方据此跳过比较，不要瞎猜） */
export function parseVersion(value) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/.exec(String(value ?? '').trim())
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null } : null
}

/**
 * 预发布后缀比较：按 `.` 分段，纯数字段按数值比（`rc.10` > `rc.9`，纯字典序会判反）。
 * 段数不同时短的更小（`rc` < `rc.1`）。
 */
function comparePrerelease(a, b) {
  const pa = String(a).split('.')
  const pb = String(b).split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i]
    const y = pb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/** a<b → -1，a>b → 1，相等 → 0；任一方无法解析 → null。正式版 > 同号预发布。 */
export function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return null
  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1
  }
  if (pa.pre === pb.pre) return 0
  if (pa.pre === null) return 1
  if (pb.pre === null) return -1
  return comparePrerelease(pa.pre, pb.pre)
}

/** 预发布判据：带后缀即算（发版脚本只放行 alpha/beta/pre/rc 四个词，见 release-version.mjs） */
export function isPrerelease(version) {
  const p = parseVersion(version)
  return p ? p.pre !== null : String(version ?? '').includes('-')
}

/** 版本倒序（新的在前）。元素可以是版本字符串，也可以是带 .version 的对象；无法解析的保持原位 */
export function sortVersionsDesc(items) {
  const key = (x) => (typeof x === 'string' ? x : x?.version)
  return [...items].sort((a, b) => {
    const c = compareVersions(key(a), key(b))
    return c === null ? 0 : -c
  })
}

/**
 * 版本列表的唯一来源：**R2 上的纯文本清单**（`<cdn 根>/versions.txt`），由 CI 发版时维护。
 *
 * 为什么不是 GitHub Releases api：清单是「我们发布了哪些产物」的自述，离产物最近 ——
 * 某次 Release 步骤失败但产物已上传时，GitHub 会漏掉它而 R2 不会；内网镜像也只需镜像一个
 * 静态文件，不必让 api.github.com 可达。也因此版本号是这个域里唯一的运行时依赖。
 *
 * 版式（一行一版，两段，空白分隔）：
 *   `0.2.0`            正式版
 *   `0.3.0-rc.1 pre`   预发布
 */
export const VERSIONS_PATH = '/versions.txt'

/**
 * 版本清单文本 → 版本列表。坏行（空行、表头、被截断的半行、混进来的 html）直接跳过：
 * 一份清单宁可少列一个版本，也不能让 `--list` 崩在一个畸形行上，更不该把垃圾当版本展示。
 * 同时列出全部版本并按版本号倒序 —— `--pre` 是否展示由调用方决定。
 */
export function parseVersionsFile(text) {
  const seen = new Set()
  const all = []
  for (const line of String(text ?? '').split('\n')) {
    const [version, flag] = line.trim().split(/\s+/)
    // 版本号一律以数字开头（tag 去掉 v 前缀后即如此）；不满足的行是噪声，不是版本
    if (!version || !/^[0-9]/.test(version) || seen.has(version)) continue
    seen.add(version)
    all.push({ version, prerelease: flag === 'pre' || isPrerelease(version) })
  }
  const sorted = sortVersionsDesc(all)
  return {
    all: sorted,
    stable: sorted.filter((r) => !r.prerelease),
    latestStable: sorted.find((r) => !r.prerelease)?.version ?? null
  }
}

/** tag → 版本号：产物名与安装参数都不带 v 前缀 */
export function parseTagVersion(tag) {
  return String(tag ?? '').trim().replace(/^v/i, '')
}

/**
 * 拉取可用版本列表。base 是 cdn 根地址（与产物同一个域），可注入 —— 单测打本地夹具。
 * 「取不到」与「清单还没建起来（首次发版前）」分态返回，调用方才能给出不同的话。
 */
export async function fetchReleases(base = '', timeoutMs = 10_000, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch
  const url = `${String(base).replace(/\/+$/, '')}${VERSIONS_PATH}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, url }
    const parsed = parseVersionsFile(await res.text())
    return { ok: true, ...parsed, url }
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? '超时' : (err?.message ?? String(err)), url }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * latest 别名当前指向的版本 —— 也就是「不带 --version 装的那个版本」。
 * R2 公开域不支持列对象，别名名里也没有版本号，只能发一次 HEAD 跟随重定向后从最终 URL
 * 反解（见 versionFromDownloadUrl）。取不到时返回 ok:false —— **不能**拿本 CLI 的版本冒充它。
 * version 可注入：测试用它钉住调用方拼出的 URL 形态。
 */
export async function fetchLatestVersion(zipUrlValue, timeoutMs = 6000, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(zipUrlValue, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const version = versionFromDownloadUrl(res.url || zipUrlValue)
    return version ? { ok: true, version } : { ok: false, error: '重定向未暴露版本号' }
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? '超时' : (err?.message ?? String(err)) }
  } finally {
    clearTimeout(timer)
  }
}

/** 从 Info.plist 原文取 CFBundleShortVersionString */
export function plistVersion(xml) {
  const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(String(xml ?? ''))
  return m ? m[1].trim() : null
}

/**
 * 解析 argv。首参若是已知子命令则取出，否则一切参数都作用于默认命令。
 * 无子命令的单 `--version` 视为「打印 CLI 版本」——这是最容易被误敲的形式。
 */
export function parseArgs(argv) {
  const out = { cmd: null, version: null, dir: null, force: false, pre: false, json: false, help: false, wantCliVersion: false }
  const rest = [...argv]

  if (rest.length === 1 && (rest[0] === '--version' || rest[0] === '-v')) {
    out.wantCliVersion = true
    return out
  }
  if (rest[0] && !rest[0].startsWith('-')) {
    const c = rest.shift()
    if (c === 'help') {
      out.help = true
      return out
    }
    if (!['install', 'uninstall', 'status', 'versions'].includes(c)) return { error: `未知命令：${c}` }
    out.cmd = c
  }

  while (rest.length > 0) {
    const a = rest.shift()
    if (a === '-h' || a === '--help') {
      out.help = true
    } else if (a === '-f' || a === '--force') {
      out.force = true
    } else if (a === '--pre') {
      out.pre = true
    } else if (a === '--json') {
      out.json = true
    } else if (a === '--dir') {
      const d = rest.shift()
      if (!d) return { error: '--dir 需要一个目录路径' }
      out.dir = d
    } else if (a === '--version') {
      const v = rest.shift()
      if (!v) return { error: '--version 需要一个版本号（想查看 CLI 版本请直接运行 `becrafter-launcher --version`）' }
      out.version = v
    } else {
      return { error: `未知参数：${a}` }
    }
  }

  // --pre / --json 只对「列版本」有意义；其余命令里静默忽略会让用户以为生效了
  if ((out.pre || out.json) && out.cmd !== 'versions') {
    return { error: `${out.pre ? '--pre' : '--json'} 只用于 versions（列可用版本），不作用于其他命令` }
  }
  return out
}
