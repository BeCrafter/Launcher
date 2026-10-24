import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ShellRunner, ShellRunResult } from './shell-runner'
import {
  appBundleFromExecutable,
  canReplaceBundle,
  isTranslocated,
  lipoArch,
  validateAppBundle
} from './update-target'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'launcher-target-'))
  dirs.push(d)
  return d
}

function result(partial: Partial<ShellRunResult>): ShellRunResult {
  return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false, error: null, ...partial }
}

function fakeRunner(opts: { info?: Record<string, unknown>; archs?: string } = {}): ShellRunner {
  return {
    async run(file, args = []) {
      if (file === '/usr/bin/plutil') {
        return result({ stdout: JSON.stringify(opts.info ?? {}) })
      }
      if (file === '/usr/bin/lipo') {
        return result({ stdout: opts.archs ?? 'arm64' })
      }
      return result({})
    }
  }
}

function makeApp(info: Record<string, unknown> = {}, opts: { launcherMcp?: boolean } = {}): string {
  const root = tmp()
  const app = join(root, 'Launcher.app')
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true })
  writeFileSync(join(app, 'Contents', 'Info.plist'), '{}')
  const exe = join(app, 'Contents', 'MacOS', 'Launcher')
  writeFileSync(exe, '')
  chmodSync(exe, 0o755)
  if (opts.launcherMcp !== false) writeFileSync(join(app, 'Contents', 'Resources', 'launcher-mcp'), '')
  return app
}

const GOOD_INFO = {
  CFBundleIdentifier: 'com.becrafter.launcher',
  CFBundleShortVersionString: '0.3.0',
  CFBundleExecutable: 'Launcher',
  LSMinimumSystemVersion: '12.0'
}

const deps = (over: Partial<Parameters<typeof validateAppBundle>[1]> = {}) => ({
  runner: fakeRunner({ info: GOOD_INFO }),
  expectedVersion: '0.3.0',
  arch: 'arm64' as const,
  hostVersion: '14.6.1',
  ...over
})

describe('appBundleFromExecutable', () => {
  it('从进程路径反推 .app 包', () => {
    expect(
      appBundleFromExecutable('/Applications/Launcher.app/Contents/MacOS/Launcher')
    ).toBe('/Applications/Launcher.app')
    expect(appBundleFromExecutable('/opt/homebrew/bin/brew')).toBeNull()
    expect(appBundleFromExecutable('/Applications/Launcher.app/Contents/MacOS')).toBeNull()
  })
})

describe('canReplaceBundle', () => {
  it('普通 .app 且父目录可写 → 可以原地替换', () => {
    const app = makeApp()
    expect(canReplaceBundle(app)).toBe(true)
  })

  it('App Translocation → 不可以', () => {
    expect(isTranslocated('/private/var/folders/x/AppTranslocation/123/d/Launcher.app')).toBe(true)
    expect(canReplaceBundle('/private/var/folders/x/AppTranslocation/123/d/Launcher.app')).toBe(false)
  })

  it('父目录不存在/不可写 → 不可以', () => {
    expect(canReplaceBundle('/nonexistent-launcher-root/Launcher.app')).toBe(false)
  })
})

describe('lipoArch', () => {
  it('清单架构名映射到 lipo 名', () => {
    expect(lipoArch('arm64')).toBe('arm64')
    expect(lipoArch('x64')).toBe('x86_64')
  })
})

describe('validateAppBundle', () => {
  it('结构、标识、版本、架构都正确 → 通过', async () => {
    const app = makeApp()
    const r = await validateAppBundle(app, deps())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.info.version).toBe('0.3.0')
  })

  it('包标识不符 → 拒绝', async () => {
    const app = makeApp()
    const r = await validateAppBundle(
      app,
      deps({ runner: fakeRunner({ info: { ...GOOD_INFO, CFBundleIdentifier: 'com.evil.app' } }) })
    )
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('标识') })
  })

  it('版本不符 → 拒绝', async () => {
    const app = makeApp()
    const r = await validateAppBundle(
      app,
      deps({ runner: fakeRunner({ info: { ...GOOD_INFO, CFBundleShortVersionString: '0.2.9' } }) })
    )
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('0.2.9') })
  })

  it('缺少 launcher-mcp / 可执行文件 → 拒绝', async () => {
    const noMcp = makeApp({}, { launcherMcp: false })
    expect(await validateAppBundle(noMcp, deps())).toMatchObject({
      ok: false,
      error: expect.stringContaining('launcher-mcp')
    })

    const app = makeApp()
    rmSync(join(app, 'Contents', 'MacOS', 'Launcher'))
    expect(await validateAppBundle(app, deps())).toMatchObject({
      ok: false,
      error: expect.stringContaining('可执行')
    })
  })

  it('架构不匹配 → 拒绝(x64 包装到 arm64 机器)', async () => {
    const app = makeApp()
    const r = await validateAppBundle(app, deps({ runner: fakeRunner({ info: GOOD_INFO, archs: 'x86_64' }) }))
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('arm64') })
  })

  it('最低系统版本高于当前系统 → 拒绝', async () => {
    const app = makeApp()
    const r = await validateAppBundle(
      app,
      deps({ runner: fakeRunner({ info: { ...GOOD_INFO, LSMinimumSystemVersion: '15.0' } }) })
    )
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('macOS 15.0') })
  })
})
