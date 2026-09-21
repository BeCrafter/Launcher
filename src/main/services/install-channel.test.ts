import { describe, expect, it } from 'vitest'
import type { ShellRunner, ShellRunResult } from './shell-runner'
import { UPGRADE_COMMAND } from '../../shared/ipc'
import { detectInstallChannel } from './install-channel'

const BREW = '/opt/homebrew/bin/brew'

function result(partial: Partial<ShellRunResult>): ShellRunResult {
  return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false, error: null, ...partial }
}

/** 造一个按调用记账的假执行层:brewPath 为 null 表示本机没装 brew */
function fakeRunner(opts: { brewPath?: string | null; casks?: string; brewFails?: boolean } = {}) {
  const { brewPath = BREW, casks = '', brewFails = false } = opts
  const calls: string[][] = []
  const runner: ShellRunner = {
    async run(file, args = []) {
      calls.push([file, ...args])
      if (file === '/bin/test') {
        // 只有被测候选存在时才「可执行」
        const target = args[1]
        return result({ code: brewPath && target === brewPath ? 0 : 1 })
      }
      if (file === brewPath) {
        return brewFails ? result({ code: 1, error: 'boom' }) : result({ stdout: casks })
      }
      return result({ code: 1 })
    }
  }
  return { runner, calls }
}

const deps = (opts?: Parameters<typeof fakeRunner>[0], env: NodeJS.ProcessEnv = {}) => {
  const { runner, calls } = fakeRunner(opts)
  return { runner, calls, deps: { runner, getEnv: () => env, brewCandidates: [BREW] } }
}

describe('detectInstallChannel', () => {
  it('brew 记录里有 launcher → brew（与 brew upgrade 是否生效同一个问题）', async () => {
    const { deps: d, calls } = deps({ casks: 'bluebubbles\nlauncher\ncc-switch\n' })
    expect(await detectInstallChannel(d)).toBe('brew')
    expect(calls.some((c) => c[1] === 'list' && c[2] === '--cask')).toBe(true)
  })

  it('brew 在但没装本应用 → 继续看 npm 判据', async () => {
    const { deps: d } = deps({ casks: 'bluebubbles\n' }, { _: '/Users/me/.npm/_npx/abc123/node_modules/.bin/becrafter-launcher' })
    expect(await detectInstallChannel(d)).toBe('npm')
  })

  it('brew 不在本机 / brew 报错 → 不误判成 brew', async () => {
    expect(await detectInstallChannel(deps({ brewPath: null }).deps)).toBe('manual')
    expect(await detectInstallChannel(deps({ brewFails: true }).deps)).toBe('manual')
  })

  it('npm 判据:npx 缓存目录、node_modules、npm 生成的 bin shim', async () => {
    const cases = [
      '/Users/me/.npm/_npx/deadbeef/node_modules/.bin/becrafter-launcher',
      '/Users/me/project/node_modules/.bin/becrafter-launcher',
      '/usr/local/bin/becrafter-launcher',
      '/Users/me/.nvm/versions/node/v20/bin/becrafter-launcher'
    ]
    for (const _ of cases) {
      expect(await detectInstallChannel(deps(undefined, { _ }).deps), _).toBe('npm')
    }
  })

  it('没有启动者痕迹（双击 / open / Dock）→ manual，不猜', async () => {
    expect(await detectInstallChannel(deps(undefined, {}).deps)).toBe('manual')
    expect(await detectInstallChannel(deps(undefined, { _: '/bin/zsh' }).deps)).toBe('manual')
  })

  it('每个通道都有可照抄的升级命令，且指向本仓真实入口', () => {
    expect(UPGRADE_COMMAND.brew).toContain('brew upgrade --cask becrafter/brew/launcher')
    expect(UPGRADE_COMMAND.npm).toContain('npx -y @becrafter/launcher')
    expect(UPGRADE_COMMAND.manual).toContain('BeCrafter/Launcher')
    expect(UPGRADE_COMMAND.manual).toContain('install.sh')
  })
})
