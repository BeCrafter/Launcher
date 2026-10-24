import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ShellRunner, ShellRunResult } from './shell-runner'
import { caskAppPath, resolveUpdateMode } from './update-mode'

const BREW = '/opt/homebrew/bin/brew'
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tmpApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'launcher-mode-'))
  dirs.push(root)
  const app = join(root, 'Launcher.app')
  mkdirSync(app, { recursive: true })
  return app
}

function result(partial: Partial<ShellRunResult>): ShellRunResult {
  return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false, error: null, ...partial }
}

/** brew 存在,`brew list --cask launcher` 返回 caskApps 里的路径 */
function fakeRunner(caskApps: string | null, brewExists = true): ShellRunner {
  return {
    async run(file, args = []) {
      if (file === '/bin/test') {
        return result({ code: brewExists && args[1] === BREW ? 0 : 1 })
      }
      if (file === BREW && args[0] === 'list' && args[1] === '--cask' && args[2] === 'launcher') {
        return caskApps === null ? result({ code: 1 }) : result({ stdout: `${caskApps}\n` })
      }
      return result({})
    }
  }
}

describe('caskAppPath', () => {
  it('取 brew list 输出里的 .app', async () => {
    const r = fakeRunner('/Applications/Launcher.app')
    expect(await caskAppPath(BREW, r)).toBe('/Applications/Launcher.app')
  })

  it('命令失败 → null(不猜路径)', async () => {
    expect(await caskAppPath(BREW, fakeRunner(null))).toBeNull()
  })
})

describe('resolveUpdateMode', () => {
  it('开发态(没有 .app)→ none', async () => {
    const r = await resolveUpdateMode({ channel: 'npm', bundlePath: null, runner: fakeRunner(null) })
    expect(r.mode).toBe('none')
    expect(r.reason).toContain('开发')
  })

  it('App Translocation → none(先让用户拖进应用程序)', async () => {
    const r = await resolveUpdateMode({
      channel: 'manual',
      bundlePath: '/private/var/folders/x/AppTranslocation/1/d/Launcher.app',
      runner: fakeRunner(null)
    })
    expect(r.mode).toBe('none')
    expect(r.reason).toContain('应用程序')
  })

  it('brew 管理且当前运行的正是 cask 登记的那份 → brew', async () => {
    const app = tmpApp()
    const r = await resolveUpdateMode({
      channel: 'brew',
      bundlePath: app,
      runner: fakeRunner(app),
      brewCandidates: [BREW]
    })
    expect(r).toMatchObject({ mode: 'brew', brewPath: BREW, caskAppPath: app })
  })

  it('brew 管理但运行的是另一份拷贝 → 退回原地替换(升级仍然生效)', async () => {
    const app = tmpApp()
    const r = await resolveUpdateMode({
      channel: 'brew',
      bundlePath: app,
      runner: fakeRunner('/Applications/Launcher.app'),
      brewCandidates: [BREW]
    })
    expect(r.mode).toBe('self')
  })

  it('npm/手动安装且目录可写 → self', async () => {
    const app = tmpApp()
    for (const channel of ['npm', 'manual'] as const) {
      expect((await resolveUpdateMode({ channel, bundlePath: app, runner: fakeRunner(null) })).mode).toBe('self')
    }
  })

  it('目录不可写 → none,并给出原因', async () => {
    const r = await resolveUpdateMode({
      channel: 'manual',
      bundlePath: '/nonexistent-launcher-root/Launcher.app',
      runner: fakeRunner(null)
    })
    expect(r.mode).toBe('none')
    expect(r.reason).toContain('不可写')
  })
})
