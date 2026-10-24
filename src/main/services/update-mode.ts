// 选择升级引擎:
//   brew —— 应用由 Homebrew cask 管理,且当前运行的包就是 cask 登记的那一份。
//           升级交给 `brew upgrade --cask`,以保住 Caskroom 的版本记录(否则以后 brew 永远显示过期)。
//   self —— 其余能原地替换的场景(npm / curl / 手动安装):应用内下载 + ditto 解压 + 替换。
//   none —— 开发态、App Translocation、目录不可写:只能给命令行兜底。

import { sep } from 'node:path'
import type { InstallChannel, UpdateMode } from '../../shared/ipc'
import { findBrewExecutable, INSTALL_KEY } from './install-channel'
import type { ShellRunner } from './shell-runner'
import { canReplaceBundle, isTranslocated } from './update-target'

export interface ResolveUpdateModeDeps {
  channel: InstallChannel
  /** 当前应用的 .app 路径;dev 下为 null */
  bundlePath: string | null
  runner: ShellRunner
  brewCandidates?: string[]
}

export interface ResolvedUpdateMode {
  mode: UpdateMode
  brewPath: string | null
  /** cask 登记的应用路径(仅 brew 模式) */
  caskAppPath: string | null
  /** mode=none 时给界面看的原因 */
  reason: string | null
}

const norm = (p: string): string => p.replace(/\/+$/, '')

/**
 * `brew list --cask launcher` 列出该 cask 装过的文件。最后一条 `.app` 就是 cask 登记的应用。
 * 取不到(命令失败/没有 .app)→ null,此时退回 self,而不是猜一个路径。
 */
export async function caskAppPath(brewPath: string, runner: ShellRunner): Promise<string | null> {
  const r = await runner.run(brewPath, ['list', '--cask', INSTALL_KEY], { timeoutMs: 15_000 })
  if (r.code !== 0 || r.error) return null
  const apps = r.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.endsWith('.app'))
  return apps.length > 0 ? norm(apps[apps.length - 1]) : null
}

export async function resolveUpdateMode(deps: ResolveUpdateModeDeps): Promise<ResolvedUpdateMode> {
  const { bundlePath } = deps
  if (!bundlePath || !bundlePath.endsWith('.app')) {
    return { mode: 'none', brewPath: null, caskAppPath: null, reason: '当前是开发运行,没有可替换的应用包' }
  }
  if (isTranslocated(bundlePath)) {
    return {
      mode: 'none',
      brewPath: null,
      caskAppPath: null,
      reason: '应用正从磁盘映像或下载目录直接运行,请先拖到「应用程序」'
    }
  }

  if (deps.channel === 'brew') {
    const brewPath = await findBrewExecutable(deps.runner, deps.brewCandidates)
    if (brewPath) {
      const caskPath = await caskAppPath(brewPath, deps.runner)
      if (caskPath && norm(caskPath) === norm(bundlePath)) {
        return { mode: 'brew', brewPath, caskAppPath: caskPath, reason: null }
      }
    }
    // cask 记录的路径与当前运行的包不同(用户把 app 拷出来了):退回原地替换,升级仍然生效
  }

  if (canReplaceBundle(bundlePath)) {
    return { mode: 'self', brewPath: null, caskAppPath: null, reason: null }
  }

  return {
    mode: 'none',
    brewPath: null,
    caskAppPath: null,
    reason: `应用所在目录不可写(${bundlePath.split(`${sep}Contents`)[0] || bundlePath})`
  }
}
