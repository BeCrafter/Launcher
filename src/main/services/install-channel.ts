// 安装来源探测:应用自己判断「我是被哪条通道装进来的」,好给出**该通道对应的**升级命令。
//
// 为什么需要它:三条通道的升级动作完全不同(brew upgrade / 重跑 npx / 重跑 curl),而应用此前
// 对来源一无所知 —— 于是所有人看到的都是同一句「请前往 GitHub 下载」,哪怕他是 brew 装的。
//
// 判据是**尽力而为**的:判错也不会坏事(最差是给了一条不适用但无害的命令),但判错的代价是
// 用户照着做了却没升级成功。因此宁可回退到 manual,也不猜。
//
// ⚠ 不使用「/Applications 那份与 Caskroom 是否同一 inode」这类判据:实测(本机 BlueBubbles)
//   cask 装完两者 inode 并不相同,该判据不成立。改用 brew 自己的记录 —— 它同时也是
//   `brew upgrade` 能否生效的准确答案。

import { sep } from 'node:path'
import type { InstallChannel } from '../../shared/ipc'
import type { ShellRunner } from './shell-runner'

/** brew cask 的 token(与 packaging/homebrew/launcher.rb 的 cask 名一致) */
export const INSTALL_KEY = 'launcher'

export interface InstallChannelDeps {
  /** 走统一执行层(超时可控);brew 不在本机时它会返回 error,不抛 */
  runner: ShellRunner
  /** 注入点:测试里换掉 process.env */
  getEnv?: () => NodeJS.ProcessEnv
  /** brew 可执行文件候选(Apple Silicon / Intel);测试里注入假路径 */
  brewCandidates?: string[]
}

const DEFAULT_BREW_CANDIDATES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']

/**
 * 判定顺序:**先 brew 再 npm**。两条都可能命中时 brew 优先 —— cask 记着这个应用,
 * `brew upgrade` 就会把它升上来,给 brew 用户 npm 命令反而是错的。
 */
export async function detectInstallChannel(deps: InstallChannelDeps): Promise<InstallChannel> {
  const env = deps.getEnv?.() ?? process.env
  if (await installedByCask(deps.runner, deps.brewCandidates ?? DEFAULT_BREW_CANDIDATES)) return 'brew'
  if (launchedByNpm(env)) return 'npm'
  return 'manual'
}

/** brew 记录里有本应用 → cask 装的(与 brew upgrade 是否生效是同一个问题) */
async function installedByCask(runner: ShellRunner, candidates: string[]): Promise<boolean> {
  let brew: string | null = null
  for (const p of candidates) {
    const r = await runner.run('/bin/test', ['-x', p], { timeoutMs: 2_000 })
    if (r.code === 0 && !r.error) {
      brew = p
      break
    }
  }
  if (!brew) return false
  // brew 是 ruby 脚本,真跑一次约 0.2s;给足 10s 以免机器忙时被误判为失败
  const r = await runner.run(brew, ['list', '--cask'], { timeoutMs: 10_000 })
  if (r.code !== 0 || r.error) return false
  return r.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(INSTALL_KEY)
}

/**
 * 启动者是不是 npm/npx:打包后的 app 不会自己带 `_`(那是 shell 给子进程传的),它只可能
 * 来自「谁启动了我」—— 而 CLI 是 `spawn(appBundle)` 启的,故 `_` 会是 npx 的缓存目录或
 * npm 的 bin shim。⚠ 反向不成立:用户从 shell 里 `open` 或双击时没有这个变量,于是
 * npm 装的也会被判成 manual —— 这是**故意**的取舍,宁可少认也不误认。
 */
function launchedByNpm(env: NodeJS.ProcessEnv): boolean {
  const launcher = env['_']
  if (!launcher) return false
  return (
    launcher.includes(`${sep}_npx${sep}`) ||
    launcher.includes(`${sep}node_modules${sep}`) ||
    /\.(c|z|ba)?sh$/.test(launcher) ||
    launcher.endsWith(`${sep}becrafter-launcher`)
  )
}
