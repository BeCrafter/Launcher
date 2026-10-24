// Homebrew cask 通道的「准备」阶段:刷新 tap → 确认 cask 已到目标版本 → 预热下载缓存。
//
// 真正替换发生在应用退出后(update-helper 的 brew 分支执行 `brew upgrade --cask`),
// 这样 Caskroom 的版本记录由 Homebrew 自己维护,下次 `brew outdated` 不会一直显示旧版。
//
// 失败不致命:调用方会把错误连同命令行兜底一起交给用户,不会让应用处于半升级状态。

import type { ShellRunner } from './shell-runner'
import { compareVersions } from './update-check'

/** 与 packaging/homebrew/launcher.rb 的 tap 全限定名一致 */
export const CASK_REF = 'becrafter/brew/launcher'

export interface BrewPrepareDeps {
  brewPath: string
  targetVersion: string
  runner: ShellRunner
  /** 阶段说明(界面展示);不会输出完整 brew 日志 */
  onMessage?: (message: string) => void
}

export type BrewPrepareResult = { ok: true } | { ok: false; error: string }

/** cask 的版本号;元数据里可能带 `,` 构建号(version,sha),只取前半段 */
export async function readCaskVersion(brewPath: string, runner: ShellRunner): Promise<string | null> {
  const r = await runner.run(brewPath, ['info', '--cask', '--json=v2', CASK_REF], { timeoutMs: 30_000 })
  if (r.code !== 0 || r.error) return null
  try {
    const j = JSON.parse(r.stdout) as { casks?: { version?: unknown }[] }
    const v = j.casks?.[0]?.version
    if (typeof v !== 'string' || v.trim() === '') return null
    return v.split(',')[0].trim()
  } catch {
    return null
  }
}

export async function prepareBrewUpdate(deps: BrewPrepareDeps): Promise<BrewPrepareResult> {
  const { brewPath, targetVersion, runner, onMessage } = deps

  let current = await readCaskVersion(brewPath, runner)
  if (current === null || compareVersions(current, targetVersion) < 0) {
    // tap 缓存可能还没刷新 —— `brew update` 是唯一能把新版本带进来的动作
    onMessage?.('正在刷新 Homebrew 元数据…')
    const up = await runner.run(brewPath, ['update'], { timeoutMs: 180_000 })
    if (up.code !== 0 || up.error) {
      return { ok: false, error: `brew update 失败:${up.stderr.trim() || up.error || `退出码 ${up.code}`}` }
    }
    current = await readCaskVersion(brewPath, runner)
  }

  if (current === null) return { ok: false, error: '读不到 Homebrew cask 的版本信息' }
  if (compareVersions(current, targetVersion) < 0) {
    return { ok: false, error: `Homebrew 上的版本仍是 ${current},还没有 ${targetVersion}` }
  }

  onMessage?.('正在通过 Homebrew 下载升级包…')
  const fetched = await runner.run(brewPath, ['fetch', '--cask', CASK_REF], { timeoutMs: 20 * 60_000 })
  if (fetched.code !== 0 || fetched.error) {
    return {
      ok: false,
      error: `brew fetch 失败:${fetched.stderr.trim() || fetched.error || `退出码 ${fetched.code}`}`
    }
  }
  return { ok: true }
}
