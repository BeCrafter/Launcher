import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ShellRunner, ShellRunResult } from './shell-runner'
import { createUpdateController, type UpdateControllerDeps } from './update-controller'
import { updatePaths } from './update-helper'

const VERSION = '0.3.0'
const ZIP = Buffer.from('fake-zip-content-for-sha256')
const SHA = createHash('sha256').update(ZIP).digest('hex')

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function makeRoot(): string {
  const d = mkdtempSync(join(tmpdir(), 'launcher-update-'))
  dirs.push(d)
  return d
}

function result(partial: Partial<ShellRunResult> = {}): ShellRunResult {
  return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false, error: null, ...partial }
}

/** 假执行层:plutil/lipo 返回固定元数据;ditto 真的造出解压后的 .app */
function fakeRunner(): ShellRunner {
  return {
    async run(file, args = []) {
      if (file === '/usr/bin/plutil') {
        return result({
          stdout: JSON.stringify({
            CFBundleIdentifier: 'com.becrafter.launcher',
            CFBundleShortVersionString: VERSION,
            CFBundleExecutable: 'Launcher',
            LSMinimumSystemVersion: '12.0'
          })
        })
      }
      if (file === '/usr/bin/lipo') return result({ stdout: 'arm64' })
      if (file === '/usr/bin/ditto') {
        const staging = args[3]
        const app = join(staging, 'Launcher.app')
        mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
        mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true })
        writeFileSync(join(app, 'Contents', 'Info.plist'), '{}')
        writeFileSync(join(app, 'Contents', 'MacOS', 'Launcher'), '')
        chmodSync(join(app, 'Contents', 'MacOS', 'Launcher'), 0o755)
        writeFileSync(join(app, 'Contents', 'Resources', 'launcher-mcp'), '')
        return result({})
      }
      if (file === '/bin/test') return result({ code: 1 })
      return result({})
    }
  }
}

function makeDeps(over: Partial<UpdateControllerDeps> = {}) {
  const root = makeRoot()
  const userDataDir = join(root, 'userData')
  mkdirSync(userDataDir, { recursive: true })
  const bundlePath = join(root, 'Applications', 'Launcher.app')
  mkdirSync(bundlePath, { recursive: true })

  const fetchCalls: string[] = []
  let failSha = false
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input)
    fetchCalls.push(url)
    if (url.endsWith('/versions.txt')) return new Response('0.3.0\n')
    if (url.endsWith(`/Launcher-${VERSION}.json`)) {
      const sha = failSha ? 'b'.repeat(64) : SHA
      return new Response(
        JSON.stringify({
          version: VERSION,
          minSystemVersion: '12.0',
          files: {
            arm64: { path: `Launcher-${VERSION}-arm64.zip`, sha256: sha, size: ZIP.length },
            x64: { path: `Launcher-${VERSION}-x64.zip`, sha256: sha, size: ZIP.length }
          }
        })
      )
    }
    if (url.endsWith(`/Launcher-${VERSION}-arm64.zip`)) return new Response(ZIP)
    return new Response('', { status: 404 })
  }) as typeof fetch

  let quitCount = 0
  const spawned: unknown[] = []
  const deps: UpdateControllerDeps = {
    currentVersion: () => '0.2.2',
    hostVersion: '14.6.1',
    arch: 'arm64',
    bundlePath,
    userDataDir,
    runner: fakeRunner(),
    getChannel: async () => 'npm',
    fetchImpl,
    env: { LAUNCHER_R2_BASE: 'https://cdn.test' },
    versionsUrlOverride: 'https://cdn.test/versions.txt',
    broadcast: () => undefined,
    quit: () => {
      quitCount += 1
    },
    spawnHelper: (opts) => {
      spawned.push(opts)
      return { ok: true }
    },
    ...over
  }
  return {
    deps,
    controller: createUpdateController(deps),
    userDataDir,
    bundlePath,
    fetchCalls,
    spawned,
    quitCount: () => quitCount,
    setFailSha: () => {
      failSha = true
    }
  }
}

