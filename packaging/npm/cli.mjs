#!/usr/bin/env node
// @becrafter/launcher —— 安装器 CLI
//
//   npx -y @becrafter/launcher              默认:未装则装,已装则报告状态
//   npx -y @becrafter/launcher status       版本检查
//   npx -y @becrafter/launcher install [--version <v|latest>] [--dir <目录>] [--force]
//   npx -y @becrafter/launcher uninstall
//
// ⚠ 安装契约：本文件与 scripts/install.sh 是同一套逻辑的两份实现（bash 与 Node 无法共用代码）。
//   以下不变式**必须逐条一致**，改任一侧都要同步另一侧：
//     · R2 路径模板 `${LAUNCHER_R2_BASE:-https://repo.iskill.site/launcher}`
//     · 命名 `Launcher-[latest|<版本>]-<架构>.zip`（版本号去 v 前缀）
//     · 架构判据 `uname -m`（与 install.sh 同源；不能用 process.arch，见 install()）
//     · 一律用 `ditto -x -k` 解压 —— unzip 与任何 JS zip 库都会丢符号链接/扩展属性，
//       破坏 .app 内部签名
//     · 安装目录 `/Applications`，不可写时回退 `~/Applications`
//     · 装完 `xattr -dr com.apple.quarantine`（防御性；Node 下载本就不带该标记）
//   契约原文见 docs/design/distribution.md「安装契约」小节。
//
// ⚠ 设计约束（勿改成 postinstall）：
//   npm v7+ **没有** uninstall 钩子（官方文档明载 v6 的 uninstall 脚本「will not function」），
//   `npm uninstall` 不会清理 /Applications；且 `ignore-scripts=true` 会让 lifecycle script
//   静默失效（退出码 0、无报错，企业环境常见）。
//   故本包**不在任何 lifecycle script 里干活**，一切由用户显式运行本 CLI 完成。

import { spawn } from 'node:child_process'
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { archOf, archOfUname, compareVersions, parseArgs, plistVersion, zipUrl } from './lib.mjs'

// Node 18/20 首次访问全局 fetch 会往 stderr 打 "ExperimentalWarning: The Fetch API is an
// experimental feature"（Node 21 起 fetch 转正）。只过滤这一条，其余告警照常放行。
const emitWarning = process.emitWarning.bind(process)
process.emitWarning = (warning, ...rest) => {
  const text = typeof warning === 'string' ? warning : (warning?.message ?? '')
  if (/Fetch API is an experimental feature/i.test(text)) return
  emitWarning(warning, ...rest)
}

const PKG = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const PKG_NAME = PKG.name
const PKG_VERSION = PKG.version

const APP_NAME = 'Launcher.app'
const APP_BIN = 'Contents/MacOS/Launcher'
const DEFAULT_R2_BASE = 'https://repo.iskill.site/launcher'
const DEFAULT_INSTALL_DIR = '/Applications'
/** 下载停滞看门狗：123MB 的长下载不该设整体超时，但长时间零字节必须报错 */
const STALL_MS = 60_000

/** fail() 抛这个信号中止流程；顶层捕获后只设 exitCode，不用 process.exit */
class ExitSignal extends Error {}

const out = (s = '') => process.stdout.write(s + '\n')

/**
 * 报错并中止。
 * ⚠ 不直接 process.exit()：Node 的 stdout 在管道下是异步写，立即退出会截断尚未刷出的输出
 * （`--help | head` 这类用法最容易踩）。改为抛信号，让事件循环自然排空后再以 exitCode 收场。
 */
