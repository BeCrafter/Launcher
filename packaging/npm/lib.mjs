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
  const out = { cmd: null, version: null, dir: null, force: false, help: false, wantCliVersion: false }
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
    if (!['install', 'uninstall', 'status'].includes(c)) return { error: `未知命令：${c}` }
    out.cmd = c
  }

  while (rest.length > 0) {
    const a = rest.shift()
    if (a === '-h' || a === '--help') {
      out.help = true
    } else if (a === '-f' || a === '--force') {
      out.force = true
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
  return out
}
