// 更新目标(应用包)的定位与校验。
//
// 没有 Apple 证书意味着 **不能用 codesign / spctl 作为门槛**:本应用是 ad-hoc 签名,
// `codesign --verify --deep --strict` 会直接失败。能做的、也必须做的是结构校验:
//   · 包标识与版本号与清单一致(防止把别的应用/别的版本装进来)
//   · 主可执行文件存在且可执行
//   · 架构与当前机器匹配(lipo;防止把 x64 包装进 arm64 机器却打不开)
//   · LSMinimumSystemVersion 不高于当前系统
//   · launcher-mcp 入口在(MCP 是应用的一部分,缺了说明产物结构不对)
//
// 解压必须用 `ditto -x -k`(见 design 讨论):JS zip 库与 unzip 会丢符号链接/扩展属性,
// 破坏 .app 内部结构。

import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import type { ShellRunner } from './shell-runner'
import { compareVersions } from './update-check'
import type { UpdateArch } from './update-manifest'

export const APP_BUNDLE_ID = 'com.becrafter.launcher'
export const APP_BUNDLE_NAME = 'Launcher.app'
export const APP_EXECUTABLE = 'Launcher'

/** `/Applications/Launcher.app/Contents/MacOS/Launcher` → `/Applications/Launcher.app` */
export function appBundleFromExecutable(exePath: string): string | null {
  const marker = `${sep}Contents${sep}MacOS${sep}`
  const i = exePath.indexOf(marker)
  if (i <= 0) return null
  const bundle = exePath.slice(0, i)
  return bundle.endsWith('.app') ? bundle : null
}

/** Gatekeeper 的 App Translocation 路径:那里只读,且路径每次启动都变,不能原地升级 */
export function isTranslocated(path: string): boolean {
  return path.includes(`${sep}AppTranslocation${sep}`)
}

/**
 * 能否原地替换:看**父目录**是否可写(替换 = 移走旧包 + 把新包移进来)。
 * macOS 14+ 的 App Management 可能在 access 通过后仍拒绝实际操作 ——
 * 那种情况只能等 apply 时失败并给出命令行兜底。
 */
export function canReplaceBundle(bundlePath: string): boolean {
  if (!bundlePath.endsWith('.app') || isTranslocated(bundlePath)) return false
  try {
    accessSync(dirname(bundlePath), constants.W_OK)
    return true
  } catch {
    return false
  }
}

export interface BundleInfo {
  id: string
  version: string
  executable: string
  minimumSystemVersion: string | null
}

export type BundleInfoResult = { ok: true; info: BundleInfo } | { ok: false; error: string }

/** 读 Info.plist。用 plutil 转 JSON —— plist 可能是二进制格式,不能当文本 parse */
export async function readBundleInfo(appPath: string, runner: ShellRunner): Promise<BundleInfoResult> {
  const plist = join(appPath, 'Contents', 'Info.plist')
  if (!existsSync(plist)) return { ok: false, error: '更新包缺少 Info.plist' }
  const r = await runner.run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], {
    timeoutMs: 10_000
  })
  if (r.code !== 0 || r.error) {
    return { ok: false, error: `Info.plist 读取失败:${r.stderr.trim() || r.error || `退出码 ${r.code}`}` }
  }
  try {
    const j = JSON.parse(r.stdout) as Record<string, unknown>
    return {
      ok: true,
      info: {
        id: typeof j['CFBundleIdentifier'] === 'string' ? j['CFBundleIdentifier'] : '',
        version: typeof j['CFBundleShortVersionString'] === 'string' ? j['CFBundleShortVersionString'] : '',
        executable: typeof j['CFBundleExecutable'] === 'string' ? j['CFBundleExecutable'] : '',
        minimumSystemVersion:
          typeof j['LSMinimumSystemVersion'] === 'string' ? j['LSMinimumSystemVersion'] : null
      }
    }
  } catch {
    return { ok: false, error: 'Info.plist 不是合法 JSON' }
  }
}

/** 产物架构名(清单用 arm64/x64;lipo 用 arm64/x86_64) */
export function lipoArch(arch: UpdateArch): string {
  return arch === 'x64' ? 'x86_64' : 'arm64'
}

export interface ValidateBundleDeps {
  runner: ShellRunner
  expectedVersion: string
  arch: UpdateArch
  /** 当前 macOS 版本,如 14.6.1(process.getSystemVersion()) */
  hostVersion: string
}

export type ValidateBundleResult = { ok: true; info: BundleInfo } | { ok: false; error: string }

/** 校验「解压后的待替换应用包」是否真的是本应用的目标版本 */
export async function validateAppBundle(
  appPath: string,
  deps: ValidateBundleDeps
): Promise<ValidateBundleResult> {
  if (!existsSync(appPath)) return { ok: false, error: '更新包不存在' }
  try {
    if (!statSync(appPath).isDirectory()) return { ok: false, error: '更新包不是目录' }
  } catch {
    return { ok: false, error: '更新包不可读' }
  }

  const r = await readBundleInfo(appPath, deps.runner)
  if (!r.ok) return r
  const info = r.info

  if (info.id !== APP_BUNDLE_ID) {
    return { ok: false, error: `应用标识不符(${info.id || '空'})` }
  }
  if (info.version !== deps.expectedVersion) {
    return { ok: false, error: `更新包版本为 ${info.version || '未知'},期望 ${deps.expectedVersion}` }
  }
  if (!info.executable) return { ok: false, error: '更新包缺少主可执行文件声明' }
  const exe = join(appPath, 'Contents', 'MacOS', info.executable)
  try {
    accessSync(exe, constants.X_OK)
  } catch {
    return { ok: false, error: '更新包的主可执行文件缺失或不可执行' }
  }
  // MCP stdio 入口是产物的一部分;缺它说明打包结构不对,不应替换
  if (!existsSync(join(appPath, 'Contents', 'Resources', 'launcher-mcp'))) {
    return { ok: false, error: '更新包缺少 launcher-mcp' }
  }
  if (info.minimumSystemVersion && compareVersions(info.minimumSystemVersion, deps.hostVersion) > 0) {
    return { ok: false, error: `该版本要求 macOS ${info.minimumSystemVersion}+` }
  }

  const lipo = await deps.runner.run('/usr/bin/lipo', ['-archs', exe], { timeoutMs: 10_000 })
  if (lipo.code !== 0 || lipo.error) {
    return { ok: false, error: `无法读取更新包架构:${lipo.stderr.trim() || lipo.error || 'lipo 失败'}` }
  }
  const archs = lipo.stdout.trim().split(/\s+/).filter(Boolean)
  if (!archs.includes(lipoArch(deps.arch))) {
    return { ok: false, error: `更新包不含 ${lipoArch(deps.arch)} 架构(${archs.join(', ') || '未知'})` }
  }

  return { ok: true, info }
}