function fail(msg, code = 1) {
  process.stderr.write(`\n错误：${msg}\n`)
  throw new ExitSignal(String(code))
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`

function run(cmd, args) {
  return new Promise((resolve) => {
    let p
    try {
      p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err) })
      return
    }
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (d) => (stdout += d))
    p.stderr.on('data', (d) => (stderr += d))
    p.on('error', (err) => resolve({ code: -1, stdout, stderr: err.message }))
    p.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function download(url, dest) {
  const ctrl = new AbortController()
  let watchdog = setTimeout(() => ctrl.abort(), STALL_MS)
  const arm = () => {
    clearTimeout(watchdog)
    watchdog = setTimeout(() => ctrl.abort(), STALL_MS)
  }
  const stalled = () => fail(`下载停滞超过 ${STALL_MS / 1000} 秒，已中止。请检查网络后重试。`)

  try {
    let res
    try {
      res = await fetch(url, { signal: ctrl.signal })
    } catch (err) {
      if (ctrl.signal.aborted) stalled()
      fail(`下载失败：${url}\n  ${err?.message ?? err}`)
    }
    if (!res.ok) {
      fail(
        `下载失败：HTTP ${res.status} —— ${url}\n` +
          (res.status === 404 ? '  该版本可能不存在；可用 --version latest 取最新版。\n' : '') +
          '  也可用 LAUNCHER_R2_BASE 指向镜像。'
      )
    }

    const total = Number(res.headers.get('content-length') ?? 0)
    let got = 0
    let lastPaint = 0
    const tty = Boolean(process.stdout.isTTY)

    const body = Readable.fromWeb(res.body)
    body.on('data', (chunk) => {
      arm()
      got += chunk.length
      if (!tty) return
      const now = Date.now()
      if (now - lastPaint < 120 && got !== total) return
      lastPaint = now
      const pct = total ? Math.floor((got / total) * 100) : 0
      process.stdout.write(`\r  下载中… ${String(pct).padStart(3)}%  ${mb(got)}${total ? ` / ${mb(total)}` : ''}   `)
    })
    await pipeline(body, createWriteStream(dest))
    if (tty) process.stdout.write(`\r${' '.repeat(64)}\r`)

    // content-length 对不上 = 传输被截断；继续解压只会得到一个坏 .app
    if (total > 0 && got !== total) {
      fail(`下载不完整：收到 ${got} 字节，应为 ${total} 字节。请重试。`)
    }
  } catch (err) {
    if (ctrl.signal.aborted) stalled()
    throw err
  } finally {
    clearTimeout(watchdog)
  }
}

function writable(dir) {
  try {
    mkdirSync(dir, { recursive: true })
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** 生效安装目录：默认目录不可写才回退 ~/Applications；显式 --dir 不可写直接报错（不静默改道） */
function resolveInstallDir(preferred) {
  const explicitDir = preferred || process.env.LAUNCHER_INSTALL_DIR || null
  const dir = explicitDir || DEFAULT_INSTALL_DIR
  if (writable(dir)) return dir
  if (explicitDir) fail(`无法写入指定的安装目录 ${dir}（权限不足？）`)
  const fallback = join(homedir(), 'Applications')
  if (writable(fallback)) {
    out(`提示：${dir} 不可写，改装到 ${fallback}`)
    return fallback
  }
  fail(`无法写入 ${dir}，回退目录 ${fallback} 也不可写`)
}

/**
 * 找到已安装的 .app；找不到返回 null。
 * ⚠ 显式给了 --dir / LAUNCHER_INSTALL_DIR 时**只查那一个**：否则 `uninstall --dir /foo`
 * 会把 ~/Applications 里的另一份删掉。
 */
function findInstalled(preferred) {
  const explicit = preferred || process.env.LAUNCHER_INSTALL_DIR || null
  const candidates = explicit ? [explicit] : [DEFAULT_INSTALL_DIR, join(homedir(), 'Applications')]
  for (const dir of candidates) {
    const p = join(dir, APP_NAME)
    if (existsSync(p)) return p
  }
  return null
}

/** 已装版本。Info.plist 由 electron-builder 产出，是 XML（非二进制），正则足够 */
function installedVersion(appPath) {
  try {
    return plistVersion(readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 退出**正占用目标路径**的那个实例。
 * `osascript quit app "Launcher"` 是按名字退的，会把任意路径下的实例都退掉 ——
 * 装到 `--dir /tmp/x` 时不该打扰用户在 /Applications 里跑着的那份。
 * 判断不出就退（宁可多退一次，也不要让 rm/ditto 撞上被占用的文件）。
 */
async function quitRunningIf(appPath) {
  const found = await run('/usr/bin/pgrep', ['-f', `${APP_NAME}/Contents/MacOS/Launcher`])
  const pids = found.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
  if (pids.length === 0) return

  const ps = await run('/bin/ps', ['-o', 'command=', '-p', pids.join(',')])
  const hits = ps.stdout.trim()
  // pgrep/ps 任一失败（hits 为空）时按「可能占用」处理，照退
  if (hits !== '' && !hits.split('\n').some((line) => line.startsWith(`${appPath}/`))) return

  await run('/usr/bin/osascript', ['-e', 'quit app "Launcher"'])
  await new Promise((r) => setTimeout(r, 1000))
}

// ─────────────────────────────── 动作 ───────────────────────────────

async function install({ version, dir, force }) {
  if (process.platform !== 'darwin') fail('本应用仅支持 macOS')

  // 架构判据必须与 install.sh 同源（都走 uname -m）。不能用 process.arch —— 那是 **Node 二进制**
  // 自身的架构：x64 Node 跑在 Apple Silicon 上时会错装 x64 产物，与 curl 通道给出不同结果。
  const uname = await run('/usr/bin/uname', ['-m'])
  const arch = archOfUname(uname.stdout) ?? archOf(process.arch)
  if (!arch) fail(`不支持的架构 ${uname.stdout.trim() || process.arch}：本应用仅提供 arm64 / x64`)

  // 用户没指定版本时，「要装的版本」= 本包的版本。模板未替换说明是直接跑了仓库源码。
  if (version === null && PKG_VERSION.includes('REPLACE_WITH')) {
    fail('本包的版本号未被替换（像是直接运行了仓库里的模板）。请用 --version <版本> 指定要安装的版本。')
  }

  const r2Base = process.env.LAUNCHER_R2_BASE || DEFAULT_R2_BASE
  const wantLatest = version === 'latest'
  const explicit = version !== null && !wantLatest
  const url = zipUrl(r2Base, explicit ? String(version).replace(/^v/, '') : null, arch)

  const target = resolveInstallDir(dir)
  const appPath = join(target, APP_NAME)
  const before = installedVersion(appPath)

  // 同版本短路**只在用户未指定版本时**成立：本 CLI 的版本不代表 R2 上 latest 指向的版本，
  // 用户显式要 latest 时不能拿它当「已是最新」的依据。
  if (!force && version === null && before === PKG_VERSION) {
    out(`已安装 ${PKG_VERSION}（${appPath}）—— 已是最新。加 --force 可强制重装。`)
    return
  }

  out(`下载 ${url.split('/').pop()} …`)
  const tmp = mkdtempSync(join(tmpdir(), 'becrafter-launcher-'))
  try {
    const zip = join(tmp, 'app.zip')
    await download(url, zip)

    // 必须 ditto：unzip 丢符号链接与扩展属性，会破坏 .app 内部签名
    out('解压…')
    const extractDir = join(tmp, 'out')
    mkdirSync(extractDir, { recursive: true })
    const un = await run('/usr/bin/ditto', ['-x', '-k', zip, extractDir])
    if (un.code !== 0) fail(`解压失败：${un.stderr.trim() || `ditto 退出码 ${un.code}`}`)

    const extracted = join(extractDir, APP_NAME)
    if (!existsSync(extracted)) fail(`压缩包内未找到 ${APP_NAME}（产物结构变了？）`)

    await quitRunningIf(appPath)
    rmSync(appPath, { recursive: true, force: true })
    // force:true 不抛错，所以必须回查：旧实例没退干净时 ditto 会写进一个半残目录
    if (existsSync(appPath)) {
      fail(`无法移除旧版本 ${appPath} —— 应用可能仍在运行或文件被占用。请手动退出 Launcher 后重试。`)
    }

    const cp = await run('/usr/bin/ditto', [extracted, appPath])
    if (cp.code !== 0) fail(`写入 ${appPath} 失败：${cp.stderr.trim() || `ditto 退出码 ${cp.code}`}`)

    // Node 下载本就不打隔离标记；此处仅作防御（例如该 zip 曾被浏览器下载过）
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', appPath])

    // 落盘完整性：签名被破坏的 .app 往往连主可执行文件都不在
    if (!existsSync(join(appPath, APP_BIN))) {
      fail(`安装结果不完整：缺少 ${APP_BIN}。请重试；若持续失败请改用 curl 通道。`)
    }

    const after = installedVersion(appPath)
    out()
    out(`✅ 已安装到 ${appPath}`)
    out(`   版本：${after ?? '未知'}${before && before !== after ? `（原 ${before}）` : ''}`)
    out(`   打开：open "${appPath}"`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function uninstall({ dir }) {
  const appPath = findInstalled(dir)
  if (!appPath) {
    out('未发现已安装的 Launcher（已检查 /Applications 与 ~/Applications）。')
    out('若当初用 --dir 装到了别处，请用同样的 --dir 指定。')
    return
  }
  await quitRunningIf(appPath)
  rmSync(appPath, { recursive: true, force: true })
  if (existsSync(appPath)) {
    fail(`删除失败：${appPath} —— 应用可能仍在运行或文件被占用。请手动退出 Launcher 后重试。`)
  }
  out(`✅ 已卸载（${appPath}）`)
  out()
  out(`提示：若曾用 \`npm i -g\` 装过本 CLI，还需另行 \`npm uninstall -g ${PKG_NAME}\`；`)
  out('      用 `npx` 的话无需任何清理（它只缓存到 ~/.npm/_npx）。')
}