async function waitFor(
  controller: ReturnType<typeof createUpdateController>,
  phase: string,
  timeoutMs = 3000
): Promise<ReturnType<typeof controller.getState>> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const s = controller.getState()
    if (s.phase === phase) return s
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`等待 ${phase} 超时,当前 ${controller.getState().phase}`)
}

describe('UpdateController(自动下载 → ready)', () => {
  it('检查命中后自动下载、校验、解压并进入 ready', async () => {
    const { controller, userDataDir, bundlePath } = makeDeps()
    await controller.check()
    const s = await waitFor(controller, 'ready')

    expect(s.mode).toBe('self')
    expect(s.targetVersion).toBe(VERSION)
    expect(s.downloadSize).toBe(ZIP.length)
    expect(s.progress).toMatchObject({ received: ZIP.length, percent: 100 })
    expect(s.canApply).toBe(true)

    const paths = updatePaths(userDataDir)
    expect(existsSync(paths.zip(VERSION, 'arm64'))).toBe(true)
    expect(existsSync(paths.stagedApp(VERSION))).toBe(true)
    // brew 探测失败后仍应走 self,而不是误判成 brew
    expect(bundlePath).toContain('Launcher.app')
    controller.dispose()
  })

  it('apply 把 self/路径/版本交给助手,并进入 restarting', async () => {
    const { controller, spawned, bundlePath } = makeDeps()
    await controller.check()
    await waitFor(controller, 'ready')
    const s = await controller.apply()

    expect(s.phase).toBe('restarting')
    expect(spawned).toHaveLength(1)
    expect(spawned[0]).toMatchObject({
      mode: 'self',
      appPath: bundlePath,
      fromVersion: '0.2.2',
      toVersion: VERSION,
      pid: process.pid
    })
    controller.dispose()
  })

  it('助手启动失败可直接重试,不重新下载', async () => {
    let failSpawn = true
    const spawnCalls: unknown[] = []
    const env = makeDeps({
      spawnHelper: (opts) => {
        spawnCalls.push(opts)
        return failSpawn ? { ok: false, error: '无法写入升级助手' } : { ok: true }
      }
    })
    await env.controller.check()
    await waitFor(env.controller, 'ready')

    const first = await env.controller.apply()
    expect(first.phase).toBe('error')
    expect(first.error?.code).toBe('apply')
    expect(spawnCalls).toHaveLength(1)

    const downloads = (): number => env.fetchCalls.filter((u) => u.endsWith('.zip')).length
    const before = downloads()
    failSpawn = false
    const second = await env.controller.apply()
    expect(second.phase).toBe('restarting')
    expect(spawnCalls).toHaveLength(2)
    expect(downloads()).toBe(before)
    env.controller.dispose()
  })

  it('sha256 不符 → error/verify,不进入 ready', async () => {
    const env = makeDeps()
    env.setFailSha()
    await env.controller.check()
    const s = await waitFor(env.controller, 'error')
    expect(s.error?.code).toBe('verify')
    expect(s.canApply).toBe(false)
    env.controller.dispose()
  })

  it('已是最新 → upToDate,不发起下载', async () => {
    const { controller, fetchCalls } = makeDeps({ currentVersion: () => '0.3.0' })
    const s = await controller.check()
    expect(s.phase).toBe('upToDate')
    expect(fetchCalls.some((u) => u.endsWith('.zip'))).toBe(false)
    controller.dispose()
  })

  it('dev(没有 .app)→ available + unsupported,只给命令行兜底', async () => {
    const { controller, fetchCalls } = makeDeps({ bundlePath: null })
    const s = await controller.check()
    expect(s.phase).toBe('available')
    expect(s.mode).toBe('none')
    expect(s.error?.code).toBe('unsupported')
    expect(s.fallbackCommand).toContain('@becrafter/launcher')
    expect(fetchCalls.some((u) => u.endsWith('.zip'))).toBe(false)
    controller.dispose()
  })

  it('检查失败 → error/network,可重新检查', async () => {
    const { controller } = makeDeps({
      fetchImpl: (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch
    })
    const s = await controller.check()
    expect(s.phase).toBe('error')
    expect(s.error?.code).toBe('network')
    expect(s.canCheck).toBe(true)
    controller.dispose()
  })
})