async function publishedInfo() {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(PKG_NAME)}/latest`, {
      signal: AbortSignal.timeout(6000)
    })
    // 404 与「网络不可达」不是一回事：前者说明包还没发布过，后者才是离线
    if (res.status === 404) return { state: 'unpublished' }
    if (!res.ok) return { state: 'error', detail: `HTTP ${res.status}` }
    const j = await res.json()
    return typeof j.version === 'string'
      ? { state: 'ok', version: j.version }
      : { state: 'error', detail: '响应缺少 version' }
  } catch {
    return { state: 'error', detail: '网络不可达' }
  }
}

async function status({ dir }) {
  const appPath = findInstalled(dir)
  const installed = appPath ? installedVersion(appPath) : null
  const info = await publishedInfo()
  const latest = info.state === 'ok' ? info.version : null
  const latestShown =
    info.state === 'ok' ? info.version : info.state === 'unpublished' ? '(尚未发布)' : `(未取到：${info.detail})`

  // .app 在但版本读不出来（Info.plist 缺失/半残安装）时不能说「未安装」——那是自相矛盾
  const installedShown = installed ?? (appPath ? '未知版本（Info.plist 不可读）' : '未安装')

  out('BeCrafter Launcher')
  out(`  已安装    ${installedShown}${appPath ? `  (${appPath})` : ''}`)
  out(`  本 CLI    ${PKG_VERSION}`)
  out(`  仓库最新  ${latestShown}`)

  if (!appPath) {
    out()
    out(`  安装：npx -y ${PKG_NAME}`)
    return
  }
  const cmp = latest && installed ? compareVersions(latest, installed) : null
  if (cmp !== null && cmp > 0) {
    out()
    out(`  有新版：${installed} → ${latest}`)
    out(`  升级：npx -y ${PKG_NAME}@${latest}`)
  } else if (cmp === 0) {
    out()
    out('  已是最新。')
  } else if (!installed) {
    out()
    out(`  版本读不出来，建议重装：npx -y ${PKG_NAME} --force`)
  }
}

function usage() {
  out(`BeCrafter Launcher 安装器（v${PKG_VERSION}）

用法：npx -y ${PKG_NAME} [命令] [选项]

命令：
  （无）                    未安装则安装；已安装则显示状态
  install                  安装 / 重装
  status                   版本检查（已装版本、本 CLI 版本、仓库最新版）
  uninstall                卸载（退出应用并删除 .app）

选项：
  --version <x.y.z|latest> 指定要安装的版本；默认 = 本 CLI 的版本
  --dir <目录>             安装目录；默认 /Applications，不可写时回退 ~/Applications
  -f, --force              已安装同版本时也强制重装
  -h, --help               显示本帮助

环境变量：
  LAUNCHER_R2_BASE         替换下载根地址（镜像 / 自建 cdn）
  LAUNCHER_INSTALL_DIR     同 --dir

说明：
  · 产物从官方 cdn 下载（约 123MB），装到 /Applications，并清除隔离标记。
  · npm 没有卸载钩子 —— 卸载必须显式运行 \`${PKG_NAME} uninstall\`。
  · 其它安装方式：curl 脚本（scripts/install.sh）与 Homebrew cask。`)
}

// ─────────────────────────────── 入口 ───────────────────────────────

const args = parseArgs(process.argv.slice(2))

if (args.error) {
  process.stderr.write(`\n错误：${args.error}\n  用 -h 查看用法。\n`)
  process.exitCode = 2
} else if (args.wantCliVersion) {
  out(PKG_VERSION)
} else if (args.help) {
  usage()
} else {
  try {
    switch (args.cmd) {
      case 'install':
        await install(args)
        break
      case 'uninstall':
        await uninstall(args)
        break
      case 'status':
        await status(args)
        break
      default:
        // 默认智能路径：未装则装，已装则报状态（`npx -y @becrafter/launcher` 的主入口）
        if (findInstalled(args.dir)) await status(args)
        else await install(args)
    }
  } catch (err) {
    if (!(err instanceof ExitSignal)) throw err
    process.exitCode = Number(err.message) || 1
  }
}
